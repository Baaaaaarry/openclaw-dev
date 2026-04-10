import type { HardwareThreadSample, HardwareTraceSample } from "./hardware-trace.js";
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

type GanttSegment = {
  label: string;
  startedAtMs: number;
  endedAtMs: number;
  color: string;
};

type TimeWindow = {
  startedAtMs: number;
  endedAtMs: number;
};

type ActiveScenarioStage = {
  messageLabel: string;
  stageLabel: string;
  stageKind: "t1" | "t2" | "t3" | "t4" | "rag" | "load" | "prefill" | "decode" | "t6";
};

type ScenarioChangeEvent = {
  index: number;
  epochMs: number;
  elapsedMs: number;
  cpuValue?: number;
  gpuValue?: number;
  cpuDelta?: number;
  gpuDelta?: number;
  activeStages: ActiveScenarioStage[];
  stageText: string;
  topThreads: HardwareThreadSample[];
  threadEvidenceText: string;
  summary: string;
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

function formatLevel(value: number | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "N/A";
  }
  return value.toFixed(1);
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

function formatDelta(value: number | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "N/A";
  }
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(1)} pts`;
}

function formatThreadEvidence(threads: HardwareThreadSample[]): string {
  if (threads.length === 0) {
    return "No thread snapshot";
  }
  return threads
    .slice(0, 3)
    .map((thread) => {
      const command = thread.command ?? "unknown";
      const cpu = formatPct(thread.cpuPct);
      const tid = typeof thread.tid === "number" ? ` tid=${thread.tid}` : "";
      return `${command}${tid} ${cpu}`;
    })
    .join(" | ");
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

function buildMessageGanttSegments(message: LatencyMessageSummary): GanttSegment[] {
  const segments: GanttSegment[] = [];
  const pushWindow = (label: string, color: string, startedAtMs?: number, endedAtMs?: number) => {
    if (
      typeof startedAtMs === "number" &&
      Number.isFinite(startedAtMs) &&
      typeof endedAtMs === "number" &&
      Number.isFinite(endedAtMs) &&
      endedAtMs > startedAtMs
    ) {
      segments.push({ label, color, startedAtMs, endedAtMs });
    }
  };
  pushWindow("T1", "#0f766e", message.t1WindowStartedAtMs, message.t1WindowEndedAtMs);
  pushWindow("T2", "#0ea5e9", message.t2WindowStartedAtMs, message.t2WindowEndedAtMs);
  pushWindow("T3", "#8b5cf6", message.t3WindowStartedAtMs, message.t3WindowEndedAtMs);
  pushWindow("T4", "#d97706", message.t4WindowStartedAtMs, message.t4WindowEndedAtMs);
  pushWindow("T5", "#475569", message.t5WindowStartedAtMs, message.t5WindowEndedAtMs);
  for (const window of message.t5LoadWindows ?? []) {
    pushWindow("Load", "#ef4444", window.startedAtMs, window.endedAtMs);
  }
  for (const window of message.t5PrefillWindows ?? []) {
    pushWindow("Prefill", "#f59e0b", window.startedAtMs, window.endedAtMs);
  }
  for (const window of message.t5DecodeWindows ?? []) {
    pushWindow("Decode", "#22c55e", window.startedAtMs, window.endedAtMs);
  }
  pushWindow("T6", "#ec4899", message.t6WindowStartedAtMs, message.t6WindowEndedAtMs);
  return segments;
}

function isWindowActive(window: TimeWindow | undefined, epochMs: number): boolean {
  return Boolean(
    window &&
    Number.isFinite(window.startedAtMs) &&
    Number.isFinite(window.endedAtMs) &&
    epochMs >= window.startedAtMs &&
    epochMs <= window.endedAtMs,
  );
}

function findActiveScenarioStages(
  messages: LatencyMessageSummary[],
  epochMs: number,
): ActiveScenarioStage[] {
  const active: ActiveScenarioStage[] = [];
  const messageLabelFor = (message: LatencyMessageSummary) =>
    String(message.messageId ?? message.runId ?? message.key);
  const pushStage = (
    message: LatencyMessageSummary,
    stageKind: ActiveScenarioStage["stageKind"],
    stageLabel: string,
  ) => {
    active.push({
      messageLabel: messageLabelFor(message),
      stageKind,
      stageLabel,
    });
  };
  for (const message of messages) {
    const ragWindow =
      typeof message.ragWindowStartedAtMs === "number" &&
      typeof message.ragWindowEndedAtMs === "number"
        ? { startedAtMs: message.ragWindowStartedAtMs, endedAtMs: message.ragWindowEndedAtMs }
        : undefined;
    const t1Window =
      typeof message.t1WindowStartedAtMs === "number" &&
      typeof message.t1WindowEndedAtMs === "number"
        ? { startedAtMs: message.t1WindowStartedAtMs, endedAtMs: message.t1WindowEndedAtMs }
        : undefined;
    const t2Window =
      typeof message.t2WindowStartedAtMs === "number" &&
      typeof message.t2WindowEndedAtMs === "number"
        ? { startedAtMs: message.t2WindowStartedAtMs, endedAtMs: message.t2WindowEndedAtMs }
        : undefined;
    const t3Window =
      typeof message.t3WindowStartedAtMs === "number" &&
      typeof message.t3WindowEndedAtMs === "number"
        ? { startedAtMs: message.t3WindowStartedAtMs, endedAtMs: message.t3WindowEndedAtMs }
        : undefined;
    const t4Window =
      typeof message.t4WindowStartedAtMs === "number" &&
      typeof message.t4WindowEndedAtMs === "number"
        ? { startedAtMs: message.t4WindowStartedAtMs, endedAtMs: message.t4WindowEndedAtMs }
        : undefined;
    const t6Window =
      typeof message.t6WindowStartedAtMs === "number" &&
      typeof message.t6WindowEndedAtMs === "number"
        ? { startedAtMs: message.t6WindowStartedAtMs, endedAtMs: message.t6WindowEndedAtMs }
        : undefined;

    if (isWindowActive(t1Window, epochMs)) {
      pushStage(message, "t1", "T1 inbound");
      continue;
    }
    if (isWindowActive(t2Window, epochMs)) {
      pushStage(message, "t2", "T2 enqueue");
      continue;
    }
    if (isWindowActive(t3Window, epochMs)) {
      pushStage(message, "t3", "T3 queue wait");
      continue;
    }
    const activeLoad = (message.t5LoadWindows ?? []).some((window) =>
      isWindowActive(window, epochMs),
    );
    if (activeLoad) {
      pushStage(message, "load", "T5.load");
      continue;
    }
    const activePrefill = (message.t5PrefillWindows ?? []).some((window) =>
      isWindowActive(window, epochMs),
    );
    if (activePrefill) {
      pushStage(message, "prefill", "T5.prefill");
      continue;
    }
    const activeDecode = (message.t5DecodeWindows ?? []).some((window) =>
      isWindowActive(window, epochMs),
    );
    if (activeDecode) {
      pushStage(message, "decode", "T5.decode");
      continue;
    }
    if (isWindowActive(ragWindow, epochMs)) {
      pushStage(message, "rag", "RAG recall");
      continue;
    }
    if (isWindowActive(t4Window, epochMs)) {
      pushStage(message, "t4", "T4 preprocess");
      continue;
    }
    if (isWindowActive(t6Window, epochMs)) {
      pushStage(message, "t6", "T6 outbound");
    }
  }
  return active;
}

function summarizeActiveStageText(activeStages: ActiveScenarioStage[]): string {
  if (activeStages.length === 0) {
    return "No active tracked stage";
  }
  return activeStages
    .map((stage) => `${stage.messageLabel} / ${stage.stageLabel}`)
    .slice(0, 3)
    .join(" | ");
}

function summarizeScenarioChange(params: {
  activeStages: ActiveScenarioStage[];
  cpuDelta?: number;
  gpuDelta?: number;
  topThreads: HardwareThreadSample[];
}): string {
  const { activeStages, gpuDelta, topThreads } = params;
  const hasStage = (kind: ActiveScenarioStage["stageKind"]) =>
    activeStages.some((stage) => stage.stageKind === kind);
  const dominantThread = topThreads[0]?.command?.toLowerCase() ?? "";
  const dominantCpu = topThreads[0]?.cpuPct;
  if (hasStage("load")) {
    if (dominantThread.includes("ollama")) {
      return "Correlated with T5.load, and the hottest CPU thread belongs to Ollama/runtime. Evidence points to model/runtime side setup rather than steady GPU compute.";
    }
    return "Correlated with T5.load. CPU-side setup dominates at this boundary; use the thread snapshot to distinguish OpenClaw orchestration from runtime/model preparation.";
  }
  if (hasStage("prefill")) {
    if ((gpuDelta ?? 0) >= 18) {
      return "Correlated with T5.prefill. GPU rises as prompt ingestion starts; the thread list shows which process is spending CPU to feed that transition.";
    }
    if ((gpuDelta ?? 0) <= -18) {
      return "Correlated with a prefill boundary. This is a real compute interruption, but the thread snapshot should be used as the primary evidence for who owned the CPU work.";
    }
  }
  if (hasStage("decode")) {
    if ((gpuDelta ?? 0) >= 15) {
      return "Correlated with T5.decode. GPU compute resumed; CPU evidence should usually show only light runtime or streaming overhead.";
    }
    if ((gpuDelta ?? 0) <= -15) {
      return "Correlated with a decode boundary. In multi-call scenes this often marks a handoff to the next load/prefill slice, but confirm with the thread evidence.";
    }
  }
  if (hasStage("rag")) {
    return "Correlated with runtime RAG recall. The thread snapshot shows whether the CPU was busy in retrieval/indexing glue or in the embedding/runtime process.";
  }
  if (hasStage("t4")) {
    return "Correlated with T4 preprocess. This is CPU-side work before the model call; thread evidence should identify whether OpenClaw itself was the hotspot.";
  }
  if (hasStage("t6")) {
    return "Correlated with T6 outbound handling. GPU should already be low here; thread evidence should confirm transport/formatting dominated.";
  }
  if (typeof dominantCpu === "number" && dominantCpu > 0) {
    return "No tracked stage owned this sample strongly enough. Use the top CPU threads as the primary evidence for what code path was active.";
  }
  return "A stage boundary or concurrency change occurred, but the sample has no strong thread evidence. Increase sampling frequency if this point matters.";
}

function buildScenarioChangeEvents(
  report: LatencyAggregateReport,
  hardwareSamples: HardwareTraceSample[],
): ScenarioChangeEvent[] {
  const scenario = report.scenario;
  if (
    !scenario ||
    typeof scenario.startedAtMs !== "number" ||
    !Number.isFinite(scenario.startedAtMs) ||
    typeof scenario.endedAtMs !== "number" ||
    !Number.isFinite(scenario.endedAtMs)
  ) {
    return [];
  }
  const samples = filterSamplesForWindow(
    hardwareSamples,
    scenario.startedAtMs,
    scenario.endedAtMs,
  ).toSorted((left, right) => left.epochMs - right.epochMs);
  const strongCpuDeltaThreshold = 20;
  const strongGpuDeltaThreshold = 28;
  const strongCombinedThreshold = 34;
  const collapseWindowMs = 2_500;
  const maxRenderedEvents = 6;
  const rawEvents: Array<Omit<ScenarioChangeEvent, "index">> = [];
  for (let index = 1; index < samples.length; index += 1) {
    const previous = samples[index - 1];
    const current = samples[index];
    const previousCpu = previous.cpuUtilPct ?? 0;
    const currentCpu = current.cpuUtilPct ?? 0;
    const previousGpu = deriveGpuUtilForSample(previous) ?? 0;
    const currentGpu = deriveGpuUtilForSample(current) ?? 0;
    const cpuDelta = currentCpu - previousCpu;
    const gpuDelta = currentGpu - previousGpu;
    const score = Math.max(Math.abs(cpuDelta), Math.abs(gpuDelta));
    if (
      Math.abs(cpuDelta) < strongCpuDeltaThreshold &&
      Math.abs(gpuDelta) < strongGpuDeltaThreshold &&
      score < strongCombinedThreshold
    ) {
      continue;
    }
    const topThreads = current.topCpuThreads ?? [];
    const activeStages = findActiveScenarioStages(report.messages, current.epochMs);
    const summary = summarizeScenarioChange({
      activeStages,
      cpuDelta,
      gpuDelta,
      topThreads,
    });
    rawEvents.push({
      epochMs: current.epochMs,
      elapsedMs: current.epochMs - scenario.startedAtMs,
      cpuValue: currentCpu,
      gpuValue: currentGpu,
      cpuDelta,
      gpuDelta,
      activeStages,
      stageText: summarizeActiveStageText(activeStages),
      topThreads,
      threadEvidenceText: formatThreadEvidence(topThreads),
      summary,
    });
  }
  const merged: Array<Omit<ScenarioChangeEvent, "index">> = [];
  for (const event of rawEvents) {
    const previous = merged.at(-1);
    const score = Math.max(Math.abs(event.cpuDelta ?? 0), Math.abs(event.gpuDelta ?? 0));
    const previousScore = previous
      ? Math.max(Math.abs(previous.cpuDelta ?? 0), Math.abs(previous.gpuDelta ?? 0))
      : -1;
    if (previous && event.epochMs - previous.epochMs <= collapseWindowMs) {
      if (score > previousScore) {
        merged[merged.length - 1] = event;
      }
      continue;
    }
    merged.push(event);
  }
  const strongest = merged
    .map((event) => ({
      event,
      score: Math.max(Math.abs(event.cpuDelta ?? 0), Math.abs(event.gpuDelta ?? 0)),
    }))
    .toSorted((left, right) => right.score - left.score)
    .slice(0, maxRenderedEvents)
    .map((entry) => entry.event)
    .toSorted((left, right) => left.epochMs - right.epochMs);
  return strongest.map((event, index) => ({ ...event, index: index + 1 }));
}

function renderScenarioChangeLog(events: ScenarioChangeEvent[]): string {
  if (events.length === 0) {
    return "";
  }
  return `
    <section class="mini-panel" style="margin-top:14px">
      <div class="mini-panel-title">Scenario Change Log</div>
      <p class="section-note">Each numbered event is a significant CPU/GPU step change aligned to the tracked software windows. This is a timing correlation, not a PMU-level causal proof, but it is enough to explain what the runtime was doing at each visible jump.</p>
      <table class="series-table">
        <thead>
          <tr>
            <th>#</th>
            <th>Time</th>
            <th>CPU Delta</th>
            <th>GPU Delta</th>
            <th>Active Stage</th>
            <th>Top CPU Threads</th>
            <th>Evidence-based Note</th>
          </tr>
        </thead>
        <tbody>
          ${events
            .map(
              (event) => `
                <tr>
                  <td><span class="event-badge">${event.index}</span></td>
                  <td>${escapeHtml(formatMs(event.elapsedMs))}</td>
                  <td>${escapeHtml(formatDelta(event.cpuDelta))}</td>
                  <td>${escapeHtml(formatDelta(event.gpuDelta))}</td>
                  <td>${escapeHtml(event.stageText)}</td>
                  <td>${escapeHtml(event.threadEvidenceText)}</td>
                  <td>${escapeHtml(event.summary)}</td>
                </tr>`,
            )
            .join("")}
        </tbody>
      </table>
    </section>`;
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
    "topCpuThreads",
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
          JSON.stringify(sample.topCpuThreads ?? []),
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
          JSON.stringify(sample.topCpuThreads ?? []),
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

function countActiveWindowsAt(
  epochMs: number,
  windows: Array<{ startedAtMs: number; endedAtMs: number }>,
): number {
  return windows.reduce(
    (count, window) =>
      epochMs >= window.startedAtMs && epochMs <= window.endedAtMs ? count + 1 : count,
    0,
  );
}

function collectScenarioWindows(report: LatencyAggregateReport): {
  overall: Array<{ startedAtMs: number; endedAtMs: number }>;
  rag: Array<{ startedAtMs: number; endedAtMs: number }>;
  llm: Array<{ startedAtMs: number; endedAtMs: number }>;
} {
  const toWindow = (startedAtMs?: number, endedAtMs?: number) =>
    typeof startedAtMs === "number" &&
    Number.isFinite(startedAtMs) &&
    typeof endedAtMs === "number" &&
    Number.isFinite(endedAtMs) &&
    endedAtMs > startedAtMs
      ? { startedAtMs, endedAtMs }
      : undefined;
  return {
    overall: report.messages
      .map((message) => toWindow(message.overallWindowStartedAtMs, message.overallWindowEndedAtMs))
      .filter(
        (window): window is { startedAtMs: number; endedAtMs: number } => window !== undefined,
      ),
    rag: report.messages
      .map((message) => toWindow(message.ragWindowStartedAtMs, message.ragWindowEndedAtMs))
      .filter(
        (window): window is { startedAtMs: number; endedAtMs: number } => window !== undefined,
      ),
    llm: report.messages
      .map((message) => toWindow(message.t5WindowStartedAtMs, message.t5WindowEndedAtMs))
      .filter(
        (window): window is { startedAtMs: number; endedAtMs: number } => window !== undefined,
      ),
  };
}

function buildScenarioActivityMetric(params: {
  report: LatencyAggregateReport;
  samples: HardwareTraceSample[];
  kind: "messages" | "rag" | "llm";
}): ChartMetric {
  const scenario = params.report.scenario;
  const startedAtMs = scenario?.startedAtMs;
  const endedAtMs = scenario?.endedAtMs;
  const windows = collectScenarioWindows(params.report);
  const scopedSamples = filterSamplesForWindow(params.samples, startedAtMs, endedAtMs);
  const targetWindows =
    params.kind === "messages"
      ? windows.overall
      : params.kind === "rag"
        ? windows.rag
        : windows.llm;
  return {
    id: `scenario-${params.kind}-activity`,
    title:
      params.kind === "messages"
        ? "Scenario Message Concurrency"
        : params.kind === "rag"
          ? "Scenario RAG Recall Concurrency"
          : "Scenario LLM Concurrency",
    unit: "count",
    points: scopedSamples.map((sample, index) => ({
      x:
        typeof startedAtMs === "number" && Number.isFinite(startedAtMs)
          ? Math.max(0, sample.epochMs - startedAtMs)
          : index,
      y: countActiveWindowsAt(sample.epochMs, targetWindows),
    })),
    xAxisLabel: "Elapsed Time (ms)",
  };
}

function buildScenarioHardwareMetric(params: {
  report: LatencyAggregateReport;
  samples: HardwareTraceSample[];
  kind: "cpu" | "gpu";
}): ChartMetric {
  const scenario = params.report.scenario;
  const startedAtMs = scenario?.startedAtMs;
  const endedAtMs = scenario?.endedAtMs;
  const scopedSamples = filterSamplesForWindow(params.samples, startedAtMs, endedAtMs);
  return {
    id: `scenario-${params.kind}-window`,
    title: params.kind === "cpu" ? "Scenario CPU Utilization" : "Scenario GPU Utilization",
    unit: "%",
    points: scopedSamples.map((sample, index) => ({
      x:
        typeof startedAtMs === "number" && Number.isFinite(startedAtMs)
          ? Math.max(0, sample.epochMs - startedAtMs)
          : index,
      y: params.kind === "cpu" ? sample.cpuUtilPct : deriveGpuUtilForSample(sample),
    })),
    xAxisLabel: "Elapsed Time (ms)",
  };
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

function renderMessageStageHardwareMatrix(message: LatencyMessageSummary): string {
  const rows: Array<{
    label: string;
    duration?: number;
    summary?: HardwareWindowSummary;
  }> = [
    { label: "T1", duration: message.t1FeishuInboundMs, summary: message.hardwareT1 },
    { label: "T2", duration: message.t2GatewayEnqueueMs, summary: message.hardwareT2 },
    { label: "T3", duration: message.t3WorkerQueueWaitMs, summary: message.hardwareT3 },
    { label: "T4", duration: message.t4AgentPreprocessMs, summary: message.hardwareT4 },
    { label: "T4.rag", duration: message.t4RagRecallMs, summary: message.hardwareRag },
    { label: "T5.total", duration: message.t5LlmTotalMs, summary: message.hardwareLlm },
    { label: "T5.load", duration: message.t5LlmLoadMs, summary: message.hardwareT5Load },
    { label: "T5.prefill", duration: message.t5LlmPrefillMs, summary: message.hardwareT5Prefill },
    { label: "T5.decode", duration: message.t5LlmDecodeMs, summary: message.hardwareT5Decode },
    { label: "T6", duration: message.t6FeishuFinalAckMs, summary: message.hardwareT6 },
  ].filter(
    (row) =>
      (typeof row.duration === "number" && Number.isFinite(row.duration) && row.duration > 0) ||
      row.summary?.sampleCount,
  );
  if (rows.length === 0) {
    return "";
  }
  return `
    <section class="panel" style="margin-top:16px">
      <h3>Stage Hardware Matrix</h3>
      <p class="section-note">Each row aligns one message stage to its observed CPU/GPU window. Values are whole-machine sampled load within that stage window, not per-process attribution.</p>
      <table class="series-table">
        <thead>
          <tr>
            <th>Stage</th>
            <th>Duration</th>
            <th>CPU Avg</th>
            <th>CPU Max</th>
            <th>GPU Avg</th>
            <th>GPU Max</th>
            <th>GPU Power Avg</th>
            <th>GPU Power Max</th>
            <th>Placement</th>
          </tr>
        </thead>
        <tbody>
          ${rows
            .map(
              (row) => `
                <tr>
                  <td>${escapeHtml(row.label)}</td>
                  <td>${escapeHtml(formatMs(row.duration))}</td>
                  <td>${escapeHtml(formatPct(row.summary?.cpuUtilAvgPct))}</td>
                  <td>${escapeHtml(formatPct(row.summary?.cpuUtilMaxPct))}</td>
                  <td>${escapeHtml(formatPct(row.summary?.gpuUtilAvgPct))}</td>
                  <td>${escapeHtml(formatPct(row.summary?.gpuUtilMaxPct))}</td>
                  <td>${escapeHtml(formatWatts(row.summary?.gpuPowerAvgW))}</td>
                  <td>${escapeHtml(formatWatts(row.summary?.gpuPowerMaxW))}</td>
                  <td>${escapeHtml(row.summary?.computePlacement ?? "N/A")}</td>
                </tr>`,
            )
            .join("")}
        </tbody>
      </table>
    </section>`;
}

function renderScenarioSection(
  report: LatencyAggregateReport,
  hardwareSamples: HardwareTraceSample[],
): string {
  if (!report.scenario) {
    return "";
  }
  const scenario = report.scenario;
  const metrics = [
    buildScenarioActivityMetric({ report, samples: hardwareSamples, kind: "messages" }),
    buildScenarioActivityMetric({ report, samples: hardwareSamples, kind: "llm" }),
    buildScenarioHardwareMetric({ report, samples: hardwareSamples, kind: "cpu" }),
    buildScenarioHardwareMetric({ report, samples: hardwareSamples, kind: "gpu" }),
  ];
  const cards = [
    ["Duration", formatMs(scenario.durationMs), `${scenario.messageCount} messages`],
    [
      "RAG Messages",
      formatCount(scenario.ragMessageCount),
      `${formatCount(scenario.llmCallCount)} llm calls`,
    ],
    [
      "Peak Messages",
      formatCount(scenario.activeMessagesMax),
      `avg ${formatLevel(scenario.activeMessagesAvg)}`,
    ],
    ["Peak LLM", formatCount(scenario.activeLlmMax), `avg ${formatLevel(scenario.activeLlmAvg)}`],
    ["Peak RAG", formatCount(scenario.activeRagMax), `avg ${formatLevel(scenario.activeRagAvg)}`],
    [
      "Scenario GPU Avg",
      formatPct(scenario.hardware?.gpuUtilAvgPct),
      `max ${formatPct(scenario.hardware?.gpuUtilMaxPct)}`,
    ],
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

  const activityRows: Array<[string, string, string]> = [
    [
      "Active Messages",
      formatLevel(scenario.activeMessagesAvg),
      formatCount(scenario.activeMessagesMax),
    ],
    ["Active T4", formatLevel(scenario.activeT4Avg), formatCount(scenario.activeT4Max)],
    ["Active RAG", formatLevel(scenario.activeRagAvg), formatCount(scenario.activeRagMax)],
    ["Active LLM", formatLevel(scenario.activeLlmAvg), formatCount(scenario.activeLlmMax)],
    [
      "Active T5 Load",
      formatLevel(scenario.activeT5LoadAvg),
      formatCount(scenario.activeT5LoadMax),
    ],
    [
      "Active T5 Prefill",
      formatLevel(scenario.activeT5PrefillAvg),
      formatCount(scenario.activeT5PrefillMax),
    ],
    [
      "Active T5 Decode",
      formatLevel(scenario.activeT5DecodeAvg),
      formatCount(scenario.activeT5DecodeMax),
    ],
  ];

  return `
    <section class="panel" style="margin-top:20px">
      <h2>Scenario Timeline</h2>
      <p class="section-note">This section treats the full capture window as one complex scene and shows aggregate concurrency plus scene-wide CPU/GPU behavior. It is intended for multi-agent, multi-message, and RAG-heavy workloads where message-by-message cards hide the overall pressure pattern.</p>
      <div class="kpi-grid">${cards}</div>
      <div class="chart-grid">
        ${metrics
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
          .join("")}
      </div>
      <div class="message-hardware-grid">
        ${renderHardwareWindowCard("Scenario Hardware", scenario.hardware)}
        <section class="mini-panel">
          <div class="mini-panel-title">Scenario Stage Activity</div>
          <table class="compact-table">
            <thead><tr><th>Metric</th><th>Avg</th><th>Max</th></tr></thead>
            <tbody>${activityRows
              .map(
                ([label, avg, max]) =>
                  `<tr><td>${escapeHtml(label)}</td><td>${escapeHtml(avg)}</td><td>${escapeHtml(max)}</td></tr>`,
              )
              .join("")}</tbody>
          </table>
        </section>
      </div>
    </section>`;
}

function renderScenarioMessageGantt(report: LatencyAggregateReport): string {
  const scenario = report.scenario;
  if (
    !scenario ||
    typeof scenario.startedAtMs !== "number" ||
    !Number.isFinite(scenario.startedAtMs) ||
    typeof scenario.endedAtMs !== "number" ||
    !Number.isFinite(scenario.endedAtMs) ||
    scenario.endedAtMs <= scenario.startedAtMs
  ) {
    return "";
  }
  const scenarioStartedAtMs = scenario.startedAtMs;
  const scenarioEndedAtMs = scenario.endedAtMs;
  const width = 1160;
  const laneHeight = 32;
  const laneGap = 14;
  const paddingLeft = 190;
  const paddingRight = 28;
  const paddingTop = 24;
  const paddingBottom = 34;
  const timelineWidth = width - paddingLeft - paddingRight;
  const totalMs = scenarioEndedAtMs - scenarioStartedAtMs;
  const height =
    paddingTop +
    paddingBottom +
    report.messages.length * laneHeight +
    Math.max(0, report.messages.length - 1) * laneGap;
  const scaleX = (ts: number) =>
    paddingLeft + ((ts - scenarioStartedAtMs) / totalMs) * timelineWidth;
  const ticks = 6;
  const gridLines = Array.from({ length: ticks + 1 }, (_, index) => {
    const ratio = index / ticks;
    const x = paddingLeft + ratio * timelineWidth;
    return { x, label: `${Math.round(ratio * totalMs)} ms` };
  });
  const rows = report.messages
    .map((message, index) => {
      const y = paddingTop + index * (laneHeight + laneGap);
      const label = String(message.messageId ?? message.key);
      const segments = buildMessageGanttSegments(message)
        .map((segment) => {
          const x = scaleX(segment.startedAtMs);
          const widthPx = Math.max(2, scaleX(segment.endedAtMs) - x);
          return `<rect x="${x.toFixed(1)}" y="${y}" width="${widthPx.toFixed(1)}" height="${laneHeight}" rx="6" ry="6" fill="${segment.color}" opacity="${segment.label === "T5" ? "0.20" : "0.95"}"><title>${escapeHtml(`${label} ${segment.label}: ${segment.endedAtMs - segment.startedAtMs} ms`)}</title></rect>`;
        })
        .join("");
      return `
        <text x="${paddingLeft - 12}" y="${y + laneHeight / 2 + 5}" text-anchor="end" class="axis-label">${escapeHtml(label)}</text>
        <rect x="${paddingLeft}" y="${y}" width="${timelineWidth}" height="${laneHeight}" rx="6" ry="6" fill="rgba(148,163,184,0.06)" />
        ${segments}`;
    })
    .join("");

  return `
    <section class="panel" style="margin-top:20px">
      <h2>Scenario Message Gantt</h2>
      <p class="section-note">Each row is one message over the full task window. Bars show the real stage windows, including reconstructed T5 load/prefill/decode slices, so you can see where software stages overlap and when work is handed to the GPU-heavy inference path.</p>
      <div class="download-row small">
        <button class="dl-btn" data-download="scenario-gantt-svg">Download scenario gantt SVG</button>
      </div>
      <svg class="gantt-svg" data-scenario-gantt="true" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" role="img" aria-label="Scenario Message Gantt">
        <rect width="${width}" height="${height}" fill="#ffffff" />
        ${gridLines
          .map(
            (line) => `
              <line x1="${line.x.toFixed(1)}" y1="${paddingTop - 6}" x2="${line.x.toFixed(1)}" y2="${height - paddingBottom + 2}" class="guide stage-guide" />
              <text x="${line.x.toFixed(1)}" y="${height - 8}" text-anchor="middle" class="axis-label">${escapeHtml(line.label)}</text>`,
          )
          .join("")}
        ${rows}
        <text x="${width / 2}" y="16" text-anchor="middle" class="chart-overlay-title">Scenario Message Gantt</text>
      </svg>
    </section>`;
}

function renderScenarioCpuGpuOverlay(
  report: LatencyAggregateReport,
  hardwareSamples: HardwareTraceSample[],
): string {
  const scenario = report.scenario;
  if (
    !scenario ||
    typeof scenario.startedAtMs !== "number" ||
    !Number.isFinite(scenario.startedAtMs) ||
    typeof scenario.endedAtMs !== "number" ||
    !Number.isFinite(scenario.endedAtMs)
  ) {
    return "";
  }
  const samples = filterSamplesForWindow(hardwareSamples, scenario.startedAtMs, scenario.endedAtMs);
  if (samples.length === 0) {
    return "";
  }
  const changeEvents = buildScenarioChangeEvents(report, hardwareSamples);
  const width = 1160;
  const height = 260;
  const paddingLeft = 110;
  const paddingRight = 28;
  const paddingTop = 42;
  const paddingBottom = 42;
  const scenarioStartedAtMs = scenario.startedAtMs;
  const totalMs = Math.max(1, scenario.endedAtMs - scenarioStartedAtMs);
  const yForPct = (value: number) =>
    height -
    paddingBottom -
    (Math.max(0, Math.min(100, value)) / 100) * (height - paddingTop - paddingBottom);
  const pointsToPolyline = (values: number[]) =>
    values
      .map((value, index) => {
        const sample = samples[index];
        const x =
          paddingLeft +
          ((sample.epochMs - scenarioStartedAtMs) / totalMs) * (width - paddingLeft - paddingRight);
        const y = yForPct(value);
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ");
  const cpuValues = samples.map((sample) => sample.cpuUtilPct ?? 0);
  const gpuValues = samples.map((sample) => deriveGpuUtilForSample(sample) ?? 0);
  const cpuPolyline = pointsToPolyline(cpuValues);
  const gpuPolyline = pointsToPolyline(gpuValues);
  const avgCpu = cpuValues.reduce((sum, value) => sum + value, 0) / Math.max(1, cpuValues.length);
  const avgGpu = gpuValues.reduce((sum, value) => sum + value, 0) / Math.max(1, gpuValues.length);
  const maxCpu = Math.max(...cpuValues);
  const maxGpu = Math.max(...gpuValues);
  const axisLabels = [
    { text: `max ${formatPct(maxCpu)}`, color: "#0f766e", y: yForPct(maxCpu) },
    { text: `avg ${formatPct(avgCpu)}`, color: "#0f766e", y: yForPct(avgCpu) },
    { text: `max ${formatPct(maxGpu)}`, color: "#f97316", y: yForPct(maxGpu) },
    { text: `avg ${formatPct(avgGpu)}`, color: "#f97316", y: yForPct(avgGpu) },
  ]
    .toSorted((left, right) => left.y - right.y)
    .map((entry, index, items) => {
      const previous = items[index - 1];
      const minGap = 12;
      const unclampedY =
        previous && Math.abs(entry.y - previous.y) < minGap ? previous.y + minGap : entry.y;
      return {
        ...entry,
        y: Math.max(paddingTop + 10, Math.min(height - paddingBottom - 2, unclampedY)),
      };
    });
  const legendBoxX = width - 188;
  const legendBoxY = 8;
  const legendBoxWidth = 170;
  const legendBoxHeight = 46;
  const markerCircles = changeEvents
    .map((event) => {
      const x = paddingLeft + (event.elapsedMs / totalMs) * (width - paddingLeft - paddingRight);
      return `
        <line x1="${x.toFixed(1)}" y1="${paddingTop}" x2="${x.toFixed(1)}" y2="${height - paddingBottom}" stroke="rgba(15,23,42,0.10)" stroke-width="1" stroke-dasharray="3 5" />
        <circle cx="${x.toFixed(1)}" cy="${paddingTop + 10}" r="9" fill="#111827" opacity="0.92" />
        <text x="${x.toFixed(1)}" y="${paddingTop + 14}" text-anchor="middle" class="event-marker-text">${event.index}</text>`;
    })
    .join("");
  return `
    <section class="panel" style="margin-top:20px">
      <h2>Scenario CPU/GPU Overlay</h2>
      <p class="section-note">CPU and GPU utilization on the same scene-wide time axis as the gantt, so you can visually match software stage overlaps with hardware pressure changes. Numbered markers indicate significant utilization jumps; the change log below explains what each jump corresponds to.</p>
      <div class="download-row small">
        <button class="dl-btn" data-download="scenario-cpu-gpu-svg">Download scenario CPU/GPU SVG</button>
      </div>
      <svg class="gantt-svg" data-scenario-overlay="true" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" role="img" aria-label="Scenario CPU GPU Overlay">
        <rect width="${width}" height="${height}" fill="#ffffff" />
        <line x1="${paddingLeft}" y1="${height - paddingBottom}" x2="${width - paddingRight}" y2="${height - paddingBottom}" class="axis" />
        <line x1="${paddingLeft}" y1="${paddingTop}" x2="${paddingLeft}" y2="${height - paddingBottom}" class="axis" />
        <line x1="${paddingLeft}" y1="${yForPct(avgCpu)}" x2="${width - paddingRight}" y2="${yForPct(avgCpu)}" class="guide avg-guide" />
        <line x1="${paddingLeft}" y1="${yForPct(avgGpu)}" x2="${width - paddingRight}" y2="${yForPct(avgGpu)}" class="guide stage-guide" />
        <line x1="${paddingLeft}" y1="${yForPct(maxCpu)}" x2="${width - paddingRight}" y2="${yForPct(maxCpu)}" class="guide avg-guide" stroke-opacity="0.45" />
        <line x1="${paddingLeft}" y1="${yForPct(maxGpu)}" x2="${width - paddingRight}" y2="${yForPct(maxGpu)}" class="guide stage-guide" stroke-opacity="0.45" />
        ${markerCircles}
        <polyline points="${cpuPolyline}" fill="none" stroke="#0f766e" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" />
        <polyline points="${gpuPolyline}" fill="none" stroke="#f97316" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" />
        <text x="${width / 2}" y="18" text-anchor="middle" class="chart-overlay-title">Scenario CPU/GPU Utilization</text>
        <text x="${width / 2}" y="34" text-anchor="middle" class="chart-overlay-subtitle">${escapeHtml(`CPU avg: ${formatPct(avgCpu)} | GPU avg: ${formatPct(avgGpu)}`)}</text>
        <text x="${paddingLeft}" y="${height - 10}" text-anchor="start" class="axis-label">0 ms</text>
        <text x="${width - paddingRight}" y="${height - 10}" text-anchor="end" class="axis-label">${escapeHtml(`${Math.round(totalMs)} ms`)}</text>
        <text x="18" y="${height / 2}" text-anchor="middle" transform="rotate(-90 18 ${height / 2})" class="axis-label">Utilization (%)</text>
        ${axisLabels
          .map(
            (entry) => `
              <line x1="${paddingLeft - 6}" y1="${entry.y.toFixed(1)}" x2="${paddingLeft}" y2="${entry.y.toFixed(1)}" class="tick" style="stroke:${entry.color};stroke-opacity:0.85" />
              <text x="${paddingLeft - 10}" y="${(entry.y + 4).toFixed(1)}" text-anchor="end" class="axis-label" style="fill:${entry.color};font-weight:600">${escapeHtml(entry.text)}</text>`,
          )
          .join("")}
        <rect x="${legendBoxX}" y="${legendBoxY}" width="${legendBoxWidth}" height="${legendBoxHeight}" rx="8" ry="8" fill="rgba(255,255,255,0.92)" stroke="rgba(15,23,42,0.12)" />
        <line x1="${legendBoxX + 10}" y1="${legendBoxY + 16}" x2="${legendBoxX + 42}" y2="${legendBoxY + 16}" stroke="#0f766e" stroke-width="3" />
        <text x="${legendBoxX + 50}" y="${legendBoxY + 20}" class="axis-label">CPU</text>
        <line x1="${legendBoxX + 10}" y1="${legendBoxY + 32}" x2="${legendBoxX + 42}" y2="${legendBoxY + 32}" stroke="#f97316" stroke-width="3" />
        <text x="${legendBoxX + 50}" y="${legendBoxY + 36}" class="axis-label">GPU</text>
      </svg>
      ${renderScenarioChangeLog(changeEvents)}
    </section>`;
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
          ${renderMessageStageHardwareMatrix(message)}
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
    .gantt-svg { width: 100%; height: 320px; display: block; background: linear-gradient(180deg, rgba(15,118,110,0.04), rgba(15,118,110,0.01)); border-radius: 12px; }
    .axis { stroke: rgba(15,23,42,0.16); stroke-width: 1; }
    .tick { stroke: rgba(15,23,42,0.22); stroke-width: 1; }
    .guide { stroke-width: 1.8; stroke-dasharray: 6 4; }
    .avg-guide { stroke: #16a34a; }
    .max-guide { stroke: #dc2626; }
    .stage-guide { stroke: rgba(15, 23, 42, 0.2); stroke-width: 1.2; stroke-dasharray: 3 3; }
    .axis-label { fill: #6b7280; font-size: 11px; font-family: "Helvetica Neue", Arial, sans-serif; }
    .chart-overlay-title { fill: #111827; font-size: 16px; font-family: "Helvetica Neue", Arial, sans-serif; font-weight: 700; }
    .chart-overlay-subtitle { fill: #374151; font-size: 13px; font-family: "Helvetica Neue", Arial, sans-serif; }
    .event-marker-text { fill: #ffffff; font-size: 11px; font-family: "Helvetica Neue", Arial, sans-serif; font-weight: 700; }
    .event-badge {
      display: inline-grid;
      place-items: center;
      min-width: 22px;
      height: 22px;
      padding: 0 6px;
      border-radius: 999px;
      background: #111827;
      color: #ffffff;
      font: 700 12px/1 "Helvetica Neue", Arial, sans-serif;
    }
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

    ${renderScenarioSection(report, hardwareSamples)}
    ${renderScenarioMessageGantt(report)}
    ${renderScenarioCpuGpuOverlay(report, hardwareSamples)}
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
        if (type === "scenario-gantt-svg") {
          const svg = document.querySelector('[data-scenario-gantt="true"]');
          if (svg) {
            downloadSvg("scenario-message-gantt.svg", svg.outerHTML);
          }
          return;
        }
        if (type === "scenario-cpu-gpu-svg") {
          const svg = document.querySelector('[data-scenario-overlay="true"]');
          if (svg) {
            downloadSvg("scenario-cpu-gpu-overlay.svg", svg.outerHTML);
          }
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
