import type { HardwareTraceSample } from "./hardware-trace.js";
import type {
  HardwareWindowSummary,
  LatencyAggregateReport,
  LatencyMessageSummary,
  RagComparisonGroupSummary,
} from "./latency-trace-report.js";

type RenderLatencyReportHtmlOptions = {
  report: LatencyAggregateReport;
  hardwareSamples?: HardwareTraceSample[];
  avgMode?: boolean;
};

type StageBar = {
  label: string;
  value?: number;
  color: string;
};

type ChartMetric = {
  id: string;
  title: string;
  unit: string;
  points: Array<{ x: number; y?: number }>;
  xMarkers?: Array<{ x: number; label: string }>;
  xAxisLabel?: string;
};

type MetricSummary = {
  avg?: number;
  max?: number;
  latest?: number;
};

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function safeJson(value: unknown): string {
  return JSON.stringify(value).replaceAll("<", "\\u003c");
}

function csvEscape(value: unknown): string {
  const text =
    typeof value === "string"
      ? value
      : typeof value === "number" || typeof value === "boolean" || typeof value === "bigint"
        ? String(value)
        : value == null
          ? ""
          : JSON.stringify(value);
  if (text.includes(",") || text.includes('"') || text.includes("\n")) {
    return `"${text.replaceAll('"', '""')}"`;
  }
  return text;
}

function formatMs(value: number | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "N/A";
  }
  return `${value.toFixed(1)} ms`;
}

function formatPct(value: number | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "N/A";
  }
  return `${value.toFixed(1)}%`;
}

function formatCount(value: number | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "N/A";
  }
  return String(Math.round(value));
}

function formatWatts(value: number | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "N/A";
  }
  return `${value.toFixed(1)} W`;
}

function formatMiB(value: number | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "N/A";
  }
  return `${value.toFixed(1)} MiB`;
}

function formatMHz(value: number | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "N/A";
  }
  return `${value.toFixed(0)} MHz`;
}

function formatUnit(unit: string, value: number | undefined): string {
  switch (unit) {
    case "ms":
      return formatMs(value);
    case "%":
      return formatPct(value);
    case "W":
      return formatWatts(value);
    case "MiB":
      return formatMiB(value);
    case "count":
      return formatCount(value);
    default:
      if (typeof value !== "number" || !Number.isFinite(value)) {
        return "N/A";
      }
      return `${value.toFixed(1)} ${unit}`;
  }
}

function deriveGpuUtilForSample(sample: HardwareTraceSample): number | undefined {
  const values = (sample.gpus ?? [])
    .map((gpu) => gpu.utilizationGpuPct)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (values.length === 0) {
    return undefined;
  }
  return Math.max(...values);
}

function ratioPercent(value: number | undefined, total: number | undefined): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value <= 0 ||
    typeof total !== "number" ||
    !Number.isFinite(total) ||
    total <= 0
  ) {
    return 0;
  }
  return Math.max(0, Math.min(100, (value / total) * 100));
}

function buildCompleteStageBars(message: LatencyMessageSummary): StageBar[] {
  const llmResidual =
    typeof message.t5LlmTotalMs === "number"
      ? Math.max(
          0,
          message.t5LlmTotalMs -
            (message.t5LlmLoadMs ?? 0) -
            (message.t5LlmPrefillMs ?? 0) -
            (message.t5LlmDecodeMs ?? 0),
        )
      : undefined;
  return [
    { label: "T1", value: message.t1FeishuInboundMs, color: "#0f766e" },
    { label: "T2", value: message.t2GatewayEnqueueMs, color: "#0ea5e9" },
    { label: "T3", value: message.t3WorkerQueueWaitMs, color: "#8b5cf6" },
    { label: "T4", value: message.t4AgentPreprocessMs, color: "#d97706" },
    { label: "Load", value: message.t5LlmLoadMs, color: "#ef4444" },
    { label: "Prefill", value: message.t5LlmPrefillMs, color: "#f59e0b" },
    { label: "Decode", value: message.t5LlmDecodeMs, color: "#22c55e" },
    { label: "LLM+Other", value: llmResidual, color: "#64748b" },
    { label: "T6", value: message.t6FeishuFinalAckMs, color: "#ec4899" },
  ];
}

function resolveTimelineTotal(message: LatencyMessageSummary): number | undefined {
  if (
    typeof message.localCompleteMs === "number" &&
    Number.isFinite(message.localCompleteMs) &&
    message.localCompleteMs > 0
  ) {
    return message.localCompleteMs;
  }
  const fallback = buildCompleteStageBars(message)
    .map((segment) => segment.value)
    .filter(
      (value): value is number => typeof value === "number" && Number.isFinite(value) && value > 0,
    )
    .reduce((sum, value) => sum + value, 0);
  return fallback > 0 ? fallback : undefined;
}

function renderStageBar(message: LatencyMessageSummary): string {
  const total = resolveTimelineTotal(message);
  const segments = buildCompleteStageBars(message)
    .filter(
      (segment) =>
        typeof segment.value === "number" &&
        Number.isFinite(segment.value) &&
        segment.value > 0 &&
        typeof total === "number" &&
        Number.isFinite(total) &&
        total > 0,
    )
    .map((segment) => {
      const width = ratioPercent(segment.value, total);
      return `<div class="segment" style="width:${width}%;background:${segment.color}" title="${escapeHtml(`${segment.label}: ${formatMs(segment.value)}`)}"></div>`;
    })
    .join("");
  return `<div class="stacked-bar">${segments || `<div class="segment empty"></div>`}</div>`;
}

function renderLegend(): string {
  return `<div class="legend">${buildCompleteStageBars({ key: "legend" })
    .map(
      (segment) =>
        `<span class="legend-item"><span class="legend-dot" style="background:${segment.color}"></span>${escapeHtml(segment.label)}</span>`,
    )
    .join("")}</div>`;
}

function renderDownloadButtons(): string {
  return `
    <div class="download-row">
      <button class="dl-btn" data-download="messages-json">Download messages.json</button>
      <button class="dl-btn" data-download="messages-csv">Download messages.csv</button>
      <button class="dl-btn" data-download="hardware-json">Download hardware.json</button>
      <button class="dl-btn" data-download="hardware-csv">Download hardware.csv</button>
    </div>`;
}

function renderPerMessageButtons(index: number): string {
  return `
    <div class="download-row small">
      <button class="dl-btn" data-download="message-timeline-svg" data-message-index="${index}">Download timeline SVG</button>
      <button class="dl-btn" data-download="message-cpu-svg" data-message-index="${index}">Download CPU SVG</button>
      <button class="dl-btn" data-download="message-gpu-svg" data-message-index="${index}">Download GPU SVG</button>
      <button class="dl-btn" data-download="message-json" data-message-index="${index}">Download message JSON</button>
      <button class="dl-btn" data-download="message-csv" data-message-index="${index}">Download message CSV</button>
    </div>`;
}

function buildMessageCsv(messages: LatencyMessageSummary[]): string {
  const headers = [
    "key",
    "accountId",
    "messageId",
    "runId",
    "t1_ms",
    "t2_ms",
    "t3_ms",
    "t4_ms",
    "t4_rag_ms",
    "t4_rag_results",
    "t5_calls",
    "t5_ttft_first_ms",
    "t5_ttft_sum_ms",
    "t5_total_sum_ms",
    "t5_load_sum_ms",
    "t5_prefill_sum_ms",
    "t5_decode_sum_ms",
    "t5_input_tokens",
    "t5_output_tokens",
    "t5_total_tokens",
    "t5_prefill_tps",
    "t5_decode_tps",
    "t5_total_tps",
    "t5_prefill_ms_per_1k_input_tokens",
    "t5_decode_ms_per_output_token",
    "hardware_sample_count",
    "hardware_cpu_util_avg_pct",
    "hardware_mem_util_avg_pct",
    "hardware_gpu_util_avg_pct",
    "hardware_gpu_mem_util_avg_pct",
    "hardware_gpu_power_avg_w",
    "rag_sample_count",
    "rag_cpu_util_avg_pct",
    "rag_cpu_util_max_pct",
    "rag_gpu_util_avg_pct",
    "rag_gpu_util_max_pct",
    "rag_gpu_mem_util_avg_pct",
    "rag_gpu_mem_util_max_pct",
    "rag_gpu_power_avg_w",
    "rag_gpu_power_max_w",
    "rag_gpu_mem_clock_avg_mhz",
    "rag_gpu_mem_clock_max_mhz",
    "rag_compute_placement",
    "llm_sample_count",
    "llm_cpu_util_avg_pct",
    "llm_cpu_util_max_pct",
    "llm_gpu_util_avg_pct",
    "llm_gpu_util_max_pct",
    "llm_gpu_mem_util_avg_pct",
    "llm_gpu_mem_util_max_pct",
    "llm_gpu_power_avg_w",
    "llm_gpu_power_max_w",
    "llm_gpu_mem_clock_avg_mhz",
    "llm_gpu_mem_clock_max_mhz",
    "llm_compute_placement",
    "t5_load_sample_count",
    "t5_load_cpu_util_avg_pct",
    "t5_load_cpu_util_max_pct",
    "t5_load_gpu_util_avg_pct",
    "t5_load_gpu_util_max_pct",
    "t5_load_gpu_mem_util_avg_pct",
    "t5_load_gpu_mem_util_max_pct",
    "t5_load_gpu_power_avg_w",
    "t5_load_gpu_power_max_w",
    "t5_load_gpu_sm_clock_avg_mhz",
    "t5_load_gpu_mem_clock_avg_mhz",
    "t5_prefill_sample_count",
    "t5_prefill_cpu_util_avg_pct",
    "t5_prefill_cpu_util_max_pct",
    "t5_prefill_gpu_util_avg_pct",
    "t5_prefill_gpu_util_max_pct",
    "t5_prefill_gpu_mem_util_avg_pct",
    "t5_prefill_gpu_mem_util_max_pct",
    "t5_prefill_gpu_power_avg_w",
    "t5_prefill_gpu_power_max_w",
    "t5_prefill_gpu_sm_clock_avg_mhz",
    "t5_prefill_gpu_mem_clock_avg_mhz",
    "t5_decode_sample_count",
    "t5_decode_cpu_util_avg_pct",
    "t5_decode_cpu_util_max_pct",
    "t5_decode_gpu_util_avg_pct",
    "t5_decode_gpu_util_max_pct",
    "t5_decode_gpu_mem_util_avg_pct",
    "t5_decode_gpu_mem_util_max_pct",
    "t5_decode_gpu_power_avg_w",
    "t5_decode_gpu_power_max_w",
    "t5_decode_gpu_sm_clock_avg_mhz",
    "t5_decode_gpu_mem_clock_avg_mhz",
    "t6_first_ms",
    "t6_final_ms",
    "e2e_local_first_ms",
    "e2e_local_complete_ms",
  ];
  const rows = messages.map((message) =>
    [
      message.key,
      message.accountId,
      message.messageId,
      message.runId,
      message.t1FeishuInboundMs,
      message.t2GatewayEnqueueMs,
      message.t3WorkerQueueWaitMs,
      message.t4AgentPreprocessMs,
      message.t4RagRecallMs,
      message.t4RagRecallResults,
      message.t5LlmCallCount,
      message.t5LlmTtftMs,
      message.t5LlmTtftSumMs,
      message.t5LlmTotalMs,
      message.t5LlmLoadMs,
      message.t5LlmPrefillMs,
      message.t5LlmDecodeMs,
      message.t5InputTokens,
      message.t5OutputTokens,
      message.t5TotalTokens,
      message.t5PrefillTokensPerSec,
      message.t5DecodeTokensPerSec,
      message.t5TotalTokensPerSec,
      message.t5PrefillMsPer1kInputTokens,
      message.t5DecodeMsPerOutputToken,
      message.hardwareSampleCount,
      message.hardwareCpuUtilAvgPct,
      message.hardwareMemUtilAvgPct,
      message.hardwareGpuUtilAvgPct,
      message.hardwareGpuMemUtilAvgPct,
      message.hardwareGpuPowerAvgW,
      message.hardwareRag?.sampleCount,
      message.hardwareRag?.cpuUtilAvgPct,
      message.hardwareRag?.cpuUtilMaxPct,
      message.hardwareRag?.gpuUtilAvgPct,
      message.hardwareRag?.gpuUtilMaxPct,
      message.hardwareRag?.gpuMemUtilAvgPct,
      message.hardwareRag?.gpuMemUtilMaxPct,
      message.hardwareRag?.gpuPowerAvgW,
      message.hardwareRag?.gpuPowerMaxW,
      message.hardwareRag?.gpuMemClockAvgMHz,
      message.hardwareRag?.gpuMemClockMaxMHz,
      message.hardwareRag?.computePlacement,
      message.hardwareLlm?.sampleCount,
      message.hardwareLlm?.cpuUtilAvgPct,
      message.hardwareLlm?.cpuUtilMaxPct,
      message.hardwareLlm?.gpuUtilAvgPct,
      message.hardwareLlm?.gpuUtilMaxPct,
      message.hardwareLlm?.gpuMemUtilAvgPct,
      message.hardwareLlm?.gpuMemUtilMaxPct,
      message.hardwareLlm?.gpuPowerAvgW,
      message.hardwareLlm?.gpuPowerMaxW,
      message.hardwareLlm?.gpuMemClockAvgMHz,
      message.hardwareLlm?.gpuMemClockMaxMHz,
      message.hardwareLlm?.computePlacement,
      message.hardwareT5Load?.sampleCount,
      message.hardwareT5Load?.cpuUtilAvgPct,
      message.hardwareT5Load?.cpuUtilMaxPct,
      message.hardwareT5Load?.gpuUtilAvgPct,
      message.hardwareT5Load?.gpuUtilMaxPct,
      message.hardwareT5Load?.gpuMemUtilAvgPct,
      message.hardwareT5Load?.gpuMemUtilMaxPct,
      message.hardwareT5Load?.gpuPowerAvgW,
      message.hardwareT5Load?.gpuPowerMaxW,
      message.hardwareT5Load?.gpuSmClockAvgMHz,
      message.hardwareT5Load?.gpuMemClockAvgMHz,
      message.hardwareT5Prefill?.sampleCount,
      message.hardwareT5Prefill?.cpuUtilAvgPct,
      message.hardwareT5Prefill?.cpuUtilMaxPct,
      message.hardwareT5Prefill?.gpuUtilAvgPct,
      message.hardwareT5Prefill?.gpuUtilMaxPct,
      message.hardwareT5Prefill?.gpuMemUtilAvgPct,
      message.hardwareT5Prefill?.gpuMemUtilMaxPct,
      message.hardwareT5Prefill?.gpuPowerAvgW,
      message.hardwareT5Prefill?.gpuPowerMaxW,
      message.hardwareT5Prefill?.gpuSmClockAvgMHz,
      message.hardwareT5Prefill?.gpuMemClockAvgMHz,
      message.hardwareT5Decode?.sampleCount,
      message.hardwareT5Decode?.cpuUtilAvgPct,
      message.hardwareT5Decode?.cpuUtilMaxPct,
      message.hardwareT5Decode?.gpuUtilAvgPct,
      message.hardwareT5Decode?.gpuUtilMaxPct,
      message.hardwareT5Decode?.gpuMemUtilAvgPct,
      message.hardwareT5Decode?.gpuMemUtilMaxPct,
      message.hardwareT5Decode?.gpuPowerAvgW,
      message.hardwareT5Decode?.gpuPowerMaxW,
      message.hardwareT5Decode?.gpuSmClockAvgMHz,
      message.hardwareT5Decode?.gpuMemClockAvgMHz,
      message.t6FeishuFirstAckMs,
      message.t6FeishuFinalAckMs,
      message.localFirstVisibleMs,
      message.localCompleteMs,
    ]
      .map(csvEscape)
      .join(","),
  );
  return [headers.join(","), ...rows].join("\n");
}

function buildHardwareCsv(samples: HardwareTraceSample[]): string {
  const headers = [
    "ts",
    "epochMs",
    "cpuUtilPct",
    "loadAvg1",
    "loadAvg5",
    "loadAvg15",
    "memTotalBytes",
    "memFreeBytes",
    "memUsedBytes",
    "memUtilPct",
    "gpuIndex",
    "gpuName",
    "gpuUtilPct",
    "gpuMemUtilPct",
    "gpuMemoryUsedMiB",
    "gpuMemoryTotalMiB",
    "gpuPowerDrawW",
    "gpuSmClockMHz",
    "gpuMemClockMHz",
    "gpuTemperatureC",
  ];
  const rows: string[] = [];
  for (const sample of samples) {
    if (!sample.gpus || sample.gpus.length === 0) {
      rows.push(
        [
          sample.ts,
          sample.epochMs,
          sample.cpuUtilPct,
          sample.loadAvg1,
          sample.loadAvg5,
          sample.loadAvg15,
          sample.memTotalBytes,
          sample.memFreeBytes,
          sample.memUsedBytes,
          sample.memUtilPct,
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
        ]
          .map(csvEscape)
          .join(","),
      );
      continue;
    }
    for (const gpu of sample.gpus) {
      rows.push(
        [
          sample.ts,
          sample.epochMs,
          sample.cpuUtilPct,
          sample.loadAvg1,
          sample.loadAvg5,
          sample.loadAvg15,
          sample.memTotalBytes,
          sample.memFreeBytes,
          sample.memUsedBytes,
          sample.memUtilPct,
          gpu.index,
          gpu.name,
          gpu.utilizationGpuPct,
          gpu.utilizationMemPct,
          gpu.memoryUsedMiB,
          gpu.memoryTotalMiB,
          gpu.powerDrawW,
          gpu.smClockMHz,
          gpu.memClockMHz,
          gpu.temperatureC,
        ]
          .map(csvEscape)
          .join(","),
      );
    }
  }
  return [headers.join(","), ...rows].join("\n");
}

function filterSamplesForWindow(
  samples: HardwareTraceSample[],
  startedAtMs?: number,
  endedAtMs?: number,
): HardwareTraceSample[] {
  if (
    typeof startedAtMs !== "number" ||
    typeof endedAtMs !== "number" ||
    !Number.isFinite(startedAtMs) ||
    !Number.isFinite(endedAtMs)
  ) {
    return [];
  }
  return samples.filter((sample) => sample.epochMs >= startedAtMs && sample.epochMs <= endedAtMs);
}

function buildMessageWindowMetric(params: {
  message: LatencyMessageSummary;
  kind: "cpu" | "gpu";
  samples: HardwareTraceSample[];
}): ChartMetric {
  const startedAtMs = params.message.overallWindowStartedAtMs;
  const endedAtMs = params.message.overallWindowEndedAtMs;
  const scopedSamples = filterSamplesForWindow(params.samples, startedAtMs, endedAtMs);
  return {
    id: `${params.message.key}-${params.kind}-window`,
    title:
      params.kind === "cpu"
        ? "CPU Utilization (T1-T6 Interval)"
        : "GPU Utilization (T1-T6 Interval)",
    unit: "%",
    points: scopedSamples.map((sample, index) => ({
      x:
        typeof startedAtMs === "number" && Number.isFinite(startedAtMs)
          ? Math.max(0, sample.epochMs - startedAtMs)
          : index,
      y: params.kind === "cpu" ? sample.cpuUtilPct : deriveGpuUtilForSample(sample),
    })),
    xMarkers: buildMessageStageMarkers(params.message),
    xAxisLabel: "Elapsed Time (ms)",
  };
}

function buildMessageStageMarkers(
  message: LatencyMessageSummary,
): Array<{ x: number; label: string }> {
  const startedAtMs = message.overallWindowStartedAtMs;
  if (typeof startedAtMs !== "number" || !Number.isFinite(startedAtMs)) {
    return [];
  }
  const stages: Array<{ label: string; endedAtMs?: number }> = [
    { label: "T1", endedAtMs: message.t1WindowEndedAtMs },
    { label: "T2", endedAtMs: message.t2WindowEndedAtMs },
    { label: "T3", endedAtMs: message.t3WindowEndedAtMs },
    { label: "T4", endedAtMs: message.t4WindowEndedAtMs },
    { label: "T5", endedAtMs: message.t5WindowEndedAtMs },
    { label: "T6", endedAtMs: message.t6WindowEndedAtMs },
  ];
  return stages
    .map((stage) => {
      const endedAtMs = stage.endedAtMs;
      if (typeof endedAtMs !== "number" || !Number.isFinite(endedAtMs) || endedAtMs < startedAtMs) {
        return undefined;
      }
      return {
        label: stage.label,
        x: endedAtMs - startedAtMs,
      };
    })
    .filter((marker): marker is { x: number; label: string } => marker !== undefined);
}

function renderMessageUtilCharts(
  message: LatencyMessageSummary,
  index: number,
  hardwareSamples: HardwareTraceSample[],
): string {
  const cpuMetric = buildMessageWindowMetric({ message, kind: "cpu", samples: hardwareSamples });
  const gpuMetric = buildMessageWindowMetric({ message, kind: "gpu", samples: hardwareSamples });
  return `
    <div class="message-chart-grid">
      <article class="chart-card" data-chart-id="message-${index}-cpu-window">
        <div class="chart-header">
          <div class="chart-title">${escapeHtml(cpuMetric.title)}</div>
          <div class="chart-subtitle">${escapeHtml(message.messageId ? String(message.messageId) : message.key)}</div>
        </div>
        ${renderChartSvg(cpuMetric)}
      </article>
      <article class="chart-card" data-chart-id="message-${index}-gpu-window">
        <div class="chart-header">
          <div class="chart-title">${escapeHtml(gpuMetric.title)}</div>
          <div class="chart-subtitle">${escapeHtml(message.messageId ? String(message.messageId) : message.key)}</div>
        </div>
        ${renderChartSvg(gpuMetric)}
      </article>
    </div>`;
}

function renderMessageCards(
  messages: LatencyMessageSummary[],
  hardwareSamples: HardwareTraceSample[],
): string {
  return messages
    .map((message, index) => {
      const rows = [
        ["Message", String(message.messageId ?? "N/A")],
        ["T4 RAG Recall", formatMs(message.t4RagRecallMs)],
        ["RAG Hits", formatCount(message.t4RagRecallResults)],
        ["Calls", formatCount(message.t5LlmCallCount)],
        ["Input Tokens", formatCount(message.t5InputTokens)],
        ["Output Tokens", formatCount(message.t5OutputTokens)],
        ["Total Tokens", formatCount(message.t5TotalTokens)],
        ["Prefill TPS", formatCount(message.t5PrefillTokensPerSec)],
        ["Decode TPS", formatCount(message.t5DecodeTokensPerSec)],
        ["Total TPS", formatCount(message.t5TotalTokensPerSec)],
        ["HW Samples", formatCount(message.hardwareSampleCount)],
        ["HW CPU Avg", formatPct(message.hardwareCpuUtilAvgPct)],
        ["HW Mem Avg", formatPct(message.hardwareMemUtilAvgPct)],
        ["HW GPU Avg", formatPct(message.hardwareGpuUtilAvgPct)],
        ["HW GPU Mem Avg", formatPct(message.hardwareGpuMemUtilAvgPct)],
        ["HW GPU Power Avg", formatWatts(message.hardwareGpuPowerAvgW)],
        ["E2E First", formatMs(message.localFirstVisibleMs)],
        ["E2E Complete", formatMs(message.localCompleteMs)],
      ]
        .map(
          ([label, value]) =>
            `<div class="meta-row"><span class="meta-label">${escapeHtml(label)}</span><span class="meta-value">${escapeHtml(value)}</span></div>`,
        )
        .join("");
      return `
        <article class="message-card">
          <div class="message-header">
            <div>
              <div class="message-title">${escapeHtml(String(message.accountId ?? "unknown"))}</div>
              <div class="message-subtitle">${escapeHtml(String(message.messageId ?? message.key))}</div>
            </div>
            <div class="message-e2e">${escapeHtml(formatMs(message.localCompleteMs))}</div>
          </div>
          ${renderStageBar(message)}
          ${renderPerMessageButtons(index)}
          <div class="message-grid">${rows}</div>
          ${renderMessageUtilCharts(message, index, hardwareSamples)}
          <div class="message-hardware-grid">
            ${renderHardwareWindowCard("RAG Recall Hardware", message.hardwareRag)}
            ${renderHardwareWindowCard("LLM Inference Hardware", message.hardwareLlm)}
            ${renderHardwareWindowCard("Overall Message Hardware", message.hardwareOverall)}
          </div>
          ${renderT5PhaseHardwareSection(message)}
        </article>`;
    })
    .join("");
}

function renderT5PhaseHardwareSection(message: LatencyMessageSummary): string {
  const phases: Array<[string, HardwareWindowSummary | undefined]> = [
    ["T5 Load Hardware", message.hardwareT5Load],
    ["T5 Prefill Hardware", message.hardwareT5Prefill],
    ["T5 Decode Hardware", message.hardwareT5Decode],
  ];
  if (!phases.some(([, summary]) => summary?.sampleCount)) {
    return "";
  }
  return `
    <section class="panel" style="margin-top:16px">
      <h3>T5 Phase Hardware Breakdown</h3>
      <p class="section-note">These cards align hardware samples to the reconstructed T5 sub-stage windows. GPU memory utilization and memory clock remain bandwidth proxies; GPU memory used, SM clock, and power are direct sampled counters when available.</p>
      <div class="message-hardware-grid">
        ${phases.map(([title, summary]) => renderHardwareWindowCard(title, summary)).join("")}
      </div>
    </section>`;
}

function renderHardwareWindowCard(title: string, summary?: HardwareWindowSummary): string {
  const rows: Array<[string, string, string]> = [
    ["Samples", formatCount(summary?.sampleCount), "N/A"],
    ["CPU Util", formatPct(summary?.cpuUtilAvgPct), formatPct(summary?.cpuUtilMaxPct)],
    ["System Mem Util", formatPct(summary?.memUtilAvgPct), formatPct(summary?.memUtilMaxPct)],
    ["GPU Util", formatPct(summary?.gpuUtilAvgPct), formatPct(summary?.gpuUtilMaxPct)],
    [
      "GPU Mem Util (bandwidth proxy)",
      formatPct(summary?.gpuMemUtilAvgPct),
      formatPct(summary?.gpuMemUtilMaxPct),
    ],
    ["GPU Power", formatWatts(summary?.gpuPowerAvgW), formatWatts(summary?.gpuPowerMaxW)],
    [
      "GPU Mem Used",
      formatMiB(summary?.gpuMemoryUsedAvgMiB),
      formatMiB(summary?.gpuMemoryUsedMaxMiB),
    ],
    ["GPU SM Clock", formatMHz(summary?.gpuSmClockAvgMHz), formatMHz(summary?.gpuSmClockMaxMHz)],
    [
      "GPU Mem Clock (bandwidth proxy)",
      formatMHz(summary?.gpuMemClockAvgMHz),
      formatMHz(summary?.gpuMemClockMaxMHz),
    ],
    ["GPU Temp", formatUnit("C", summary?.gpuTempAvgC), formatUnit("C", summary?.gpuTempMaxC)],
    ["Placement", summary?.computePlacement ?? "N/A", "N/A"],
  ];
  return `
    <section class="mini-panel">
      <div class="mini-panel-title">${escapeHtml(title)}</div>
      <table class="compact-table">
        <thead><tr><th>Metric</th><th>Avg</th><th>Max</th></tr></thead>
        <tbody>${rows
          .map(
            ([label, avg, max]) =>
              `<tr><td>${escapeHtml(label)}</td><td>${escapeHtml(avg)}</td><td>${escapeHtml(max)}</td></tr>`,
          )
          .join("")}</tbody>
      </table>
    </section>`;
}

function renderRagComparisonRow(label: string, summary: RagComparisonGroupSummary): string {
  return `<tr>
    <td>${escapeHtml(label)}</td>
    <td>${summary.count}</td>
    <td>${escapeHtml(formatMs(summary.e2eLocalCompleteAvgMs))}</td>
    <td>${escapeHtml(formatMs(summary.e2eLocalCompleteMaxMs))}</td>
    <td>${escapeHtml(formatMs(summary.t4RagRecallAvgMs))}</td>
    <td>${escapeHtml(formatMs(summary.t5LlmTotalAvgMs))}</td>
    <td>${escapeHtml(formatCount(summary.t5InputTokensAvg))}</td>
    <td>${escapeHtml(formatCount(summary.t5DecodeTpsAvg))}</td>
    <td>${escapeHtml(formatPct(summary.ragCpuAvgPct))}</td>
    <td>${escapeHtml(formatPct(summary.ragGpuAvgPct))}</td>
    <td>${escapeHtml(formatPct(summary.ragGpuMemUtilAvgPct))}</td>
    <td>${escapeHtml(formatWatts(summary.ragGpuPowerAvgW))}</td>
    <td>${escapeHtml(formatMHz(summary.ragGpuMemClockAvgMHz))}</td>
    <td>${escapeHtml(summary.ragPlacement ?? "N/A")}</td>
    <td>${escapeHtml(formatPct(summary.llmCpuAvgPct))}</td>
    <td>${escapeHtml(formatPct(summary.llmGpuAvgPct))}</td>
    <td>${escapeHtml(formatPct(summary.llmGpuMemUtilAvgPct))}</td>
    <td>${escapeHtml(formatWatts(summary.llmGpuPowerAvgW))}</td>
    <td>${escapeHtml(formatMHz(summary.llmGpuMemClockAvgMHz))}</td>
    <td>${escapeHtml(summary.llmPlacement ?? "N/A")}</td>
  </tr>`;
}

function renderRagComparisonSection(report: LatencyAggregateReport): string {
  const comparison = report.comparisons.ragVsNoRag;
  return `
    <section class="panel" style="margin-top:20px">
      <h2>RAG vs No-RAG Comparison</h2>
      <p class="section-note">RAG hardware focuses on the automatic recall window before the first model turn. GPU memory utilization and memory clock act as bandwidth proxies when direct bandwidth counters are unavailable.</p>
      <table class="series-table">
        <thead>
          <tr>
            <th>Group</th>
            <th>Count</th>
            <th>E2E Avg</th>
            <th>E2E Max</th>
            <th>RAG Avg</th>
            <th>LLM Avg</th>
            <th>Input Avg</th>
            <th>Decode TPS Avg</th>
            <th>RAG CPU Avg</th>
            <th>RAG GPU Avg</th>
            <th>RAG GPU Mem Avg</th>
            <th>RAG GPU Power Avg</th>
            <th>RAG Mem Clock Avg</th>
            <th>RAG Placement</th>
            <th>LLM CPU Avg</th>
            <th>LLM GPU Avg</th>
            <th>LLM GPU Mem Avg</th>
            <th>LLM GPU Power Avg</th>
            <th>LLM Mem Clock Avg</th>
            <th>LLM Placement</th>
          </tr>
        </thead>
        <tbody>
          ${renderRagComparisonRow("RAG", comparison.rag)}
          ${renderRagComparisonRow("No RAG", comparison.noRag)}
        </tbody>
      </table>
    </section>`;
}

function renderAggregateSection(report: LatencyAggregateReport): string {
  const complete = report.series.e2e_local_complete_ms;
  const first = report.series.e2e_local_first_visible_ms;
  const llm = report.series.t5_llm_total_ms;
  const decodeTps = report.series.t5_llm_decode_tps;
  const cards = [
    ["Messages", String(report.messages.length), `${report.recordsScanned} records scanned`],
    ["E2E First Avg", formatMs(first?.avg), `P95 ${formatMs(first?.p95)}`],
    ["E2E Complete Avg", formatMs(complete?.avg), `P95 ${formatMs(complete?.p95)}`],
    ["LLM Total Avg", formatMs(llm?.avg), `P95 ${formatMs(llm?.p95)}`],
    ["Decode TPS Avg", formatCount(decodeTps?.avg), `P95 ${formatCount(decodeTps?.p95)}`],
  ]
    .map(
      ([title, value, subtitle]) => `
        <section class="kpi-card">
          <div class="kpi-title">${escapeHtml(title)}</div>
          <div class="kpi-value">${escapeHtml(value)}</div>
          <div class="kpi-subtitle">${escapeHtml(subtitle)}</div>
        </section>`,
    )
    .join("");

  const rows = Object.entries(report.series)
    .map(([name, series]) => {
      const formatter =
        name.endsWith("_tokens") || name.endsWith("_tps")
          ? formatCount
          : name.endsWith("_pct")
            ? formatPct
            : name.endsWith("_avg_w")
              ? formatWatts
              : formatMs;
      return `<tr>
        <td>${escapeHtml(name)}</td>
        <td>${series.count}</td>
        <td>${escapeHtml(formatter(series.avg))}</td>
        <td>${escapeHtml(formatter(series.p95))}</td>
        <td>${escapeHtml(formatter(series.p99))}</td>
      </tr>`;
    })
    .join("");

  return `
    <section class="panel" style="margin-top:20px">
      <h2>Aggregate Summary</h2>
      <div class="kpi-grid">${cards}</div>
      <table class="series-table">
        <thead><tr><th>Metric</th><th>Count</th><th>Avg</th><th>P95</th><th>P99</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </section>`;
}

function collectHardwareMetrics(samples: HardwareTraceSample[]): ChartMetric[] {
  const firstTs = samples[0]?.epochMs ?? 0;
  const toX = (epochMs: number) => epochMs - firstTs;
  const metrics: ChartMetric[] = [
    {
      id: "cpu-util",
      title: "CPU Utilization",
      unit: "%",
      points: samples.map((sample) => ({ x: toX(sample.epochMs), y: sample.cpuUtilPct })),
      xAxisLabel: "Elapsed Time (ms)",
    },
    {
      id: "mem-util",
      title: "System Memory Utilization",
      unit: "%",
      points: samples.map((sample) => ({ x: toX(sample.epochMs), y: sample.memUtilPct })),
      xAxisLabel: "Elapsed Time (ms)",
    },
    {
      id: "load-1",
      title: "Load Average 1m",
      unit: "load",
      points: samples.map((sample) => ({ x: toX(sample.epochMs), y: sample.loadAvg1 })),
      xAxisLabel: "Elapsed Time (ms)",
    },
    {
      id: "load-5",
      title: "Load Average 5m",
      unit: "load",
      points: samples.map((sample) => ({ x: toX(sample.epochMs), y: sample.loadAvg5 })),
      xAxisLabel: "Elapsed Time (ms)",
    },
    {
      id: "load-15",
      title: "Load Average 15m",
      unit: "load",
      points: samples.map((sample) => ({ x: toX(sample.epochMs), y: sample.loadAvg15 })),
      xAxisLabel: "Elapsed Time (ms)",
    },
  ];

  const gpuIndexes = new Set<number>();
  for (const sample of samples) {
    for (const gpu of sample.gpus ?? []) {
      if (typeof gpu.index === "number") {
        gpuIndexes.add(gpu.index);
      }
    }
  }

  for (const gpuIndex of [...gpuIndexes].toSorted((a, b) => a - b)) {
    const gpuLabel = `GPU ${gpuIndex}`;
    const getGpu = (sample: HardwareTraceSample) =>
      sample.gpus?.find((gpu) => gpu.index === gpuIndex);
    metrics.push(
      {
        id: `gpu-${gpuIndex}-util`,
        title: `${gpuLabel} Utilization`,
        unit: "%",
        points: samples.map((sample) => ({
          x: toX(sample.epochMs),
          y: getGpu(sample)?.utilizationGpuPct,
        })),
        xAxisLabel: "Elapsed Time (ms)",
      },
      {
        id: `gpu-${gpuIndex}-mem-util`,
        title: `${gpuLabel} Memory Utilization (bandwidth proxy)`,
        unit: "%",
        points: samples.map((sample) => ({
          x: toX(sample.epochMs),
          y:
            getGpu(sample)?.memoryUsedMiB !== undefined &&
            getGpu(sample)?.memoryTotalMiB !== undefined &&
            (getGpu(sample)?.memoryTotalMiB ?? 0) > 0
              ? ((getGpu(sample)?.memoryUsedMiB ?? 0) / (getGpu(sample)?.memoryTotalMiB ?? 1)) * 100
              : getGpu(sample)?.utilizationMemPct,
        })),
        xAxisLabel: "Elapsed Time (ms)",
      },
      {
        id: `gpu-${gpuIndex}-mem-used`,
        title: `${gpuLabel} Memory Used`,
        unit: "MiB",
        points: samples.map((sample) => ({
          x: toX(sample.epochMs),
          y: getGpu(sample)?.memoryUsedMiB,
        })),
        xAxisLabel: "Elapsed Time (ms)",
      },
      {
        id: `gpu-${gpuIndex}-mem-total`,
        title: `${gpuLabel} Memory Total`,
        unit: "MiB",
        points: samples.map((sample) => ({
          x: toX(sample.epochMs),
          y: getGpu(sample)?.memoryTotalMiB,
        })),
        xAxisLabel: "Elapsed Time (ms)",
      },
      {
        id: `gpu-${gpuIndex}-power`,
        title: `${gpuLabel} Power Draw`,
        unit: "W",
        points: samples.map((sample) => ({
          x: toX(sample.epochMs),
          y: getGpu(sample)?.powerDrawW,
        })),
        xAxisLabel: "Elapsed Time (ms)",
      },
      {
        id: `gpu-${gpuIndex}-sm-clock`,
        title: `${gpuLabel} SM Clock`,
        unit: "MHz",
        points: samples.map((sample) => ({
          x: toX(sample.epochMs),
          y: getGpu(sample)?.smClockMHz,
        })),
        xAxisLabel: "Elapsed Time (ms)",
      },
      {
        id: `gpu-${gpuIndex}-mem-clock`,
        title: `${gpuLabel} Memory Clock (bandwidth proxy)`,
        unit: "MHz",
        points: samples.map((sample) => ({
          x: toX(sample.epochMs),
          y: getGpu(sample)?.memClockMHz,
        })),
        xAxisLabel: "Elapsed Time (ms)",
      },
      {
        id: `gpu-${gpuIndex}-temperature`,
        title: `${gpuLabel} Temperature`,
        unit: "C",
        points: samples.map((sample) => ({
          x: toX(sample.epochMs),
          y: getGpu(sample)?.temperatureC,
        })),
        xAxisLabel: "Elapsed Time (ms)",
      },
    );
  }

  if (gpuIndexes.size === 0) {
    metrics.push(
      { id: "gpu-util-na", title: "GPU Utilization", unit: "%", points: [] },
      { id: "gpu-mem-util-na", title: "GPU Memory Utilization", unit: "%", points: [] },
      { id: "gpu-mem-used-na", title: "GPU Memory Used", unit: "MiB", points: [] },
      { id: "gpu-mem-total-na", title: "GPU Memory Total", unit: "MiB", points: [] },
      { id: "gpu-power-na", title: "GPU Power Draw", unit: "W", points: [] },
      { id: "gpu-sm-clock-na", title: "GPU SM Clock", unit: "MHz", points: [] },
      { id: "gpu-mem-clock-na", title: "GPU Memory Clock", unit: "MHz", points: [] },
      { id: "gpu-temp-na", title: "GPU Temperature", unit: "C", points: [] },
    );
  }
  return metrics;
}

function summarizeChartMetric(metric: ChartMetric): MetricSummary {
  const values = metric.points
    .map((point) => point.y)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (values.length === 0) {
    return {};
  }
  return {
    avg: values.reduce((sum, value) => sum + value, 0) / values.length,
    max: Math.max(...values),
    latest: values.at(-1),
  };
}

function resolveYAxisLabel(metric: ChartMetric): string {
  if (metric.unit === "%") {
    return "Utilization (%)";
  }
  if (metric.unit === "W") {
    return "Power (W)";
  }
  if (metric.unit === "MiB") {
    return "Memory (MiB)";
  }
  if (metric.unit === "MHz") {
    return "Frequency (MHz)";
  }
  if (metric.unit === "load") {
    return "Load";
  }
  return `Value (${metric.unit})`;
}

function renderChartSvg(metric: ChartMetric): string {
  const width = 760;
  const height = 248;
  const paddingLeft = 128;
  const paddingRight = 42;
  const paddingTop = 56;
  const paddingBottom = 62;
  const summary = summarizeChartMetric(metric);
  const numericPoints = metric.points.filter(
    (point): point is { x: number; y: number } =>
      typeof point.y === "number" && Number.isFinite(point.y),
  );
  if (numericPoints.length === 0) {
    return `<div class="chart-empty">N/A</div>`;
  }
  const minX = Math.min(...numericPoints.map((point) => point.x));
  const maxX = Math.max(...numericPoints.map((point) => point.x));
  let minY = Math.min(...numericPoints.map((point) => point.y));
  let maxY = Math.max(...numericPoints.map((point) => point.y));
  if (minY === maxY) {
    minY -= 1;
    maxY += 1;
  }
  const xSpan = Math.max(1, maxX - minX);
  const ySpan = Math.max(1, maxY - minY);
  const points = numericPoints
    .map((point) => {
      const x = paddingLeft + ((point.x - minX) / xSpan) * (width - paddingLeft - paddingRight);
      const y =
        height - paddingBottom - ((point.y - minY) / ySpan) * (height - paddingTop - paddingBottom);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  const latest = numericPoints.at(-1)?.y;
  const min = Math.min(...numericPoints.map((point) => point.y));
  const max = Math.max(...numericPoints.map((point) => point.y));
  const avg = summary.avg;
  const xAxisLabel = metric.xAxisLabel ?? "Sample Index";
  const yAxisLabel = resolveYAxisLabel(metric);
  const lineY = (value: number) =>
    height - paddingBottom - ((value - minY) / ySpan) * (height - paddingTop - paddingBottom);
  const avgGuideY = typeof avg === "number" ? lineY(avg) : undefined;
  const maxGuideY = lineY(max);
  const minGuideY = lineY(min);
  const rawYTicks = [
    { label: `max ${formatUnit(metric.unit, max)}`, y: maxGuideY },
    ...(typeof avgGuideY === "number"
      ? [{ label: `avg ${formatUnit(metric.unit, avg)}`, y: avgGuideY }]
      : []),
    { label: `min ${formatUnit(metric.unit, min)}`, y: minGuideY },
  ];
  const yTicks = rawYTicks.reduce<Array<{ label: string; y: number }>>((ticks, tick) => {
    const previous = ticks.at(-1);
    if (previous && Math.abs(previous.y - tick.y) < 12) {
      previous.label = `${previous.label} · ${tick.label}`;
      return ticks;
    }
    ticks.push({ ...tick });
    return ticks;
  }, []);
  const xMarkers = (metric.xMarkers ?? [])
    .map((marker) => ({
      ...marker,
      x: paddingLeft + ((marker.x - minX) / xSpan) * (width - paddingLeft - paddingRight),
    }))
    .filter((marker) => Number.isFinite(marker.x));
  const stagedMarkers = xMarkers
    .toSorted((left, right) => left.x - right.x)
    .map((marker, index, markers) => {
      const previous = markers[index - 1];
      const crowded = previous ? marker.x - previous.x < 28 : false;
      return {
        ...marker,
        labelY: height - paddingBottom + (crowded ? 28 : 16),
      };
    });
  return `
    <svg class="chart-svg" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" role="img" aria-label="${escapeHtml(metric.title)}">
      <line x1="${paddingLeft}" y1="${height - paddingBottom}" x2="${width - paddingRight}" y2="${height - paddingBottom}" class="axis" />
      <line x1="${paddingLeft}" y1="${paddingTop}" x2="${paddingLeft}" y2="${height - paddingBottom}" class="axis" />
      ${yTicks
        .map(
          (tick) =>
            `<line x1="${paddingLeft - 5}" y1="${tick.y.toFixed(1)}" x2="${paddingLeft}" y2="${tick.y.toFixed(1)}" class="tick" />`,
        )
        .join("")}
      ${
        typeof avgGuideY === "number"
          ? `<line x1="${paddingLeft}" y1="${avgGuideY.toFixed(1)}" x2="${width - paddingRight}" y2="${avgGuideY.toFixed(1)}" class="guide avg-guide" />`
          : ""
      }
      <line x1="${paddingLeft}" y1="${maxGuideY.toFixed(1)}" x2="${width - paddingRight}" y2="${maxGuideY.toFixed(1)}" class="guide max-guide" />
      ${stagedMarkers
        .map(
          (marker) =>
            `<line x1="${marker.x.toFixed(1)}" y1="${paddingTop}" x2="${marker.x.toFixed(1)}" y2="${height - paddingBottom}" class="guide stage-guide" />`,
        )
        .join("")}
      <polyline points="${points}" fill="none" stroke="#0f766e" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" />
      <text x="${width / 2}" y="18" text-anchor="middle" class="chart-overlay-title">${escapeHtml(metric.title)}</text>
      <text x="${width / 2}" y="36" text-anchor="middle" class="chart-overlay-subtitle">${escapeHtml(`Avg: ${formatUnit(metric.unit, avg)} | Max: ${formatUnit(metric.unit, max)}`)}</text>
      ${yTicks
        .map(
          (tick) =>
            `<text x="${paddingLeft - 8}" y="${(tick.y + 4).toFixed(1)}" text-anchor="end" class="axis-label">${escapeHtml(tick.label)}</text>`,
        )
        .join("")}
      ${stagedMarkers
        .map(
          (marker) =>
            `<text x="${marker.x.toFixed(1)}" y="${marker.labelY.toFixed(1)}" text-anchor="middle" class="axis-label">${escapeHtml(marker.label)}</text>`,
        )
        .join("")}
      <text x="${width - paddingRight}" y="${paddingTop - 18}" text-anchor="end" class="axis-label">${escapeHtml(`latest ${formatUnit(metric.unit, latest)}`)}</text>
      <text x="${(paddingLeft + width - paddingRight) / 2}" y="${height - 10}" text-anchor="middle" class="axis-label">${escapeHtml(xAxisLabel)}</text>
      <text x="18" y="${height / 2}" text-anchor="middle" transform="rotate(-90 18 ${height / 2})" class="axis-label">${escapeHtml(yAxisLabel)}</text>
    </svg>`;
}

function renderHardwareSection(samples: HardwareTraceSample[]): string {
  const metrics = collectHardwareMetrics(samples);
  const rows = metrics
    .map((metric) => {
      const summary = summarizeChartMetric(metric);
      return `<tr>
        <td>${escapeHtml(metric.title)}</td>
        <td>${escapeHtml(formatUnit(metric.unit, summary.avg))}</td>
        <td>${escapeHtml(formatUnit(metric.unit, summary.max))}</td>
        <td>${escapeHtml(formatUnit(metric.unit, summary.latest))}</td>
      </tr>`;
    })
    .join("");
  const cards = metrics
    .map(
      (metric) => `
        <article class="chart-card" data-chart-id="${escapeHtml(metric.id)}">
          <div class="chart-header">
            <div class="chart-title">${escapeHtml(metric.title)}</div>
            <div class="chart-subtitle">${escapeHtml(metric.unit)}</div>
          </div>
          <div class="download-row small">
            <button class="dl-btn" data-download="chart-svg" data-chart-id="${escapeHtml(metric.id)}">Download chart SVG</button>
          </div>
          ${renderChartSvg(metric)}
        </article>`,
    )
    .join("");
  return `
    <section class="panel" style="margin-top:20px">
      <h2>Hardware Timeline</h2>
      <p class="section-note">Raw hardware samples across the captured period. Missing metrics stay visible as N/A rather than being hidden. GPU memory utilization and memory clock are shown as bandwidth proxies.</p>
      ${renderDownloadButtons()}
      <table class="series-table">
        <thead><tr><th>Metric</th><th>Avg</th><th>Max</th><th>Latest</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <div class="chart-grid">${cards}</div>
    </section>`;
}

function renderNotes(): string {
  return `
    <section class="notes">
      <div>Note: default view is message-level only. Use the visualize command with <code>--avg</code> if you also want aggregate avg, P95, and P99 sections.</div>
      <div>Note: T6.first and T6.final use different start points, so T6.final can be smaller than T6.first.</div>
      <div>Note: GPU memory charts fall back to <code>utilization.memory</code> when <code>memory.used / memory.total</code> is unavailable.</div>
    </section>`;
}

export function renderLatencyReportHtml(
  input: RenderLatencyReportHtmlOptions | LatencyAggregateReport,
): string {
  const options =
    "report" in input ? input : { report: input, hardwareSamples: undefined, avgMode: false };
  const report = options.report;
  const hardwareSamples = options.hardwareSamples ?? [];
  const avgMode = options.avgMode ?? false;

  const messageJson = safeJson(report.messages);
  const hardwareJson = safeJson(hardwareSamples);
  const messageCsv = safeJson(buildMessageCsv(report.messages));
  const hardwareCsv = safeJson(buildHardwareCsv(hardwareSamples));

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>OpenClaw Latency Dashboard</title>
  <style>
    :root {
      --bg: #f4efe6;
      --panel: rgba(255,255,255,0.82);
      --text: #1f2937;
      --muted: #6b7280;
      --line: rgba(15,23,42,0.08);
      --accent: #0f766e;
      --shadow: 0 18px 40px rgba(15, 23, 42, 0.08);
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      color: var(--text);
      font: 14px/1.45 "Iowan Old Style", "Palatino Linotype", Georgia, serif;
      background:
        radial-gradient(circle at top left, rgba(15,118,110,0.12), transparent 28%),
        radial-gradient(circle at top right, rgba(239,68,68,0.10), transparent 24%),
        linear-gradient(180deg, #f8f4ed 0%, var(--bg) 100%);
    }
    .wrap { max-width: 1440px; margin: 0 auto; padding: 28px 24px 64px; }
    .hero { display: grid; gap: 10px; margin-bottom: 24px; }
    h1 { margin: 0; font-size: 34px; letter-spacing: -0.03em; }
    .hero p, .section-note { margin: 0; color: var(--muted); max-width: 980px; }
    .panel {
      background: var(--panel);
      border: 1px solid var(--line);
      box-shadow: var(--shadow);
      border-radius: 22px;
      padding: 20px;
      backdrop-filter: blur(18px);
    }
    .kpi-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 14px; margin-top: 16px; }
    .kpi-card { background: rgba(255,255,255,0.74); border: 1px solid var(--line); border-radius: 18px; padding: 16px; }
    .kpi-title { color: var(--muted); font-size: 12px; text-transform: uppercase; letter-spacing: 0.08em; }
    .kpi-value { margin-top: 8px; font-size: 28px; font-weight: 700; font-family: "Avenir Next Condensed", "Helvetica Neue", sans-serif; }
    .kpi-subtitle { margin-top: 4px; color: var(--muted); }
    h2 { margin: 0 0 14px; font: 600 18px/1.2 "Avenir Next Condensed", "Helvetica Neue", sans-serif; letter-spacing: 0.01em; }
    .legend { display: flex; flex-wrap: wrap; gap: 10px 14px; margin: 12px 0 16px; color: var(--muted); }
    .legend-item { display: inline-flex; align-items: center; gap: 8px; }
    .legend-dot { width: 10px; height: 10px; border-radius: 999px; display: inline-block; }
      .message-list { display: grid; gap: 14px; }
      .message-card { border: 1px solid var(--line); border-radius: 18px; padding: 16px; background: rgba(255,255,255,0.7); }
      .message-header { display: flex; justify-content: space-between; gap: 12px; align-items: baseline; margin-bottom: 12px; }
      .message-title { font-weight: 700; font-size: 18px; }
      .message-subtitle { color: var(--muted); font-size: 12px; word-break: break-all; }
      .message-e2e { font: 700 24px/1 "Avenir Next Condensed", "Helvetica Neue", sans-serif; }
    .stacked-bar { display: flex; width: 100%; height: 18px; overflow: hidden; border-radius: 999px; background: rgba(148,163,184,0.14); border: 1px solid rgba(148,163,184,0.18); margin-bottom: 12px; }
    .segment { height: 100%; }
    .segment.empty { width: 100%; background: rgba(148,163,184,0.16); }
      .message-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 8px 18px; }
      .message-chart-grid { display: grid; grid-template-columns: repeat(2, minmax(320px, 1fr)); gap: 12px; margin-top: 14px; }
      .message-hardware-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 12px; margin-top: 14px; }
    .meta-row { display: flex; justify-content: space-between; gap: 10px; border-top: 1px dashed rgba(148,163,184,0.2); padding-top: 6px; }
    .meta-label { color: var(--muted); }
    .meta-value { font-weight: 600; }
    .mini-panel { border: 1px solid var(--line); border-radius: 16px; padding: 12px; background: rgba(255,255,255,0.62); }
    .mini-panel-title { font-weight: 700; margin-bottom: 8px; }
    .compact-table { width: 100%; border-collapse: collapse; font-size: 12px; }
    .compact-table th, .compact-table td { padding: 6px 8px; border-bottom: 1px solid rgba(148,163,184,0.14); text-align: left; }
    .series-table { width: 100%; border-collapse: collapse; overflow: hidden; border-radius: 16px; background: rgba(255,255,255,0.76); margin-top: 14px; }
    .series-table th, .series-table td { padding: 10px 12px; border-bottom: 1px solid rgba(148,163,184,0.16); text-align: left; }
    .series-table th { color: var(--muted); font-size: 12px; text-transform: uppercase; letter-spacing: 0.08em; }
    .chart-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 14px; margin-top: 16px; }
    .chart-card { border: 1px solid var(--line); border-radius: 18px; padding: 14px; background: rgba(255,255,255,0.7); }
    .chart-header { display: flex; justify-content: space-between; gap: 12px; align-items: baseline; margin-bottom: 8px; }
    .chart-title { font-weight: 700; }
    .chart-subtitle { color: var(--muted); font-size: 12px; }
    .chart-svg { width: 100%; height: 220px; display: block; background: linear-gradient(180deg, rgba(15,118,110,0.06), rgba(15,118,110,0.01)); border-radius: 12px; }
    .axis { stroke: rgba(15,23,42,0.16); stroke-width: 1; }
    .tick { stroke: rgba(15,23,42,0.22); stroke-width: 1; }
    .guide { stroke-width: 1.8; stroke-dasharray: 6 4; }
    .avg-guide { stroke: #16a34a; }
    .max-guide { stroke: #dc2626; }
    .stage-guide { stroke: rgba(15, 23, 42, 0.2); stroke-width: 1.2; stroke-dasharray: 3 3; }
    .axis-label { fill: #6b7280; font-size: 11px; font-family: "Helvetica Neue", Arial, sans-serif; }
    .chart-overlay-title { fill: #111827; font-size: 16px; font-family: "Helvetica Neue", Arial, sans-serif; font-weight: 700; }
    .chart-overlay-subtitle { fill: #374151; font-size: 13px; font-family: "Helvetica Neue", Arial, sans-serif; }
    .chart-empty { display: grid; place-items: center; height: 220px; border-radius: 12px; background: rgba(148,163,184,0.12); color: var(--muted); border: 1px dashed rgba(148,163,184,0.28); }
    .download-row { display: flex; flex-wrap: wrap; gap: 10px; margin: 10px 0 0; }
    .download-row.small { margin: 0 0 12px; }
    .dl-btn {
      appearance: none; border: 1px solid rgba(15,23,42,0.12); background: white; color: var(--text);
      border-radius: 999px; padding: 8px 12px; font: 600 12px/1 "Helvetica Neue", Arial, sans-serif; cursor: pointer;
    }
    .dl-btn:hover { background: #f8fafc; }
    .notes { margin-top: 20px; color: var(--muted); display: grid; gap: 6px; }
    code { background: rgba(15,23,42,0.06); padding: 1px 6px; border-radius: 999px; }
    @media (max-width: 800px) {
      .wrap { padding: 18px 14px 40px; }
      h1 { font-size: 28px; }
      .message-header { flex-direction: column; align-items: flex-start; }
      .message-chart-grid { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <main class="wrap">
    <section class="hero">
      <h1>OpenClaw Latency Dashboard</h1>
      <p>Default view is message-by-message. Aggregate avg, P95, and P99 are hidden unless the dashboard is generated with <code>--avg</code>. Hardware is shown as raw time-series instead of a single collapsed number.</p>
      ${renderDownloadButtons()}
    </section>

    <section class="panel">
      <h2>Per-message Timeline</h2>
      <p class="section-note">Each card corresponds to one real message interaction. Token and TPS values are based on what OpenClaw actually sent to the LLM.</p>
      ${renderLegend()}
      <div class="message-list">${renderMessageCards(report.messages, hardwareSamples)}</div>
    </section>

    ${renderRagComparisonSection(report)}
    ${renderHardwareSection(hardwareSamples)}
    ${avgMode ? renderAggregateSection(report) : ""}
    ${renderNotes()}
  </main>

  <script>
    const MESSAGES = ${messageJson};
    const HARDWARE = ${hardwareJson};
    const MESSAGE_CSV = ${messageCsv};
    const HARDWARE_CSV = ${hardwareCsv};

    function downloadText(filename, content, type) {
      const blob = new Blob([content], { type });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    }

    function messageToCsv(message) {
      const headers = Object.keys(message);
      const row = headers.map((key) => {
        const value = message[key];
        const text =
          typeof value === "string"
            ? value
            : typeof value === "number" || typeof value === "boolean" || typeof value === "bigint"
              ? String(value)
              : value == null
                ? ""
                : JSON.stringify(value);
        return /[",\\n]/.test(text) ? '"' + text.replaceAll('"', '""') + '"' : text;
      });
      return headers.join(",") + "\\n" + row.join(",");
    }

    const MESSAGE_TIMELINE_COLORS = {
      t1: "#0f766e",
      t2: "#0ea5e9",
      t3: "#8b5cf6",
      t4: "#d97706",
      load: "#ef4444",
      prefill: "#f59e0b",
      decode: "#22c55e",
      residual: "#64748b",
      t6: "#ec4899",
    };

    function buildMessageTimelineSvg(message) {
      const total = Number.isFinite(message.localCompleteMs) && message.localCompleteMs > 0
        ? message.localCompleteMs
        : [
            message.t1FeishuInboundMs,
            message.t2GatewayEnqueueMs,
            message.t3WorkerQueueWaitMs,
            message.t4AgentPreprocessMs,
            message.t5LlmLoadMs,
            message.t5LlmPrefillMs,
            message.t5LlmDecodeMs,
            Number.isFinite(message.t5LlmTotalMs)
              ? Math.max(0, message.t5LlmTotalMs - (message.t5LlmLoadMs || 0) - (message.t5LlmPrefillMs || 0) - (message.t5LlmDecodeMs || 0))
              : 0,
            message.t6FeishuFinalAckMs,
          ].filter((value) => Number.isFinite(value) && value > 0).reduce((sum, value) => sum + value, 0) || 1;
      const residual = Number.isFinite(message.t5LlmTotalMs)
        ? Math.max(0, message.t5LlmTotalMs - (message.t5LlmLoadMs || 0) - (message.t5LlmPrefillMs || 0) - (message.t5LlmDecodeMs || 0))
        : 0;
      const segments = [
        ["T1", message.t1FeishuInboundMs, MESSAGE_TIMELINE_COLORS.t1],
        ["T2", message.t2GatewayEnqueueMs, MESSAGE_TIMELINE_COLORS.t2],
        ["T3", message.t3WorkerQueueWaitMs, MESSAGE_TIMELINE_COLORS.t3],
        ["T4", message.t4AgentPreprocessMs, MESSAGE_TIMELINE_COLORS.t4],
        ["Load", message.t5LlmLoadMs, MESSAGE_TIMELINE_COLORS.load],
        ["Prefill", message.t5LlmPrefillMs, MESSAGE_TIMELINE_COLORS.prefill],
        ["Decode", message.t5LlmDecodeMs, MESSAGE_TIMELINE_COLORS.decode],
        ["Residual", residual, MESSAGE_TIMELINE_COLORS.residual],
        ["T6", message.t6FeishuFinalAckMs, MESSAGE_TIMELINE_COLORS.t6],
      ].filter(([, value]) => Number.isFinite(value) && value > 0);
      let cursor = 0;
      const rects = segments.map(([label, value, color]) => {
        const width = Math.max(1, (value / total) * 1160);
        const rect = '<rect x="' + cursor.toFixed(1) + '" y="0" width="' + width.toFixed(1) + '" height="60" fill="' + color + '"><title>' + label + ': ' + value.toFixed(1) + ' ms</title></rect>';
        cursor += width;
        return rect;
      }).join("");
      return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1160 92" width="1160" height="92"><rect width="1160" height="92" fill="#ffffff"/><g transform="translate(12,16)">' + rects + '</g><text x="12" y="86" font-family="Helvetica Neue, Arial, sans-serif" font-size="14" fill="#334155">E2E complete: ' + total.toFixed(1) + ' ms</text></svg>';
    }

    function downloadSvg(filename, svg) {
      downloadText(filename, svg, "image/svg+xml;charset=utf-8");
    }

    document.querySelectorAll("[data-download]").forEach((button) => {
      button.addEventListener("click", () => {
        const type = button.getAttribute("data-download");
        if (type === "messages-json") {
          downloadText("messages.json", JSON.stringify(MESSAGES, null, 2), "application/json");
          return;
        }
        if (type === "messages-csv") {
          downloadText("messages.csv", MESSAGE_CSV, "text/csv;charset=utf-8");
          return;
        }
        if (type === "hardware-json") {
          downloadText("hardware.json", JSON.stringify(HARDWARE, null, 2), "application/json");
          return;
        }
        if (type === "hardware-csv") {
          downloadText("hardware.csv", HARDWARE_CSV, "text/csv;charset=utf-8");
          return;
        }
        if (type === "message-json") {
          const index = Number(button.getAttribute("data-message-index"));
          downloadText("message-" + index + ".json", JSON.stringify(MESSAGES[index], null, 2), "application/json");
          return;
        }
        if (type === "message-timeline-svg") {
          const index = Number(button.getAttribute("data-message-index"));
          downloadSvg("message-" + index + "-timeline.svg", buildMessageTimelineSvg(MESSAGES[index]));
          return;
        }
        if (type === "message-cpu-svg") {
          const index = Number(button.getAttribute("data-message-index"));
          const svg = document.querySelector('[data-chart-id="message-' + index + '-cpu-window"] svg');
          if (svg) {
            downloadSvg("message-" + index + "-cpu.svg", svg.outerHTML);
          }
          return;
        }
        if (type === "message-gpu-svg") {
          const index = Number(button.getAttribute("data-message-index"));
          const svg = document.querySelector('[data-chart-id="message-' + index + '-gpu-window"] svg');
          if (svg) {
            downloadSvg("message-" + index + "-gpu.svg", svg.outerHTML);
          }
          return;
        }
        if (type === "message-csv") {
          const index = Number(button.getAttribute("data-message-index"));
          downloadText("message-" + index + ".csv", messageToCsv(MESSAGES[index]), "text/csv;charset=utf-8");
          return;
        }
        if (type === "chart-svg") {
          const chartId = button.getAttribute("data-chart-id");
          const svg = chartId ? document.querySelector('[data-chart-id="' + chartId + '"] svg') : null;
          if (svg) {
            downloadSvg(chartId + ".svg", svg.outerHTML);
          }
        }
      });
    });
  </script>
</body>
</html>`;
}
