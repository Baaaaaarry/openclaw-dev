import fs from "node:fs";
import path from "node:path";
import { getQueuedFileWriter, type QueuedFileWriter } from "../agents/queued-file-writer.js";
import type { OpenClawConfig } from "../config/config.js";
import { resolveStateDir } from "../config/paths.js";
import { resolveUserPath } from "../utils.js";
import { parseBooleanValue } from "../utils/boolean.js";
import type { DiagnosticEventPayload, DiagnosticLatencySegmentEvent } from "./diagnostic-events.js";
import { onDiagnosticEvent } from "./diagnostic-events.js";

const writers = new Map<string, QueuedFileWriter>();
const DEFAULT_LATENCY_TRACE_FILENAME = "latency-segments.jsonl";

type LatencyTracePersistState = {
  filePath?: string;
  stop?: () => void;
};

function getState(): LatencyTracePersistState {
  const globalStore = globalThis as typeof globalThis & {
    __openclawLatencyTracePersistState?: LatencyTracePersistState;
  };
  if (!globalStore.__openclawLatencyTracePersistState) {
    globalStore.__openclawLatencyTracePersistState = {};
  }
  return globalStore.__openclawLatencyTracePersistState;
}

export function resolveLatencyTraceFilePath(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.OPENCLAW_LATENCY_TRACE_FILE?.trim();
  if (override) {
    const resolved = resolveUserPath(override);
    const normalized = resolved.replace(/[/\\]+$/, "");
    try {
      if (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()) {
        return path.join(resolved, DEFAULT_LATENCY_TRACE_FILENAME);
      }
    } catch {
      // ignore and fall back to direct path handling
    }
    try {
      if (
        normalized !== resolved &&
        fs.existsSync(normalized) &&
        fs.statSync(normalized).isDirectory()
      ) {
        return path.join(normalized, DEFAULT_LATENCY_TRACE_FILENAME);
      }
    } catch {
      // ignore and fall back to direct path handling
    }
    return resolved;
  }
  return path.join(resolveStateDir(env), "logs", DEFAULT_LATENCY_TRACE_FILENAME);
}

export function isLatencyTracePersistEnabled(
  _cfg?: OpenClawConfig,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return parseBooleanValue(env.OPENCLAW_LATENCY_TRACE) ?? false;
}

export function buildLatencyCorrelationKey(
  evt: Pick<
    DiagnosticLatencySegmentEvent,
    "channel" | "accountId" | "chatId" | "messageId" | "runId" | "sessionKey" | "sessionId"
  >,
): string {
  if (evt.messageId !== undefined) {
    return [
      evt.channel ?? "unknown",
      evt.accountId ?? "default",
      evt.chatId ?? "unknown-chat",
      evt.messageId,
    ].join("|");
  }
  if (evt.runId) {
    return `run|${evt.runId}`;
  }
  if (evt.sessionKey) {
    return `sessionKey|${evt.sessionKey}`;
  }
  if (evt.sessionId) {
    return `sessionId|${evt.sessionId}`;
  }
  return [
    evt.channel ?? "unknown",
    evt.accountId ?? "default",
    evt.chatId ?? "unknown-chat",
    "unknown-message",
  ].join("|");
}

function isLatencySegmentEvent(evt: DiagnosticEventPayload): evt is DiagnosticLatencySegmentEvent {
  return evt.type === "latency.segment";
}

export function startLatencyTracePersist(
  cfg?: OpenClawConfig,
  env: NodeJS.ProcessEnv = process.env,
): void {
  if (!isLatencyTracePersistEnabled(cfg, env)) {
    return;
  }
  const state = getState();
  const filePath = resolveLatencyTraceFilePath(env);
  if (state.stop && state.filePath === filePath) {
    return;
  }
  state.stop?.();
  const writer = getQueuedFileWriter(writers, filePath);
  state.filePath = filePath;
  state.stop = onDiagnosticEvent((evt) => {
    if (!isLatencySegmentEvent(evt)) {
      return;
    }
    const persisted = {
      ...evt,
      time: new Date(evt.ts).toISOString(),
      correlationKey: buildLatencyCorrelationKey(evt),
    };
    writer.write(`${JSON.stringify(persisted)}\n`);
  });
}

export function stopLatencyTracePersist(): void {
  const state = getState();
  state.stop?.();
  state.stop = undefined;
  state.filePath = undefined;
}
