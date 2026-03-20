import fs from "node:fs";
import type { DiagnosticLatencySegmentEvent } from "./diagnostic-events.js";
import { buildLatencyCorrelationKey } from "./latency-trace-persist.js";

export type PersistedLatencySegmentRecord = DiagnosticLatencySegmentEvent & {
  time?: string;
  correlationKey?: string;
};

export type LatencyMessageSummary = {
  key: string;
  channel?: string;
  accountId?: string;
  chatId?: number | string;
  messageId?: number | string;
  sessionKey?: string;
  sessionId?: string;
  runId?: string;
  provider?: string;
  model?: string;
  t1FeishuInboundMs?: number;
  t2GatewayEnqueueMs?: number;
  t3WorkerQueueWaitMs?: number;
  t4AgentPreprocessMs?: number;
  t5LlmCallCount?: number;
  t5LlmTtftMs?: number;
  t5LlmTtftSumMs?: number;
  t5LlmTotalMs?: number;
  t5LlmLoadMs?: number;
  t5LlmPrefillMs?: number;
  t5LlmDecodeMs?: number;
  t6FeishuFirstAckMs?: number;
  t6FeishuFinalAckMs?: number;
  localFirstVisibleMs?: number;
  localCompleteMs?: number;
};

export type SeriesSummary = {
  count: number;
  avg?: number;
  p95?: number;
  p99?: number;
  min?: number;
  max?: number;
};

export type LatencyAggregateReport = {
  recordsScanned: number;
  messages: LatencyMessageSummary[];
  series: Record<string, SeriesSummary>;
};

function toFiniteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function parseRecord(line: string): PersistedLatencySegmentRecord | null {
  try {
    const parsed = JSON.parse(line) as PersistedLatencySegmentRecord;
    if (parsed?.type !== "latency.segment" || typeof parsed.segment !== "string") {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function readLatencyTraceJsonl(file: string): PersistedLatencySegmentRecord[] {
  if (!fs.existsSync(file)) {
    return [];
  }
  return parseLatencyTraceJsonl(fs.readFileSync(file, "utf8"));
}

export function parseLatencyTraceJsonl(content: string): PersistedLatencySegmentRecord[] {
  return content
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map(parseRecord)
    .filter((entry): entry is PersistedLatencySegmentRecord => Boolean(entry));
}

function resolveRecordKey(record: PersistedLatencySegmentRecord): string {
  return record.correlationKey ?? buildLatencyCorrelationKey(record);
}

function addMaybeNumber(current: number | undefined, next: number | undefined): number | undefined {
  if (typeof next !== "number" || !Number.isFinite(next)) {
    return current;
  }
  return (current ?? 0) + next;
}

function recalculateDerived(summary: LatencyMessageSummary): void {
  const firstVisibleParts = [
    summary.t1FeishuInboundMs,
    summary.t2GatewayEnqueueMs,
    summary.t3WorkerQueueWaitMs,
    summary.t4AgentPreprocessMs,
    summary.t5LlmTtftMs,
    summary.t6FeishuFirstAckMs,
  ];
  if (firstVisibleParts.every((value) => typeof value === "number" && Number.isFinite(value))) {
    summary.localFirstVisibleMs = (firstVisibleParts as number[]).reduce(
      (sum, value) => sum + value,
      0,
    );
  }

  const completeParts = [
    summary.t1FeishuInboundMs,
    summary.t2GatewayEnqueueMs,
    summary.t3WorkerQueueWaitMs,
    summary.t4AgentPreprocessMs,
    summary.t5LlmTotalMs,
    summary.t6FeishuFinalAckMs,
  ];
  if (completeParts.every((value) => typeof value === "number" && Number.isFinite(value))) {
    summary.localCompleteMs = (completeParts as number[]).reduce((sum, value) => sum + value, 0);
  }
}

function applySegment(summary: LatencyMessageSummary, record: PersistedLatencySegmentRecord): void {
  switch (record.segment) {
    case "t1_feishu_inbound":
      summary.t1FeishuInboundMs = record.durationMs;
      return;
    case "t2_gateway_enqueue":
      summary.t2GatewayEnqueueMs = record.durationMs;
      return;
    case "t3_worker_queue_wait":
      summary.t3WorkerQueueWaitMs = record.durationMs;
      return;
    case "t4_agent_preprocess":
      summary.t4AgentPreprocessMs = record.durationMs;
      return;
    case "t5_llm_inference":
    case "t5_ollama_inference":
      if (record.stage === "ttft") {
        summary.t5LlmTtftMs ??= record.durationMs;
        summary.t5LlmTtftSumMs = addMaybeNumber(summary.t5LlmTtftSumMs, record.durationMs);
        return;
      }
      summary.t5LlmCallCount = (summary.t5LlmCallCount ?? 0) + 1;
      summary.t5LlmTotalMs = addMaybeNumber(
        summary.t5LlmTotalMs,
        record.totalMs ?? record.durationMs,
      );
      summary.t5LlmLoadMs = addMaybeNumber(summary.t5LlmLoadMs, toFiniteNumber(record.loadMs));
      summary.t5LlmPrefillMs = addMaybeNumber(
        summary.t5LlmPrefillMs,
        toFiniteNumber(record.promptEvalMs),
      );
      summary.t5LlmDecodeMs = addMaybeNumber(summary.t5LlmDecodeMs, toFiniteNumber(record.evalMs));
      summary.t5LlmTtftMs = summary.t5LlmTtftMs ?? toFiniteNumber(record.ttftMs);
      return;
    case "t6_feishu_return":
      if (record.stage === "first_ack") {
        summary.t6FeishuFirstAckMs = record.durationMs;
      }
      if (record.stage === "final_ack") {
        summary.t6FeishuFinalAckMs = record.durationMs;
      }
      return;
  }
}

export function summarizeLatencyRecords(
  records: PersistedLatencySegmentRecord[],
): LatencyAggregateReport {
  const grouped = new Map<string, LatencyMessageSummary>();

  for (const record of records) {
    const key = resolveRecordKey(record);
    const summary =
      grouped.get(key) ??
      ({
        key,
        channel: record.channel,
        accountId: record.accountId,
        chatId: record.chatId,
        messageId: record.messageId,
        sessionKey: record.sessionKey,
        sessionId: record.sessionId,
        runId: record.runId,
        provider: record.provider,
        model: record.model,
      } satisfies LatencyMessageSummary);
    summary.channel ??= record.channel;
    summary.accountId ??= record.accountId;
    summary.chatId ??= record.chatId;
    summary.messageId ??= record.messageId;
    summary.sessionKey ??= record.sessionKey;
    summary.sessionId ??= record.sessionId;
    summary.runId ??= record.runId;
    summary.provider ??= record.provider;
    summary.model ??= record.model;
    applySegment(summary, record);
    recalculateDerived(summary);
    grouped.set(key, summary);
  }

  const messages = Array.from(grouped.values()).toSorted((a, b) => a.key.localeCompare(b.key));
  return {
    recordsScanned: records.length,
    messages,
    series: buildSeriesSummary(messages),
  };
}

function percentile(values: number[], p: number): number | undefined {
  if (values.length === 0) {
    return undefined;
  }
  const sorted = [...values].toSorted((a, b) => a - b);
  const index = (sorted.length - 1) * p;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) {
    return sorted[lower];
  }
  const weight = index - lower;
  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

function summarizeSeries(values: number[]): SeriesSummary {
  if (values.length === 0) {
    return { count: 0 };
  }
  const total = values.reduce((sum, value) => sum + value, 0);
  return {
    count: values.length,
    avg: total / values.length,
    p95: percentile(values, 0.95),
    p99: percentile(values, 0.99),
    min: Math.min(...values),
    max: Math.max(...values),
  };
}

function buildSeriesSummary(messages: LatencyMessageSummary[]): Record<string, SeriesSummary> {
  const fields: Array<[keyof LatencyMessageSummary, string]> = [
    ["t1FeishuInboundMs", "t1_feishu_inbound_ms"],
    ["t2GatewayEnqueueMs", "t2_gateway_enqueue_ms"],
    ["t3WorkerQueueWaitMs", "t3_worker_queue_wait_ms"],
    ["t4AgentPreprocessMs", "t4_agent_preprocess_ms"],
    ["t5LlmCallCount", "t5_llm_call_count"],
    ["t5LlmTtftMs", "t5_llm_ttft_ms"],
    ["t5LlmTtftSumMs", "t5_llm_ttft_sum_ms"],
    ["t5LlmTotalMs", "t5_llm_total_ms"],
    ["t5LlmLoadMs", "t5_llm_load_ms"],
    ["t5LlmPrefillMs", "t5_llm_prefill_ms"],
    ["t5LlmDecodeMs", "t5_llm_decode_ms"],
    ["t6FeishuFirstAckMs", "t6_feishu_first_ack_ms"],
    ["t6FeishuFinalAckMs", "t6_feishu_final_ack_ms"],
    ["localFirstVisibleMs", "e2e_local_first_visible_ms"],
    ["localCompleteMs", "e2e_local_complete_ms"],
  ];
  const output: Record<string, SeriesSummary> = {};
  for (const [field, name] of fields) {
    const values = messages
      .map((message) => message[field])
      .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
    output[name] = summarizeSeries(values);
  }
  return output;
}

function isCountSeries(name: string): boolean {
  return name.endsWith("_count");
}

function formatMs(value: number | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "-";
  }
  return `${value.toFixed(1)}ms`;
}

function formatCount(value: number | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "-";
  }
  return String(Math.round(value));
}

export function formatLatencyReportText(report: LatencyAggregateReport): string {
  const lines: string[] = [];
  lines.push(`recordsScanned=${report.recordsScanned} messages=${report.messages.length}`);
  lines.push("");
  lines.push("Per-message Summary:");
  for (const message of report.messages) {
    lines.push(
      [
        `key=${message.key}`,
        message.channel ? `channel=${message.channel}` : undefined,
        message.messageId !== undefined ? `messageId=${message.messageId}` : undefined,
        message.runId ? `runId=${message.runId}` : undefined,
        `T1=${formatMs(message.t1FeishuInboundMs)}`,
        `T2=${formatMs(message.t2GatewayEnqueueMs)}`,
        `T3=${formatMs(message.t3WorkerQueueWaitMs)}`,
        `T4=${formatMs(message.t4AgentPreprocessMs)}`,
        `T5.calls=${formatCount(message.t5LlmCallCount)}`,
        `T5.ttft.first=${formatMs(message.t5LlmTtftMs)}`,
        `T5.ttft.sum=${formatMs(message.t5LlmTtftSumMs)}`,
        `T5.total.sum=${formatMs(message.t5LlmTotalMs)}`,
        `T5.load.sum=${formatMs(message.t5LlmLoadMs)}`,
        `T5.prefill.sum=${formatMs(message.t5LlmPrefillMs)}`,
        `T5.decode.sum=${formatMs(message.t5LlmDecodeMs)}`,
        `T6.first=${formatMs(message.t6FeishuFirstAckMs)}`,
        `T6.final=${formatMs(message.t6FeishuFinalAckMs)}`,
        `E2E.local.first=${formatMs(message.localFirstVisibleMs)}`,
        `E2E.local.complete=${formatMs(message.localCompleteMs)}`,
      ]
        .filter(Boolean)
        .join(" "),
    );
  }
  lines.push("");
  lines.push("Derived summary:");
  for (const name of ["e2e_local_first_visible_ms", "e2e_local_complete_ms"]) {
    const summary = report.series[name];
    if (!summary) {
      continue;
    }
    lines.push(
      `${name} count=${summary.count} avg=${formatMs(summary.avg)} p95=${formatMs(summary.p95)} p99=${formatMs(summary.p99)}`,
    );
  }
  lines.push("");
  lines.push("Series summary (avg/p95/p99):");
  for (const [name, summary] of Object.entries(report.series)) {
    if (name === "e2e_local_first_visible_ms" || name === "e2e_local_complete_ms") {
      continue;
    }
    const formatter = isCountSeries(name) ? formatCount : formatMs;
    lines.push(
      `${name} count=${summary.count} avg=${formatter(summary.avg)} p95=${formatter(summary.p95)} p99=${formatter(summary.p99)}`,
    );
  }
  return lines.join("\n");
}

export function filterLastRecords<T>(records: T[], last?: number): T[] {
  if (typeof last !== "number" || !Number.isFinite(last) || last <= 0) {
    return records;
  }
  return records.slice(-Math.floor(last));
}
