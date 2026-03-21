import { describe, expect, it } from "vitest";
import type { LatencyAggregateReport } from "./latency-trace-report.js";
import { renderLatencyReportHtml } from "./latency-trace-visualize.js";

describe("latency-trace-visualize", () => {
  it("renders an html dashboard", () => {
    const report: LatencyAggregateReport = {
      recordsScanned: 4,
      messages: [
        {
          key: "feishu|agent|msg1",
          accountId: "agent",
          messageId: "msg1",
          runId: "run1",
          t1FeishuInboundMs: 10,
          t2GatewayEnqueueMs: 20,
          t3WorkerQueueWaitMs: 30,
          t4AgentPreprocessMs: 40,
          t5LlmCallCount: 1,
          t5LlmTtftMs: 100,
          t5LlmTotalMs: 500,
          t5LlmLoadMs: 50,
          t5LlmPrefillMs: 150,
          t5LlmDecodeMs: 250,
          t5InputTokens: 1000,
          t5OutputTokens: 50,
          t5TotalTokens: 1050,
          t5PrefillTokensPerSec: 6666.6,
          t5DecodeTokensPerSec: 200,
          t5TotalTokensPerSec: 2100,
          t5PrefillMsPer1kInputTokens: 150,
          t5DecodeMsPerOutputToken: 5,
          t6FeishuFirstAckMs: 60,
          t6FeishuFinalAckMs: 70,
          localFirstVisibleMs: 260,
          localCompleteMs: 670,
          hardwareGpuUtilAvgPct: 88,
        },
      ],
      series: {
        e2e_local_first_visible_ms: { count: 1, avg: 260, p95: 260, p99: 260 },
        e2e_local_complete_ms: { count: 1, avg: 670, p95: 670, p99: 670 },
        t5_llm_total_ms: { count: 1, avg: 500, p95: 500, p99: 500 },
        t5_llm_decode_tps: { count: 1, avg: 200, p95: 200, p99: 200 },
        hardware_gpu_util_avg_pct: { count: 1, avg: 88, p95: 88, p99: 88 },
        t1_feishu_inbound_ms: { count: 1, avg: 10, p95: 10, p99: 10 },
      },
    };

    const html = renderLatencyReportHtml(report);
    expect(html).toContain("<!doctype html>");
    expect(html).toContain("OpenClaw Latency Dashboard");
    expect(html).toContain("Per-message Timeline");
    expect(html).toContain("msg1");
    expect(html).toContain("E2E Complete Avg");
  });
});
