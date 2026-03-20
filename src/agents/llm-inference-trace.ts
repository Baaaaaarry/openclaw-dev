import type { StreamFn } from "@mariozechner/pi-agent-core";
import { streamSimple } from "@mariozechner/pi-ai";
import type { DiagnosticTraceIdentity } from "../infra/latency-trace.js";
import { logLatencySegment } from "../logging/diagnostic.js";

type LlmInferenceTrace = DiagnosticTraceIdentity & {
  transport?: string;
};

type UsageLike = {
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
  total?: number;
  totalTokens?: number;
};

function normalizeUsage(value: unknown): UsageLike | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const usage = value as UsageLike;
  const input = typeof usage.input === "number" ? usage.input : undefined;
  const output = typeof usage.output === "number" ? usage.output : undefined;
  const cacheRead = typeof usage.cacheRead === "number" ? usage.cacheRead : undefined;
  const cacheWrite = typeof usage.cacheWrite === "number" ? usage.cacheWrite : undefined;
  const total =
    typeof usage.total === "number"
      ? usage.total
      : typeof usage.totalTokens === "number"
        ? usage.totalTokens
        : undefined;
  if (
    input === undefined &&
    output === undefined &&
    cacheRead === undefined &&
    cacheWrite === undefined &&
    total === undefined
  ) {
    return undefined;
  }
  return { input, output, cacheRead, cacheWrite, total };
}

function extractMessageUsage(value: unknown): UsageLike | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const record = value as { usage?: unknown; message?: { usage?: unknown } };
  return normalizeUsage(record.usage) ?? normalizeUsage(record.message?.usage);
}

function wrapLlmInferenceTrace(
  stream: ReturnType<typeof streamSimple>,
  params: {
    requestStartedAt: number;
    trace: LlmInferenceTrace;
  },
): ReturnType<typeof streamSimple> {
  let firstChunkAt: number | undefined;
  let ttftLogged = false;
  let totalLogged = false;

  const recordTtft = (endedAtMs: number) => {
    if (ttftLogged) {
      return;
    }
    ttftLogged = true;
    firstChunkAt = endedAtMs;
    logLatencySegment({
      segment: "t5_llm_inference",
      stage: "ttft",
      durationMs: endedAtMs - params.requestStartedAt,
      startedAtMs: params.requestStartedAt,
      endedAtMs,
      channel: params.trace.channel,
      accountId: params.trace.accountId,
      chatId: params.trace.chatId,
      messageId: params.trace.messageId,
      sessionKey: params.trace.sessionKey,
      sessionId: params.trace.sessionId,
      runId: params.trace.runId,
      provider: params.trace.provider,
      model: params.trace.model,
      transport: params.trace.transport,
      ttftMs: endedAtMs - params.requestStartedAt,
    });
  };

  const recordTotal = (endedAtMs: number, usage?: UsageLike) => {
    if (totalLogged) {
      return;
    }
    totalLogged = true;
    const totalMs = endedAtMs - params.requestStartedAt;
    logLatencySegment({
      segment: "t5_llm_inference",
      stage: "completed",
      durationMs: totalMs,
      startedAtMs: params.requestStartedAt,
      endedAtMs,
      channel: params.trace.channel,
      accountId: params.trace.accountId,
      chatId: params.trace.chatId,
      messageId: params.trace.messageId,
      sessionKey: params.trace.sessionKey,
      sessionId: params.trace.sessionId,
      runId: params.trace.runId,
      provider: params.trace.provider,
      model: params.trace.model,
      transport: params.trace.transport,
      totalMs,
      ttftMs: firstChunkAt ? firstChunkAt - params.requestStartedAt : undefined,
      inputTokens: usage?.input,
      outputTokens: usage?.output,
      cacheReadTokens: usage?.cacheRead,
      cacheWriteTokens: usage?.cacheWrite,
      totalTokens:
        usage?.total ??
        ((usage?.input ?? 0) +
          (usage?.output ?? 0) +
          (usage?.cacheRead ?? 0) +
          (usage?.cacheWrite ?? 0) ||
          undefined),
    });
  };

  const originalResult = stream.result.bind(stream);
  stream.result = async () => {
    const result = await originalResult();
    recordTotal(Date.now(), extractMessageUsage(result));
    return result;
  };

  const originalAsyncIterator = stream[Symbol.asyncIterator].bind(stream);
  (stream as { [Symbol.asyncIterator]: typeof originalAsyncIterator })[Symbol.asyncIterator] =
    function () {
      const iterator = originalAsyncIterator();
      return {
        async next() {
          const result = await iterator.next();
          if (!result.done) {
            const event = result.value as
              | {
                  type?: string;
                  message?: unknown;
                  error?: unknown;
                }
              | undefined;
            recordTtft(Date.now());
            if (event?.type === "done") {
              recordTotal(Date.now(), extractMessageUsage(event.message));
            }
          } else {
            recordTotal(Date.now());
          }
          return result;
        },
        async return(value?: unknown) {
          return iterator.return?.(value) ?? { done: true as const, value: undefined };
        },
        async throw(error?: unknown) {
          return iterator.throw?.(error) ?? { done: true as const, value: undefined };
        },
      };
    };

  return stream;
}

export function wrapStreamFnLlmInference(baseFn: StreamFn, trace: LlmInferenceTrace): StreamFn {
  return (model, context, options) => {
    const requestStartedAt = Date.now();
    const nextTrace: LlmInferenceTrace = {
      ...trace,
      provider: model.provider,
      model: model.id,
      transport: trace.transport ?? `${String(model.api ?? "sdk")}-stream`,
    };
    const maybeStream = baseFn(model, context, options);
    const wrapResolved = (stream: ReturnType<typeof streamSimple>) =>
      wrapLlmInferenceTrace(stream, { requestStartedAt, trace: nextTrace });
    if (maybeStream && typeof maybeStream === "object" && "then" in maybeStream) {
      return Promise.resolve(maybeStream).then(wrapResolved);
    }
    return wrapResolved(maybeStream);
  };
}
