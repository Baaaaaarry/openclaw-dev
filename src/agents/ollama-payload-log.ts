import crypto from "node:crypto";
import path from "node:path";
import { resolveStateDir } from "../config/paths.js";
import type { DiagnosticTraceIdentity } from "../infra/latency-trace.js";
import { createSubsystemLogger } from "../logging/subsystem.js";
import { resolveUserPath } from "../utils.js";
import { parseBooleanValue } from "../utils/boolean.js";
import { safeJsonStringify } from "../utils/safe-json.js";
import { getQueuedFileWriter, type QueuedFileWriter } from "./queued-file-writer.js";

type OllamaPayloadLogStage = "request" | "response" | "error";

type OllamaPayloadLogEvent = DiagnosticTraceIdentity & {
  ts: string;
  stage: OllamaPayloadLogStage;
  filePath: string;
  baseUrl: string;
  chatUrl: string;
  request?: unknown;
  response?: unknown;
  error?: string;
  requestDigest?: string;
  responseDigest?: string;
  transport?: string;
};

type OllamaPayloadLogConfig = {
  enabled: boolean;
  filePath: string;
};

export type OllamaPayloadLogger = {
  enabled: true;
  filePath: string;
  recordRequest: (payload: unknown) => void;
  recordResponse: (payload: unknown) => void;
  recordError: (error: unknown, payload?: unknown) => void;
};

const writers = new Map<string, QueuedFileWriter>();
const log = createSubsystemLogger("agent/ollama-payload");

function resolvePayloadLogConfig(env: NodeJS.ProcessEnv): OllamaPayloadLogConfig {
  const enabled = parseBooleanValue(env.OPENCLAW_OLLAMA_PAYLOAD_LOG) ?? false;
  const fileOverride = env.OPENCLAW_OLLAMA_PAYLOAD_LOG_FILE?.trim();
  const filePath = fileOverride
    ? resolveUserPath(fileOverride)
    : path.join(resolveStateDir(env), "logs", "ollama-payload.jsonl");
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

export function createOllamaPayloadLogger(params: {
  env?: NodeJS.ProcessEnv;
  trace?: DiagnosticTraceIdentity;
  baseUrl: string;
  chatUrl: string;
}): OllamaPayloadLogger | null {
  const env = params.env ?? process.env;
  const cfg = resolvePayloadLogConfig(env);
  if (!cfg.enabled) {
    return null;
  }

  const writer = getWriter(cfg.filePath);
  const base: Omit<OllamaPayloadLogEvent, "ts" | "stage" | "request" | "response" | "error"> = {
    ...params.trace,
    filePath: writer.filePath,
    baseUrl: params.baseUrl,
    chatUrl: params.chatUrl,
    transport: "ollama-api-chat",
  };

  const record = (event: OllamaPayloadLogEvent) => {
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

  log.info("ollama payload logger enabled", { filePath: writer.filePath, chatUrl: params.chatUrl });
  return {
    enabled: true,
    filePath: writer.filePath,
    recordRequest,
    recordResponse,
    recordError,
  };
}
