import fs from "node:fs";
import type { DiagnosticLatencySegmentEvent } from "./diagnostic-events.js";
import type { HardwareTraceSample } from "./hardware-trace.js";
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
  t5InputTokens?: number;
  t5OutputTokens?: number;
  t5CacheReadTokens?: number;
  t5CacheWriteTokens?: number;
  t5TotalTokens?: number;
  t5PrefillTokensPerSec?: number;
  t5DecodeTokensPerSec?: number;
  t5TotalTokensPerSec?: number;
  t5PrefillMsPer1kInputTokens?: number;
  t5DecodeMsPerOutputToken?: number;
  t5WindowStartedAtMs?: number;
  t5WindowEndedAtMs?: number;
  hardwareSampleCount?: number;
  hardwareCpuUtilAvgPct?: number;
  hardwareMemUtilAvgPct?: number;
  hardwareGpuUtilAvgPct?: number;
  hardwareGpuMemUtilAvgPct?: number;
  hardwareGpuPowerAvgW?: number;
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

function calculateRate(
  numerator: number | undefined,
  denominatorMs: number | undefined,
): number | undefined {
  if (
    typeof numerator !== "number" ||
    !Number.isFinite(numerator) ||
    numerator <= 0 ||
    typeof denominatorMs !== "number" ||
    !Number.isFinite(denominatorMs) ||
    denominatorMs <= 0
  ) {
    return undefined;
  }
  return (numerator * 1000) / denominatorMs;
}

function calculateMsPer1kTokens(
  ms: number | undefined,
  tokens: number | undefined,
): number | undefined {
  if (
    typeof ms !== "number" ||
    !Number.isFinite(ms) ||
    ms <= 0 ||
    typeof tokens !== "number" ||
    !Number.isFinite(tokens) ||
    tokens <= 0
  ) {
    return undefined;
  }
  return (ms * 1000) / tokens;
}

function calculateMsPerToken(
  ms: number | undefined,
  tokens: number | undefined,
): number | undefined {
  if (
    typeof ms !== "number" ||
    !Number.isFinite(ms) ||
    ms <= 0 ||
    typeof tokens !== "number" ||
    !Number.isFinite(tokens) ||
    tokens <= 0
  ) {
    return undefined;
  }
  return ms / tokens;
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

  summary.t5PrefillTokensPerSec = calculateRate(summary.t5InputTokens, summary.t5LlmPrefillMs);
  summary.t5DecodeTokensPerSec = calculateRate(summary.t5OutputTokens, summary.t5LlmDecodeMs);
  summary.t5TotalTokensPerSec = calculateRate(summary.t5TotalTokens, summary.t5LlmTotalMs);
  summary.t5PrefillMsPer1kInputTokens = calculateMsPer1kTokens(
    summary.t5LlmPrefillMs,
    summary.t5InputTokens,
  );
  summary.t5DecodeMsPerOutputToken = calculateMsPerToken(
    summary.t5LlmDecodeMs,
    summary.t5OutputTokens,
  );
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
        if (
          typeof record.startedAtMs === "number" &&
          Number.isFinite(record.startedAtMs) &&
          (summary.t5WindowStartedAtMs === undefined ||
            record.startedAtMs < summary.t5WindowStartedAtMs)
        ) {
          summary.t5WindowStartedAtMs = record.startedAtMs;
        }
        if (
          typeof record.endedAtMs === "number" &&
          Number.isFinite(record.endedAtMs) &&
          (summary.t5WindowEndedAtMs === undefined || record.endedAtMs > summary.t5WindowEndedAtMs)
        ) {
          summary.t5WindowEndedAtMs = record.endedAtMs;
        }
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
      const inputTokens =
        toFiniteNumber(record.inputTokens) ?? toFiniteNumber(record.promptEvalCount);
      const outputTokens = toFiniteNumber(record.outputTokens) ?? toFiniteNumber(record.evalCount);
      const totalTokens =
        toFiniteNumber(record.totalTokens) ??
        ((inputTokens ?? 0) + (outputTokens ?? 0) || undefined);
      summary.t5InputTokens = addMaybeNumber(summary.t5InputTokens, inputTokens);
      summary.t5OutputTokens = addMaybeNumber(summary.t5OutputTokens, outputTokens);
      summary.t5CacheReadTokens = addMaybeNumber(
        summary.t5CacheReadTokens,
        toFiniteNumber(record.cacheReadTokens),
      );
      summary.t5CacheWriteTokens = addMaybeNumber(
        summary.t5CacheWriteTokens,
        toFiniteNumber(record.cacheWriteTokens),
      );
      summary.t5TotalTokens = addMaybeNumber(summary.t5TotalTokens, totalTokens);
      if (
        typeof record.startedAtMs === "number" &&
        Number.isFinite(record.startedAtMs) &&
        (summary.t5WindowStartedAtMs === undefined ||
          record.startedAtMs < summary.t5WindowStartedAtMs)
      ) {
        summary.t5WindowStartedAtMs = record.startedAtMs;
      }
      if (
        typeof record.endedAtMs === "number" &&
        Number.isFinite(record.endedAtMs) &&
        (summary.t5WindowEndedAtMs === undefined || record.endedAtMs > summary.t5WindowEndedAtMs)
      ) {
        summary.t5WindowEndedAtMs = record.endedAtMs;
      }
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
  hardwareSamples?: HardwareTraceSample[],
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
  if (hardwareSamples && hardwareSamples.length > 0) {
    correlateHardwareSamples(messages, hardwareSamples);
  }
  return {
    recordsScanned: records.length,
    messages,
    series: buildSeriesSummary(messages),
  };
}

function correlateHardwareSamples(
  messages: LatencyMessageSummary[],
  hardwareSamples: HardwareTraceSample[],
): void {
  const sortedSamples = [...hardwareSamples].toSorted((a, b) => a.epochMs - b.epochMs);
  for (const message of messages) {
    if (
      typeof message.t5WindowStartedAtMs !== "number" ||
      typeof message.t5WindowEndedAtMs !== "number" ||
      message.t5WindowEndedAtMs < message.t5WindowStartedAtMs
    ) {
      continue;
    }
    const windowSamples = sortedSamples.filter(
      (sample) =>
        sample.epochMs >= message.t5WindowStartedAtMs! &&
        sample.epochMs <= message.t5WindowEndedAtMs!,
    );
    if (windowSamples.length === 0) {
      continue;
    }
    let cpuSum = 0;
    let cpuCount = 0;
    let memSum = 0;
    let gpuUtilSum = 0;
    let gpuUtilCount = 0;
    let gpuMemUtilSum = 0;
    let gpuMemUtilCount = 0;
    let gpuPowerSum = 0;
    let gpuPowerCount = 0;
    for (const sample of windowSamples) {
      if (typeof sample.cpuUtilPct === "number") {
        cpuSum += sample.cpuUtilPct;
        cpuCount += 1;
      }
      memSum += sample.memUtilPct;
      if (Array.isArray(sample.gpus) && sample.gpus.length > 0) {
        const maxGpuUtil = sample.gpus
          .map((gpu) => gpu.utilizationGpuPct)
          .filter((value): value is number => typeof value === "number" && Number.isFinite(value))
          .reduce<number | undefined>(
            (max, value) => (max === undefined || value > max ? value : max),
            undefined,
          );
        if (typeof maxGpuUtil === "number") {
          gpuUtilSum += maxGpuUtil;
          gpuUtilCount += 1;
        }
        const maxGpuMemUtil = sample.gpus
          .map((gpu) =>
            typeof gpu.memoryUsedMiB === "number" &&
            typeof gpu.memoryTotalMiB === "number" &&
            gpu.memoryTotalMiB > 0
              ? (gpu.memoryUsedMiB / gpu.memoryTotalMiB) * 100
              : undefined,
          )
          .filter((value): value is number => typeof value === "number" && Number.isFinite(value))
          .reduce<number | undefined>(
            (max, value) => (max === undefined || value > max ? value : max),
            undefined,
          );
        if (typeof maxGpuMemUtil === "number") {
          gpuMemUtilSum += maxGpuMemUtil;
          gpuMemUtilCount += 1;
        }
        const totalPower = sample.gpus
          .map((gpu) => gpu.powerDrawW)
          .filter((value): value is number => typeof value === "number" && Number.isFinite(value))
          .reduce((sum, value) => sum + value, 0);
        if (totalPower > 0) {
          gpuPowerSum += totalPower;
          gpuPowerCount += 1;
        }
      }
    }
    message.hardwareSampleCount = windowSamples.length;
    message.hardwareCpuUtilAvgPct = cpuCount > 0 ? cpuSum / cpuCount : undefined;
    message.hardwareMemUtilAvgPct = memSum / windowSamples.length;
    message.hardwareGpuUtilAvgPct = gpuUtilCount > 0 ? gpuUtilSum / gpuUtilCount : undefined;
    message.hardwareGpuMemUtilAvgPct =
      gpuMemUtilCount > 0 ? gpuMemUtilSum / gpuMemUtilCount : undefined;
    message.hardwareGpuPowerAvgW = gpuPowerCount > 0 ? gpuPowerSum / gpuPowerCount : undefined;
  }
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
    ["t5InputTokens", "t5_llm_input_tokens"],
    ["t5OutputTokens", "t5_llm_output_tokens"],
    ["t5CacheReadTokens", "t5_llm_cache_read_tokens"],
    ["t5CacheWriteTokens", "t5_llm_cache_write_tokens"],
    ["t5TotalTokens", "t5_llm_total_tokens"],
    ["t5PrefillTokensPerSec", "t5_llm_prefill_tps"],
    ["t5DecodeTokensPerSec", "t5_llm_decode_tps"],
    ["t5TotalTokensPerSec", "t5_llm_total_tps"],
    ["t5PrefillMsPer1kInputTokens", "t5_llm_prefill_ms_per_1k_input_tokens"],
    ["t5DecodeMsPerOutputToken", "t5_llm_decode_ms_per_output_token"],
    ["hardwareSampleCount", "hardware_sample_count"],
    ["hardwareCpuUtilAvgPct", "hardware_cpu_util_avg_pct"],
    ["hardwareMemUtilAvgPct", "hardware_mem_util_avg_pct"],
    ["hardwareGpuUtilAvgPct", "hardware_gpu_util_avg_pct"],
    ["hardwareGpuMemUtilAvgPct", "hardware_gpu_mem_util_avg_pct"],
    ["hardwareGpuPowerAvgW", "hardware_gpu_power_avg_w"],
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

function seriesFormatter(name: string): (value: number | undefined) => string {
  if (isCountSeries(name) || name.endsWith("_tokens")) {
    return formatCount;
  }
  if (name.endsWith("_tps")) {
    return formatCount;
  }
  if (name.endsWith("_pct")) {
    return formatPct;
  }
  if (name.endsWith("_avg_w")) {
    return formatWatts;
  }
  return formatMs;
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

function formatPct(value: number | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "-";
  }
  return `${value.toFixed(1)}%`;
}

function formatWatts(value: number | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "-";
  }
  return `${value.toFixed(1)}W`;
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
        `T5.input.sum=${formatCount(message.t5InputTokens)}`,
        `T5.output.sum=${formatCount(message.t5OutputTokens)}`,
        `T5.totalTokens.sum=${formatCount(message.t5TotalTokens)}`,
        `T5.prefill.tps=${formatCount(message.t5PrefillTokensPerSec)}`,
        `T5.decode.tps=${formatCount(message.t5DecodeTokensPerSec)}`,
        `T5.total.tps=${formatCount(message.t5TotalTokensPerSec)}`,
        `T5.prefill.ms/1kIn=${formatMs(message.t5PrefillMsPer1kInputTokens)}`,
        `T5.decode.ms/out=${formatMs(message.t5DecodeMsPerOutputToken)}`,
        `HW.samples=${formatCount(message.hardwareSampleCount)}`,
        `HW.cpu.avg=${formatPct(message.hardwareCpuUtilAvgPct)}`,
        `HW.mem.avg=${formatPct(message.hardwareMemUtilAvgPct)}`,
        `HW.gpu.avg=${formatPct(message.hardwareGpuUtilAvgPct)}`,
        `HW.gpuMem.avg=${formatPct(message.hardwareGpuMemUtilAvgPct)}`,
        `HW.gpuPower.avg=${formatWatts(message.hardwareGpuPowerAvgW)}`,
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
    const formatter = seriesFormatter(name);
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
