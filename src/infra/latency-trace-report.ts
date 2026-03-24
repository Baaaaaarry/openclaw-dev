import fs from "node:fs";
import type { DiagnosticLatencySegmentEvent } from "./diagnostic-events.js";
import type { HardwareTraceSample } from "./hardware-trace.js";
import { buildLatencyCorrelationKey } from "./latency-trace-persist.js";

export type PersistedLatencySegmentRecord = DiagnosticLatencySegmentEvent & {
  time?: string;
  correlationKey?: string;
};

export type HardwareWindowSummary = {
  sampleCount: number;
  cpuUtilAvgPct?: number;
  cpuUtilMaxPct?: number;
  memUtilAvgPct?: number;
  memUtilMaxPct?: number;
  gpuUtilAvgPct?: number;
  gpuUtilMaxPct?: number;
  gpuMemUtilAvgPct?: number;
  gpuMemUtilMaxPct?: number;
  gpuPowerAvgW?: number;
  gpuPowerMaxW?: number;
  gpuMemoryUsedAvgMiB?: number;
  gpuMemoryUsedMaxMiB?: number;
  gpuSmClockAvgMHz?: number;
  gpuSmClockMaxMHz?: number;
  gpuMemClockAvgMHz?: number;
  gpuMemClockMaxMHz?: number;
  gpuTempAvgC?: number;
  gpuTempMaxC?: number;
  computePlacement?: "cpu-biased" | "gpu-biased" | "mixed" | "unclear";
};

export type RagComparisonGroupSummary = {
  count: number;
  e2eLocalCompleteAvgMs?: number;
  e2eLocalCompleteMaxMs?: number;
  t4RagRecallAvgMs?: number;
  t4RagRecallMaxMs?: number;
  t5LlmTotalAvgMs?: number;
  t5LlmTotalMaxMs?: number;
  t5InputTokensAvg?: number;
  t5InputTokensMax?: number;
  t5DecodeTpsAvg?: number;
  t5DecodeTpsMin?: number;
  ragCpuAvgPct?: number;
  ragCpuMaxPct?: number;
  ragGpuAvgPct?: number;
  ragGpuMaxPct?: number;
  ragGpuMemUtilAvgPct?: number;
  ragGpuMemUtilMaxPct?: number;
  ragGpuPowerAvgW?: number;
  ragGpuPowerMaxW?: number;
  ragGpuMemClockAvgMHz?: number;
  ragGpuMemClockMaxMHz?: number;
  ragPlacement?: "cpu-biased" | "gpu-biased" | "mixed" | "unclear";
  llmCpuAvgPct?: number;
  llmCpuMaxPct?: number;
  llmGpuAvgPct?: number;
  llmGpuMaxPct?: number;
  llmGpuMemUtilAvgPct?: number;
  llmGpuMemUtilMaxPct?: number;
  llmGpuPowerAvgW?: number;
  llmGpuPowerMaxW?: number;
  llmGpuMemClockAvgMHz?: number;
  llmGpuMemClockMaxMHz?: number;
  llmPlacement?: "cpu-biased" | "gpu-biased" | "mixed" | "unclear";
};

export type LatencyComparisonSummary = {
  rag: RagComparisonGroupSummary;
  noRag: RagComparisonGroupSummary;
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
  t4RagRecallMs?: number;
  t4RagRecallResults?: number;
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
  overallWindowStartedAtMs?: number;
  overallWindowEndedAtMs?: number;
  ragWindowStartedAtMs?: number;
  ragWindowEndedAtMs?: number;
  ragUsed?: boolean;
  hardwareOverall?: HardwareWindowSummary;
  hardwareRag?: HardwareWindowSummary;
  hardwareLlm?: HardwareWindowSummary;
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
  comparisons: {
    ragVsNoRag: LatencyComparisonSummary;
  };
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
  summary.ragUsed =
    typeof summary.t4RagRecallMs === "number" && Number.isFinite(summary.t4RagRecallMs);
}

function updateOverallWindow(
  summary: LatencyMessageSummary,
  record: Pick<PersistedLatencySegmentRecord, "startedAtMs" | "endedAtMs">,
): void {
  if (
    typeof record.startedAtMs === "number" &&
    Number.isFinite(record.startedAtMs) &&
    (summary.overallWindowStartedAtMs === undefined ||
      record.startedAtMs < summary.overallWindowStartedAtMs)
  ) {
    summary.overallWindowStartedAtMs = record.startedAtMs;
  }
  if (
    typeof record.endedAtMs === "number" &&
    Number.isFinite(record.endedAtMs) &&
    (summary.overallWindowEndedAtMs === undefined ||
      record.endedAtMs > summary.overallWindowEndedAtMs)
  ) {
    summary.overallWindowEndedAtMs = record.endedAtMs;
  }
}

function applySegment(summary: LatencyMessageSummary, record: PersistedLatencySegmentRecord): void {
  updateOverallWindow(summary, record);
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
      if (record.stage === "rag_recall") {
        summary.t4RagRecallMs = record.durationMs;
        summary.t4RagRecallResults =
          toFiniteNumber(record.totalTokens) ?? toFiniteNumber(record.outputTokens) ?? 0;
        if (
          typeof record.startedAtMs === "number" &&
          Number.isFinite(record.startedAtMs) &&
          (summary.ragWindowStartedAtMs === undefined ||
            record.startedAtMs < summary.ragWindowStartedAtMs)
        ) {
          summary.ragWindowStartedAtMs = record.startedAtMs;
        }
        if (
          typeof record.endedAtMs === "number" &&
          Number.isFinite(record.endedAtMs) &&
          (summary.ragWindowEndedAtMs === undefined ||
            record.endedAtMs > summary.ragWindowEndedAtMs)
        ) {
          summary.ragWindowEndedAtMs = record.endedAtMs;
        }
        return;
      }
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
    comparisons: {
      ragVsNoRag: buildRagComparison(messages),
    },
  };
}

function correlateHardwareSamples(
  messages: LatencyMessageSummary[],
  hardwareSamples: HardwareTraceSample[],
): void {
  const sortedSamples = [...hardwareSamples].toSorted((a, b) => a.epochMs - b.epochMs);
  for (const message of messages) {
    message.hardwareOverall = summarizeHardwareWindow(
      sortedSamples,
      message.overallWindowStartedAtMs,
      message.overallWindowEndedAtMs,
    );
    message.hardwareRag = summarizeHardwareWindow(
      sortedSamples,
      message.ragWindowStartedAtMs,
      message.ragWindowEndedAtMs,
    );
    message.hardwareLlm = summarizeHardwareWindow(
      sortedSamples,
      message.t5WindowStartedAtMs,
      message.t5WindowEndedAtMs,
    );
    message.hardwareSampleCount = message.hardwareLlm?.sampleCount;
    message.hardwareCpuUtilAvgPct = message.hardwareLlm?.cpuUtilAvgPct;
    message.hardwareMemUtilAvgPct = message.hardwareLlm?.memUtilAvgPct;
    message.hardwareGpuUtilAvgPct = message.hardwareLlm?.gpuUtilAvgPct;
    message.hardwareGpuMemUtilAvgPct = message.hardwareLlm?.gpuMemUtilAvgPct;
    message.hardwareGpuPowerAvgW = message.hardwareLlm?.gpuPowerAvgW;
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

function average(values: number[]): number | undefined {
  if (values.length === 0) {
    return undefined;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function maxMaybe(values: number[]): number | undefined {
  if (values.length === 0) {
    return undefined;
  }
  return Math.max(...values);
}

function deriveGpuUtil(sample: HardwareTraceSample): number | undefined {
  return maxMaybe(
    (sample.gpus ?? [])
      .map((gpu) => gpu.utilizationGpuPct)
      .filter((value): value is number => typeof value === "number" && Number.isFinite(value)),
  );
}

function deriveGpuMemUtil(sample: HardwareTraceSample): number | undefined {
  return maxMaybe(
    (sample.gpus ?? [])
      .map((gpu) =>
        typeof gpu.memoryUsedMiB === "number" &&
        typeof gpu.memoryTotalMiB === "number" &&
        gpu.memoryTotalMiB > 0
          ? (gpu.memoryUsedMiB / gpu.memoryTotalMiB) * 100
          : typeof gpu.utilizationMemPct === "number" && Number.isFinite(gpu.utilizationMemPct)
            ? gpu.utilizationMemPct
            : undefined,
      )
      .filter((value): value is number => typeof value === "number" && Number.isFinite(value)),
  );
}

function deriveGpuPower(sample: HardwareTraceSample): number | undefined {
  const values = (sample.gpus ?? [])
    .map((gpu) => gpu.powerDrawW)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (values.length === 0) {
    return undefined;
  }
  return values.reduce((sum, value) => sum + value, 0);
}

function deriveGpuMemoryUsed(sample: HardwareTraceSample): number | undefined {
  const values = (sample.gpus ?? [])
    .map((gpu) => gpu.memoryUsedMiB)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (values.length === 0) {
    return undefined;
  }
  return values.reduce((sum, value) => sum + value, 0);
}

function deriveGpuClock(
  sample: HardwareTraceSample,
  field: "smClockMHz" | "memClockMHz",
): number | undefined {
  return maxMaybe(
    (sample.gpus ?? [])
      .map((gpu) => gpu[field])
      .filter((value): value is number => typeof value === "number" && Number.isFinite(value)),
  );
}

function deriveGpuTemp(sample: HardwareTraceSample): number | undefined {
  return maxMaybe(
    (sample.gpus ?? [])
      .map((gpu) => gpu.temperatureC)
      .filter((value): value is number => typeof value === "number" && Number.isFinite(value)),
  );
}

function classifyComputePlacement(
  summary: HardwareWindowSummary,
): HardwareWindowSummary["computePlacement"] {
  const cpu = summary.cpuUtilAvgPct ?? 0;
  const gpu = summary.gpuUtilAvgPct ?? 0;
  const power = summary.gpuPowerAvgW ?? 0;
  if (summary.sampleCount === 0) {
    return "unclear";
  }
  if (gpu >= 25 && (gpu >= cpu || power >= 20)) {
    return "gpu-biased";
  }
  if (cpu >= 20 && gpu < 10 && power < 15) {
    return "cpu-biased";
  }
  if (cpu > 0 || gpu > 0 || power > 0) {
    return "mixed";
  }
  return "unclear";
}

function summarizeHardwareWindow(
  samples: HardwareTraceSample[],
  startedAtMs?: number,
  endedAtMs?: number,
): HardwareWindowSummary | undefined {
  if (
    typeof startedAtMs !== "number" ||
    typeof endedAtMs !== "number" ||
    !Number.isFinite(startedAtMs) ||
    !Number.isFinite(endedAtMs) ||
    endedAtMs < startedAtMs
  ) {
    return undefined;
  }
  const windowSamples = samples.filter(
    (sample) => sample.epochMs >= startedAtMs && sample.epochMs <= endedAtMs,
  );
  if (windowSamples.length === 0) {
    return undefined;
  }
  const cpuValues = windowSamples
    .map((sample) => sample.cpuUtilPct)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  const memValues = windowSamples
    .map((sample) => sample.memUtilPct)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  const gpuUtilValues = windowSamples
    .map((sample) => deriveGpuUtil(sample))
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  const gpuMemValues = windowSamples
    .map((sample) => deriveGpuMemUtil(sample))
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  const gpuPowerValues = windowSamples
    .map((sample) => deriveGpuPower(sample))
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  const gpuMemoryUsedValues = windowSamples
    .map((sample) => deriveGpuMemoryUsed(sample))
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  const gpuSmClockValues = windowSamples
    .map((sample) => deriveGpuClock(sample, "smClockMHz"))
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  const gpuMemClockValues = windowSamples
    .map((sample) => deriveGpuClock(sample, "memClockMHz"))
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  const gpuTempValues = windowSamples
    .map((sample) => deriveGpuTemp(sample))
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  const summary: HardwareWindowSummary = {
    sampleCount: windowSamples.length,
    cpuUtilAvgPct: average(cpuValues),
    cpuUtilMaxPct: maxMaybe(cpuValues),
    memUtilAvgPct: average(memValues),
    memUtilMaxPct: maxMaybe(memValues),
    gpuUtilAvgPct: average(gpuUtilValues),
    gpuUtilMaxPct: maxMaybe(gpuUtilValues),
    gpuMemUtilAvgPct: average(gpuMemValues),
    gpuMemUtilMaxPct: maxMaybe(gpuMemValues),
    gpuPowerAvgW: average(gpuPowerValues),
    gpuPowerMaxW: maxMaybe(gpuPowerValues),
    gpuMemoryUsedAvgMiB: average(gpuMemoryUsedValues),
    gpuMemoryUsedMaxMiB: maxMaybe(gpuMemoryUsedValues),
    gpuSmClockAvgMHz: average(gpuSmClockValues),
    gpuSmClockMaxMHz: maxMaybe(gpuSmClockValues),
    gpuMemClockAvgMHz: average(gpuMemClockValues),
    gpuMemClockMaxMHz: maxMaybe(gpuMemClockValues),
    gpuTempAvgC: average(gpuTempValues),
    gpuTempMaxC: maxMaybe(gpuTempValues),
  };
  summary.computePlacement = classifyComputePlacement(summary);
  return summary;
}

function buildPlacementFromWindowValues(params: {
  count: number;
  cpuAvgPct?: number;
  gpuAvgPct?: number;
  gpuPowerAvgW?: number;
}): HardwareWindowSummary["computePlacement"] {
  return classifyComputePlacement({
    sampleCount: params.count,
    cpuUtilAvgPct: params.cpuAvgPct,
    gpuUtilAvgPct: params.gpuAvgPct,
    gpuPowerAvgW: params.gpuPowerAvgW,
  });
}

function buildRagComparisonGroup(messages: LatencyMessageSummary[]): RagComparisonGroupSummary {
  const e2eLocalCompleteValues = messages
    .map((message) => message.localCompleteMs)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  const t4RagRecallValues = messages
    .map((message) => message.t4RagRecallMs)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  const t5LlmTotalValues = messages
    .map((message) => message.t5LlmTotalMs)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  const t5InputTokenValues = messages
    .map((message) => message.t5InputTokens)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  const t5DecodeTpsValues = messages
    .map((message) => message.t5DecodeTokensPerSec)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));

  const ragCpuAvgValues = messages
    .map((message) => message.hardwareRag?.cpuUtilAvgPct)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  const ragCpuMaxValues = messages
    .map((message) => message.hardwareRag?.cpuUtilMaxPct)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  const ragGpuAvgValues = messages
    .map((message) => message.hardwareRag?.gpuUtilAvgPct)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  const ragGpuMaxValues = messages
    .map((message) => message.hardwareRag?.gpuUtilMaxPct)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  const ragGpuMemAvgValues = messages
    .map((message) => message.hardwareRag?.gpuMemUtilAvgPct)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  const ragGpuMemMaxValues = messages
    .map((message) => message.hardwareRag?.gpuMemUtilMaxPct)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  const ragGpuPowerAvgValues = messages
    .map((message) => message.hardwareRag?.gpuPowerAvgW)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  const ragGpuPowerMaxValues = messages
    .map((message) => message.hardwareRag?.gpuPowerMaxW)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  const ragGpuMemClockAvgValues = messages
    .map((message) => message.hardwareRag?.gpuMemClockAvgMHz)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  const ragGpuMemClockMaxValues = messages
    .map((message) => message.hardwareRag?.gpuMemClockMaxMHz)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));

  const llmCpuAvgValues = messages
    .map((message) => message.hardwareLlm?.cpuUtilAvgPct)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  const llmCpuMaxValues = messages
    .map((message) => message.hardwareLlm?.cpuUtilMaxPct)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  const llmGpuAvgValues = messages
    .map((message) => message.hardwareLlm?.gpuUtilAvgPct)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  const llmGpuMaxValues = messages
    .map((message) => message.hardwareLlm?.gpuUtilMaxPct)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  const llmGpuMemAvgValues = messages
    .map((message) => message.hardwareLlm?.gpuMemUtilAvgPct)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  const llmGpuMemMaxValues = messages
    .map((message) => message.hardwareLlm?.gpuMemUtilMaxPct)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  const llmGpuPowerAvgValues = messages
    .map((message) => message.hardwareLlm?.gpuPowerAvgW)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  const llmGpuPowerMaxValues = messages
    .map((message) => message.hardwareLlm?.gpuPowerMaxW)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  const llmGpuMemClockAvgValues = messages
    .map((message) => message.hardwareLlm?.gpuMemClockAvgMHz)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  const llmGpuMemClockMaxValues = messages
    .map((message) => message.hardwareLlm?.gpuMemClockMaxMHz)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));

  const ragCpuAvgPct = average(ragCpuAvgValues);
  const ragGpuAvgPct = average(ragGpuAvgValues);
  const ragGpuPowerAvgW = average(ragGpuPowerAvgValues);
  const llmCpuAvgPct = average(llmCpuAvgValues);
  const llmGpuAvgPct = average(llmGpuAvgValues);
  const llmGpuPowerAvgW = average(llmGpuPowerAvgValues);

  return {
    count: messages.length,
    e2eLocalCompleteAvgMs: average(e2eLocalCompleteValues),
    e2eLocalCompleteMaxMs: maxMaybe(e2eLocalCompleteValues),
    t4RagRecallAvgMs: average(t4RagRecallValues),
    t4RagRecallMaxMs: maxMaybe(t4RagRecallValues),
    t5LlmTotalAvgMs: average(t5LlmTotalValues),
    t5LlmTotalMaxMs: maxMaybe(t5LlmTotalValues),
    t5InputTokensAvg: average(t5InputTokenValues),
    t5InputTokensMax: maxMaybe(t5InputTokenValues),
    t5DecodeTpsAvg: average(t5DecodeTpsValues),
    t5DecodeTpsMin: t5DecodeTpsValues.length > 0 ? Math.min(...t5DecodeTpsValues) : undefined,
    ragCpuAvgPct,
    ragCpuMaxPct: maxMaybe(ragCpuMaxValues),
    ragGpuAvgPct,
    ragGpuMaxPct: maxMaybe(ragGpuMaxValues),
    ragGpuMemUtilAvgPct: average(ragGpuMemAvgValues),
    ragGpuMemUtilMaxPct: maxMaybe(ragGpuMemMaxValues),
    ragGpuPowerAvgW,
    ragGpuPowerMaxW: maxMaybe(ragGpuPowerMaxValues),
    ragGpuMemClockAvgMHz: average(ragGpuMemClockAvgValues),
    ragGpuMemClockMaxMHz: maxMaybe(ragGpuMemClockMaxValues),
    ragPlacement: buildPlacementFromWindowValues({
      count: messages.length,
      cpuAvgPct: ragCpuAvgPct,
      gpuAvgPct: ragGpuAvgPct,
      gpuPowerAvgW: ragGpuPowerAvgW,
    }),
    llmCpuAvgPct,
    llmCpuMaxPct: maxMaybe(llmCpuMaxValues),
    llmGpuAvgPct,
    llmGpuMaxPct: maxMaybe(llmGpuMaxValues),
    llmGpuMemUtilAvgPct: average(llmGpuMemAvgValues),
    llmGpuMemUtilMaxPct: maxMaybe(llmGpuMemMaxValues),
    llmGpuPowerAvgW,
    llmGpuPowerMaxW: maxMaybe(llmGpuPowerMaxValues),
    llmGpuMemClockAvgMHz: average(llmGpuMemClockAvgValues),
    llmGpuMemClockMaxMHz: maxMaybe(llmGpuMemClockMaxValues),
    llmPlacement: buildPlacementFromWindowValues({
      count: messages.length,
      cpuAvgPct: llmCpuAvgPct,
      gpuAvgPct: llmGpuAvgPct,
      gpuPowerAvgW: llmGpuPowerAvgW,
    }),
  };
}

function buildRagComparison(messages: LatencyMessageSummary[]): LatencyComparisonSummary {
  const ragMessages = messages.filter((message) => message.ragUsed);
  const noRagMessages = messages.filter((message) => !message.ragUsed);
  return {
    rag: buildRagComparisonGroup(ragMessages),
    noRag: buildRagComparisonGroup(noRagMessages),
  };
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
    ["t4RagRecallMs", "t4_rag_recall_ms"],
    ["t4RagRecallResults", "t4_rag_recall_results"],
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
  if (isCountSeries(name) || name.endsWith("_tokens") || name.endsWith("_results")) {
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

function formatPlacement(value: HardwareWindowSummary["computePlacement"] | undefined): string {
  return value ?? "-";
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
        `T4.rag=${formatMs(message.t4RagRecallMs)}`,
        `T4.rag.hits=${formatCount(message.t4RagRecallResults)}`,
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
        `RAG.hw.samples=${formatCount(message.hardwareRag?.sampleCount)}`,
        `RAG.hw.cpu.avg/max=${formatPct(message.hardwareRag?.cpuUtilAvgPct)}/${formatPct(message.hardwareRag?.cpuUtilMaxPct)}`,
        `RAG.hw.gpu.avg/max=${formatPct(message.hardwareRag?.gpuUtilAvgPct)}/${formatPct(message.hardwareRag?.gpuUtilMaxPct)}`,
        `RAG.hw.gpuMem.avg/max=${formatPct(message.hardwareRag?.gpuMemUtilAvgPct)}/${formatPct(message.hardwareRag?.gpuMemUtilMaxPct)}`,
        `RAG.hw.gpuPower.avg/max=${formatWatts(message.hardwareRag?.gpuPowerAvgW)}/${formatWatts(message.hardwareRag?.gpuPowerMaxW)}`,
        `RAG.hw.gpuMemClock.avg/max=${formatCount(message.hardwareRag?.gpuMemClockAvgMHz)}/${formatCount(message.hardwareRag?.gpuMemClockMaxMHz)}`,
        `RAG.compute=${formatPlacement(message.hardwareRag?.computePlacement)}`,
        `LLM.hw.samples=${formatCount(message.hardwareLlm?.sampleCount)}`,
        `LLM.hw.cpu.avg/max=${formatPct(message.hardwareLlm?.cpuUtilAvgPct)}/${formatPct(message.hardwareLlm?.cpuUtilMaxPct)}`,
        `LLM.hw.gpu.avg/max=${formatPct(message.hardwareLlm?.gpuUtilAvgPct)}/${formatPct(message.hardwareLlm?.gpuUtilMaxPct)}`,
        `LLM.hw.gpuMem.avg/max=${formatPct(message.hardwareLlm?.gpuMemUtilAvgPct)}/${formatPct(message.hardwareLlm?.gpuMemUtilMaxPct)}`,
        `LLM.hw.gpuPower.avg/max=${formatWatts(message.hardwareLlm?.gpuPowerAvgW)}/${formatWatts(message.hardwareLlm?.gpuPowerMaxW)}`,
        `LLM.hw.gpuMemClock.avg/max=${formatCount(message.hardwareLlm?.gpuMemClockAvgMHz)}/${formatCount(message.hardwareLlm?.gpuMemClockMaxMHz)}`,
        `LLM.compute=${formatPlacement(message.hardwareLlm?.computePlacement)}`,
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
  lines.push("RAG vs No-RAG comparison:");
  for (const [name, summary] of Object.entries(report.comparisons.ragVsNoRag)) {
    lines.push(
      [
        `${name}.count=${summary.count}`,
        `e2e.complete.avg/max=${formatMs(summary.e2eLocalCompleteAvgMs)}/${formatMs(summary.e2eLocalCompleteMaxMs)}`,
        `t4.rag.avg/max=${formatMs(summary.t4RagRecallAvgMs)}/${formatMs(summary.t4RagRecallMaxMs)}`,
        `t5.total.avg/max=${formatMs(summary.t5LlmTotalAvgMs)}/${formatMs(summary.t5LlmTotalMaxMs)}`,
        `t5.input.avg/max=${formatCount(summary.t5InputTokensAvg)}/${formatCount(summary.t5InputTokensMax)}`,
        `t5.decode.tps.avg/min=${formatCount(summary.t5DecodeTpsAvg)}/${formatCount(summary.t5DecodeTpsMin)}`,
        `rag.cpu.avg/max=${formatPct(summary.ragCpuAvgPct)}/${formatPct(summary.ragCpuMaxPct)}`,
        `rag.gpu.avg/max=${formatPct(summary.ragGpuAvgPct)}/${formatPct(summary.ragGpuMaxPct)}`,
        `rag.gpuMem.avg/max=${formatPct(summary.ragGpuMemUtilAvgPct)}/${formatPct(summary.ragGpuMemUtilMaxPct)}`,
        `rag.gpuPower.avg/max=${formatWatts(summary.ragGpuPowerAvgW)}/${formatWatts(summary.ragGpuPowerMaxW)}`,
        `rag.gpuMemClock.avg/max=${formatCount(summary.ragGpuMemClockAvgMHz)}/${formatCount(summary.ragGpuMemClockMaxMHz)}`,
        `rag.compute=${formatPlacement(summary.ragPlacement)}`,
        `llm.cpu.avg/max=${formatPct(summary.llmCpuAvgPct)}/${formatPct(summary.llmCpuMaxPct)}`,
        `llm.gpu.avg/max=${formatPct(summary.llmGpuAvgPct)}/${formatPct(summary.llmGpuMaxPct)}`,
        `llm.gpuMem.avg/max=${formatPct(summary.llmGpuMemUtilAvgPct)}/${formatPct(summary.llmGpuMemUtilMaxPct)}`,
        `llm.gpuPower.avg/max=${formatWatts(summary.llmGpuPowerAvgW)}/${formatWatts(summary.llmGpuPowerMaxW)}`,
        `llm.gpuMemClock.avg/max=${formatCount(summary.llmGpuMemClockAvgMHz)}/${formatCount(summary.llmGpuMemClockMaxMHz)}`,
        `llm.compute=${formatPlacement(summary.llmPlacement)}`,
      ].join(" "),
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
