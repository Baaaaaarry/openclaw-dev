import crypto from "node:crypto";
import path from "node:path";
import type { StreamFn } from "@mariozechner/pi-agent-core";
import { streamSimple } from "@mariozechner/pi-ai";
import { resolveStateDir } from "../config/paths.js";
import type { DiagnosticTraceIdentity } from "../infra/latency-trace.js";
import { createSubsystemLogger } from "../logging/subsystem.js";
import { resolveUserPath } from "../utils.js";
import { parseBooleanValue } from "../utils/boolean.js";
import { safeJsonStringify } from "../utils/safe-json.js";
import { getQueuedFileWriter, type QueuedFileWriter } from "./queued-file-writer.js";

type LlmPayloadLogStage = "request" | "response" | "error";

type LlmPayloadLogEvent = DiagnosticTraceIdentity & {
  ts: string;
  stage: LlmPayloadLogStage;
  filePath: string;
  provider?: string;
  modelApi?: string | null;
  requestUrl?: string;
  baseUrl?: string;
  transport?: string;
  request?: unknown;
  response?: unknown;
  error?: string;
  requestDigest?: string;
  responseDigest?: string;
};

type LlmPayloadLogConfig = {
  enabled: boolean;
  filePath: string;
};

export type LlmPayloadLogger = {
  enabled: true;
  filePath: string;
  wrapStreamFn: (streamFn: StreamFn) => StreamFn;
  recordRequest: (payload: unknown) => void;
  recordResponse: (payload: unknown) => void;
  recordError: (error: unknown, payload?: unknown) => void;
};

const writers = new Map<string, QueuedFileWriter>();
const log = createSubsystemLogger("agent/llm-payload");

function resolvePayloadLogConfig(env: NodeJS.ProcessEnv): LlmPayloadLogConfig {
  const enabled =
    parseBooleanValue(env.OPENCLAW_LLM_PAYLOAD_LOG) ??
    parseBooleanValue(env.OPENCLAW_OLLAMA_PAYLOAD_LOG) ??
    false;
  const fileOverride =
    env.OPENCLAW_LLM_PAYLOAD_LOG_FILE?.trim() ?? env.OPENCLAW_OLLAMA_PAYLOAD_LOG_FILE?.trim();
  const filePath = fileOverride
    ? resolveUserPath(fileOverride)
    : path.join(resolveStateDir(env), "logs", "llm-payload.jsonl");
  return { enabled, filePath };
}

function getWriter(filePath: string): QueuedFileWriter {
  return getQueuedFileWriter(writers, filePath);
}

function digest(value: unknown): string | undefined {
  const serialized = safeJsonStringify(value);
  if (!serialized) {
    return undefined;
  }
  return crypto.createHash("sha256").update(serialized).digest("hex");
}

function formatError(error: unknown): string | undefined {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  if (typeof error === "number" || typeof error === "boolean" || typeof error === "bigint") {
    return String(error);
  }
  if (error && typeof error === "object") {
    return safeJsonStringify(error) ?? "unknown error";
  }
  return undefined;
}

function wrapPayloadLogging(
  stream: ReturnType<typeof streamSimple>,
  hooks: Pick<LlmPayloadLogger, "recordResponse" | "recordError">,
): ReturnType<typeof streamSimple> {
  let responseRecorded = false;
  let errorRecorded = false;

  const recordResponseOnce = (payload: unknown) => {
    if (responseRecorded) {
      return;
    }
    responseRecorded = true;
    hooks.recordResponse(payload);
  };

  const recordErrorOnce = (error: unknown) => {
    if (errorRecorded) {
      return;
    }
    errorRecorded = true;
    hooks.recordError(error);
  };

  const originalResult = stream.result.bind(stream);
  stream.result = async () => {
    try {
      const message = await originalResult();
      recordResponseOnce(message);
      return message;
    } catch (error) {
      recordErrorOnce(error);
      throw error;
    }
  };

  const originalAsyncIterator = stream[Symbol.asyncIterator].bind(stream);
  (stream as { [Symbol.asyncIterator]: typeof originalAsyncIterator })[Symbol.asyncIterator] =
    function () {
      const iterator = originalAsyncIterator();
      return {
        async next() {
          try {
            return await iterator.next();
          } catch (error) {
            recordErrorOnce(error);
            throw error;
          }
        },
        async return(value?: unknown) {
          return iterator.return?.(value) ?? { done: true as const, value: undefined };
        },
        async throw(error?: unknown) {
          recordErrorOnce(error);
          return iterator.throw?.(error) ?? { done: true as const, value: undefined };
        },
      };
    };

  return stream;
}

export function createLlmPayloadLogger(params: {
  env?: NodeJS.ProcessEnv;
  trace?: DiagnosticTraceIdentity;
  provider?: string;
  modelApi?: string | null;
  baseUrl?: string;
  requestUrl?: string;
  transport?: string;
}): LlmPayloadLogger | null {
  const env = params.env ?? process.env;
  const cfg = resolvePayloadLogConfig(env);
  if (!cfg.enabled) {
    return null;
  }

  const writer = getWriter(cfg.filePath);
  const base: Omit<
    LlmPayloadLogEvent,
    "ts" | "stage" | "request" | "response" | "error" | "requestDigest" | "responseDigest"
  > = {
    ...params.trace,
    filePath: writer.filePath,
    provider: params.provider ?? params.trace?.provider,
    modelApi: params.modelApi,
    requestUrl: params.requestUrl,
    baseUrl: params.baseUrl,
    transport: params.transport,
  };

  const record = (event: LlmPayloadLogEvent) => {
    const line = safeJsonStringify(event);
    if (!line) {
      return;
    }
    writer.write(`${line}\n`);
  };

  const recordRequest = (payload: unknown) => {
    record({
      ...base,
      ts: new Date().toISOString(),
      stage: "request",
      request: payload,
      requestDigest: digest(payload),
    });
  };

  const recordResponse = (payload: unknown) => {
    record({
      ...base,
      ts: new Date().toISOString(),
      stage: "response",
      response: payload,
      responseDigest: digest(payload),
    });
  };

  const recordError = (error: unknown, payload?: unknown) => {
    record({
      ...base,
      ts: new Date().toISOString(),
      stage: "error",
      response: payload,
      error: formatError(error),
      responseDigest: digest(payload),
    });
  };

  const wrapStreamFn: LlmPayloadLogger["wrapStreamFn"] = (streamFn) => {
    const wrapped: StreamFn = (model, context, options) => {
      const nextOnPayload = (payload: unknown) => {
        recordRequest(payload);
        options?.onPayload?.(payload);
      };
      const maybeStream = streamFn(model, context, {
        ...options,
        onPayload: nextOnPayload,
      });
      const wrapResolved = (stream: ReturnType<typeof streamSimple>) =>
        wrapPayloadLogging(stream, { recordResponse, recordError });
      if (maybeStream && typeof maybeStream === "object" && "then" in maybeStream) {
        return Promise.resolve(maybeStream).then(wrapResolved);
      }
      return wrapResolved(maybeStream);
    };
    return wrapped;
  };

  log.info("llm payload logger enabled", {
    filePath: writer.filePath,
    provider: base.provider,
    requestUrl: params.requestUrl,
  });
  return {
    enabled: true,
    filePath: writer.filePath,
    wrapStreamFn,
    recordRequest,
    recordResponse,
    recordError,
  };
}
