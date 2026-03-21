import type { LatencyAggregateReport, LatencyMessageSummary } from "./latency-trace-report.js";

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatMs(value: number | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "-";
  }
  return `${value.toFixed(1)} ms`;
}

function formatPct(value: number | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "-";
  }
  return `${value.toFixed(1)}%`;
}

function formatCount(value: number | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "-";
  }
  return String(Math.round(value));
}

function formatWatts(value: number | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "-";
  }
  return `${value.toFixed(1)} W`;
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

type StageBar = {
  label: string;
  value?: number;
  color: string;
};

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

function renderStageBar(message: LatencyMessageSummary): string {
  const total = message.localCompleteMs;
  const segments = buildCompleteStageBars(message)
    .filter(
      (segment) =>
        typeof segment.value === "number" && Number.isFinite(segment.value) && segment.value > 0,
    )
    .map((segment) => {
      const width = ratioPercent(segment.value, total);
      return `<div class="segment" style="width:${width}%;background:${segment.color}" title="${escapeHtml(`${segment.label}: ${formatMs(segment.value)}`)}"></div>`;
    })
    .join("");
  return `<div class="stacked-bar">${segments || `<div class="segment empty"></div>`}</div>`;
}

function renderLegend(): string {
  const labels = buildCompleteStageBars({ key: "legend" }).map(
    (segment) =>
      `<span class="legend-item"><span class="legend-dot" style="background:${segment.color}"></span>${escapeHtml(segment.label)}</span>`,
  );
  return `<div class="legend">${labels.join("")}</div>`;
}

function renderKpiCards(report: LatencyAggregateReport): string {
  const complete = report.series.e2e_local_complete_ms;
  const first = report.series.e2e_local_first_visible_ms;
  const llm = report.series.t5_llm_total_ms;
  const decodeTps = report.series.t5_llm_decode_tps;
  const gpu = report.series.hardware_gpu_util_avg_pct;
  const cards = [
    ["Messages", String(report.messages.length), `${report.recordsScanned} records scanned`],
    ["E2E First Avg", formatMs(first?.avg), `P95 ${formatMs(first?.p95)}`],
    ["E2E Complete Avg", formatMs(complete?.avg), `P95 ${formatMs(complete?.p95)}`],
    ["LLM Total Avg", formatMs(llm?.avg), `P95 ${formatMs(llm?.p95)}`],
    ["Decode TPS Avg", formatCount(decodeTps?.avg), `P95 ${formatCount(decodeTps?.p95)}`],
    ["GPU Util Avg", formatPct(gpu?.avg), `P95 ${formatPct(gpu?.p95)}`],
  ];
  return cards
    .map(
      ([title, value, subtitle]) => `
        <section class="kpi-card">
          <div class="kpi-title">${escapeHtml(title)}</div>
          <div class="kpi-value">${escapeHtml(value)}</div>
          <div class="kpi-subtitle">${escapeHtml(subtitle)}</div>
        </section>`,
    )
    .join("");
}

function renderMessageCards(messages: LatencyMessageSummary[]): string {
  return messages
    .map((message) => {
      const rows = [
        ["Message", String(message.messageId ?? "-")],
        ["Run", String(message.runId ?? "-")],
        ["Calls", formatCount(message.t5LlmCallCount)],
        ["Input Tokens", formatCount(message.t5InputTokens)],
        ["Output Tokens", formatCount(message.t5OutputTokens)],
        ["Total Tokens", formatCount(message.t5TotalTokens)],
        ["Prefill TPS", formatCount(message.t5PrefillTokensPerSec)],
        ["Decode TPS", formatCount(message.t5DecodeTokensPerSec)],
        ["Total TPS", formatCount(message.t5TotalTokensPerSec)],
        ["E2E First", formatMs(message.localFirstVisibleMs)],
        ["E2E Complete", formatMs(message.localCompleteMs)],
        ["HW GPU Avg", formatPct(message.hardwareGpuUtilAvgPct)],
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
          <div class="message-grid">${rows}</div>
        </article>`;
    })
    .join("");
}

function renderSeriesTable(report: LatencyAggregateReport): string {
  const rows = [
    ["t1_feishu_inbound_ms", "Feishu inbound"],
    ["t2_gateway_enqueue_ms", "Gateway enqueue"],
    ["t3_worker_queue_wait_ms", "Worker queue"],
    ["t4_agent_preprocess_ms", "Agent preprocess"],
    ["t5_llm_total_ms", "LLM total"],
    ["t5_llm_load_ms", "LLM load"],
    ["t5_llm_prefill_ms", "LLM prefill"],
    ["t5_llm_decode_ms", "LLM decode"],
    ["t5_llm_input_tokens", "Input tokens"],
    ["t5_llm_output_tokens", "Output tokens"],
    ["t5_llm_prefill_tps", "Prefill TPS"],
    ["t5_llm_decode_tps", "Decode TPS"],
    ["t5_llm_total_tps", "Total TPS"],
    ["hardware_gpu_util_avg_pct", "GPU util avg"],
    ["hardware_gpu_power_avg_w", "GPU power avg"],
  ]
    .map(([key, label]) => {
      const series = report.series[key];
      const formatter =
        key.endsWith("_tokens") || key.endsWith("_tps")
          ? formatCount
          : key.endsWith("_pct")
            ? formatPct
            : key.endsWith("_avg_w")
              ? formatWatts
              : formatMs;
      return `<tr>
        <td>${escapeHtml(label)}</td>
        <td>${series?.count ?? 0}</td>
        <td>${escapeHtml(formatter(series?.avg))}</td>
        <td>${escapeHtml(formatter(series?.p95))}</td>
        <td>${escapeHtml(formatter(series?.p99))}</td>
      </tr>`;
    })
    .join("");
  return `<table class="series-table">
    <thead><tr><th>Metric</th><th>Count</th><th>Avg</th><th>P95</th><th>P99</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

export function renderLatencyReportHtml(report: LatencyAggregateReport): string {
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
    .wrap {
      max-width: 1320px;
      margin: 0 auto;
      padding: 28px 24px 64px;
    }
    .hero {
      display: grid;
      gap: 8px;
      margin-bottom: 24px;
    }
    h1 {
      margin: 0;
      font-size: 34px;
      letter-spacing: -0.03em;
    }
    .hero p {
      margin: 0;
      color: var(--muted);
      max-width: 880px;
    }
    .panel {
      background: var(--panel);
      border: 1px solid var(--line);
      box-shadow: var(--shadow);
      border-radius: 22px;
      padding: 20px;
      backdrop-filter: blur(18px);
    }
    .kpi-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 14px;
      margin-bottom: 20px;
    }
    .kpi-card {
      background: rgba(255,255,255,0.74);
      border: 1px solid var(--line);
      border-radius: 18px;
      padding: 16px;
    }
    .kpi-title { color: var(--muted); font-size: 12px; text-transform: uppercase; letter-spacing: 0.08em; }
    .kpi-value { margin-top: 8px; font-size: 28px; font-weight: 700; font-family: "Avenir Next Condensed", "Helvetica Neue", sans-serif; }
    .kpi-subtitle { margin-top: 4px; color: var(--muted); }
    h2 {
      margin: 0 0 14px;
      font: 600 18px/1.2 "Avenir Next Condensed", "Helvetica Neue", sans-serif;
      letter-spacing: 0.01em;
    }
    .legend {
      display: flex;
      flex-wrap: wrap;
      gap: 10px 14px;
      margin-bottom: 16px;
      color: var(--muted);
    }
    .legend-item { display: inline-flex; align-items: center; gap: 8px; }
    .legend-dot { width: 10px; height: 10px; border-radius: 999px; display: inline-block; }
    .message-list {
      display: grid;
      gap: 14px;
    }
    .message-card {
      border: 1px solid var(--line);
      border-radius: 18px;
      padding: 16px;
      background: rgba(255,255,255,0.7);
    }
    .message-header {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      align-items: baseline;
      margin-bottom: 12px;
    }
    .message-title { font-weight: 700; font-size: 18px; }
    .message-subtitle { color: var(--muted); font-size: 12px; word-break: break-all; }
    .message-e2e { font: 700 24px/1 "Avenir Next Condensed", "Helvetica Neue", sans-serif; }
    .stacked-bar {
      display: flex;
      width: 100%;
      height: 18px;
      overflow: hidden;
      border-radius: 999px;
      background: rgba(148,163,184,0.14);
      border: 1px solid rgba(148,163,184,0.18);
      margin-bottom: 12px;
    }
    .segment { height: 100%; }
    .segment.empty { width: 100%; background: rgba(148,163,184,0.16); }
    .message-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 8px 18px;
    }
    .meta-row {
      display: flex;
      justify-content: space-between;
      gap: 10px;
      border-top: 1px dashed rgba(148,163,184,0.2);
      padding-top: 6px;
    }
    .meta-label { color: var(--muted); }
    .meta-value { font-weight: 600; }
    .series-table {
      width: 100%;
      border-collapse: collapse;
      overflow: hidden;
      border-radius: 16px;
      background: rgba(255,255,255,0.76);
    }
    .series-table th, .series-table td {
      padding: 10px 12px;
      border-bottom: 1px solid rgba(148,163,184,0.16);
      text-align: left;
    }
    .series-table th {
      color: var(--muted);
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0.08em;
    }
    .notes {
      margin-top: 20px;
      color: var(--muted);
      display: grid;
      gap: 6px;
    }
    @media (max-width: 800px) {
      .wrap { padding: 18px 14px 40px; }
      h1 { font-size: 28px; }
      .message-header { flex-direction: column; align-items: flex-start; }
    }
  </style>
</head>
<body>
  <main class="wrap">
    <section class="hero">
      <h1>OpenClaw Latency Dashboard</h1>
      <p>Per-message latency, LLM token efficiency, and optional hardware utilization correlated to the T5 inference window.</p>
    </section>

    <section class="panel">
      <h2>Overview</h2>
      <div class="kpi-grid">${renderKpiCards(report)}</div>
    </section>

    <section class="panel" style="margin-top:20px">
      <h2>Per-message Timeline</h2>
      ${renderLegend()}
      <div class="message-list">${renderMessageCards(report.messages)}</div>
    </section>

    <section class="panel" style="margin-top:20px">
      <h2>Series Summary</h2>
      ${renderSeriesTable(report)}
    </section>

    <section class="notes">
      <div>Note: T6.first and T6.final are measured from different start points, so T6.final can be lower than T6.first.</div>
      <div>Note: HW.gpuMem.avg is blank when GPU memory capacity or usage samples are unavailable from the runtime platform.</div>
    </section>
  </main>
</body>
</html>`;
}
