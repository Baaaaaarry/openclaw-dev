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
          t4RagRecallMs: 15,
          t4RagRecallResults: 2,
          ragUsed: true,
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
          t1WindowStartedAtMs: 1_000,
          t1WindowEndedAtMs: 1_010,
          t2WindowStartedAtMs: 1_010,
          t2WindowEndedAtMs: 1_030,
          t3WindowStartedAtMs: 1_030,
          t3WindowEndedAtMs: 1_060,
          t4WindowStartedAtMs: 1_060,
          t4WindowEndedAtMs: 1_100,
          t5WindowStartedAtMs: 1_100,
          t5WindowEndedAtMs: 1_600,
          t6WindowStartedAtMs: 1_600,
          t6WindowEndedAtMs: 1_670,
          overallWindowStartedAtMs: 1_000,
          overallWindowEndedAtMs: 1_670,
          hardwareRag: {
            sampleCount: 1,
            cpuUtilAvgPct: 30,
            cpuUtilMaxPct: 30,
            gpuUtilAvgPct: 10,
            gpuUtilMaxPct: 10,
            gpuMemUtilAvgPct: 12,
            gpuMemUtilMaxPct: 12,
            gpuPowerAvgW: 8,
            gpuPowerMaxW: 8,
            gpuMemBandwidthEstimateAvgGBps: 24,
            gpuMemBandwidthEstimateMaxGBps: 24,
            gpuMemBandwidthPeakAvgGBps: 240,
            gpuMemBandwidthPeakMaxGBps: 240,
            gpuPcieLinkGenAvg: 5,
            gpuPcieLinkGenMax: 5,
            gpuPcieLinkWidthAvg: 16,
            gpuPcieLinkWidthMax: 16,
            computePlacement: "cpu-biased",
          },
          hardwareLlm: {
            sampleCount: 1,
            cpuUtilAvgPct: 18,
            cpuUtilMaxPct: 18,
            gpuUtilAvgPct: 88,
            gpuUtilMaxPct: 88,
            gpuMemUtilAvgPct: 66,
            gpuMemUtilMaxPct: 66,
            gpuPowerAvgW: 40,
            gpuPowerMaxW: 40,
            gpuMemBandwidthEstimateAvgGBps: 180,
            gpuMemBandwidthEstimateMaxGBps: 180,
            gpuMemBandwidthPeakAvgGBps: 240,
            gpuMemBandwidthPeakMaxGBps: 240,
            gpuPcieLinkGenAvg: 5,
            gpuPcieLinkGenMax: 5,
            gpuPcieLinkWidthAvg: 16,
            gpuPcieLinkWidthMax: 16,
            computePlacement: "gpu-biased",
          },
          hardwareOverall: {
            sampleCount: 2,
            cpuUtilAvgPct: 24,
            cpuUtilMaxPct: 30,
            gpuUtilAvgPct: 49,
            gpuUtilMaxPct: 88,
            computePlacement: "mixed",
          },
          hardwareT5Load: {
            sampleCount: 1,
            cpuUtilAvgPct: 52,
            cpuUtilMaxPct: 52,
            gpuUtilAvgPct: 9,
            gpuUtilMaxPct: 9,
            gpuPowerAvgW: 18,
            gpuPowerMaxW: 18,
            gpuMemClockAvgMHz: 800,
            gpuMemClockMaxMHz: 800,
            gpuMemBandwidthEstimateAvgGBps: 40,
            gpuMemBandwidthEstimateMaxGBps: 40,
            gpuMemBandwidthPeakAvgGBps: 220,
            gpuMemBandwidthPeakMaxGBps: 220,
          },
          hardwareT5Prefill: {
            sampleCount: 1,
            cpuUtilAvgPct: 28,
            cpuUtilMaxPct: 28,
            gpuUtilAvgPct: 55,
            gpuUtilMaxPct: 55,
            gpuPowerAvgW: 32,
            gpuPowerMaxW: 32,
            gpuMemClockAvgMHz: 1100,
            gpuMemClockMaxMHz: 1100,
            gpuMemBandwidthEstimateAvgGBps: 120,
            gpuMemBandwidthEstimateMaxGBps: 120,
            gpuMemBandwidthPeakAvgGBps: 220,
            gpuMemBandwidthPeakMaxGBps: 220,
          },
          hardwareT5Decode: {
            sampleCount: 1,
            cpuUtilAvgPct: 16,
            cpuUtilMaxPct: 16,
            gpuUtilAvgPct: 90,
            gpuUtilMaxPct: 90,
            gpuPowerAvgW: 42,
            gpuPowerMaxW: 42,
            gpuMemClockAvgMHz: 1250,
            gpuMemClockMaxMHz: 1250,
            gpuMemBandwidthEstimateAvgGBps: 190,
            gpuMemBandwidthEstimateMaxGBps: 190,
            gpuMemBandwidthPeakAvgGBps: 220,
            gpuMemBandwidthPeakMaxGBps: 220,
          },
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
      comparisons: {
        ragVsNoRag: {
          rag: {
            count: 1,
            e2eLocalCompleteAvgMs: 670,
            t4RagRecallAvgMs: 15,
            t5LlmTotalAvgMs: 500,
            t5InputTokensAvg: 1000,
            t5DecodeTpsAvg: 200,
            ragCpuAvgPct: 30,
            ragGpuAvgPct: 10,
            ragGpuMemUtilAvgPct: 12,
            ragGpuPowerAvgW: 8,
            ragPlacement: "cpu-biased",
            llmCpuAvgPct: 18,
            llmGpuAvgPct: 88,
            llmGpuMemUtilAvgPct: 66,
            llmGpuPowerAvgW: 40,
            llmPlacement: "gpu-biased",
          },
          noRag: { count: 0 },
        },
      },
    };

    const html = renderLatencyReportHtml({
      report,
      hardwareSamples: [
        {
          ts: "2026-01-01T00:00:01.200Z",
          epochMs: 1_200,
          cpuUtilPct: 32,
          loadAvg1: 1,
          loadAvg5: 1,
          loadAvg15: 1,
          memTotalBytes: 100,
          memFreeBytes: 30,
          memUsedBytes: 70,
          memUtilPct: 70,
          gpus: [{ index: 0, utilizationGpuPct: 82 }],
        },
        {
          ts: "2026-01-01T00:00:01.400Z",
          epochMs: 1_400,
          cpuUtilPct: 35,
          loadAvg1: 1,
          loadAvg5: 1,
          loadAvg15: 1,
          memTotalBytes: 100,
          memFreeBytes: 28,
          memUsedBytes: 72,
          memUtilPct: 72,
          gpus: [{ index: 0, utilizationGpuPct: 84 }],
        },
        {
          ts: "2026-01-01T00:00:01.600Z",
          epochMs: 1_600,
          cpuUtilPct: 31,
          loadAvg1: 1,
          loadAvg5: 1,
          loadAvg15: 1,
          memTotalBytes: 100,
          memFreeBytes: 27,
          memUsedBytes: 73,
          memUtilPct: 73,
          gpus: [{ index: 0, utilizationGpuPct: 86 }],
        },
        {
          ts: "2026-01-01T00:00:01.800Z",
          epochMs: 1_800,
          cpuUtilPct: 29,
          loadAvg1: 1,
          loadAvg5: 1,
          loadAvg15: 1,
          memTotalBytes: 100,
          memFreeBytes: 26,
          memUsedBytes: 74,
          memUtilPct: 74,
          gpus: [{ index: 0, utilizationGpuPct: 88 }],
        },
      ],
    });
    expect(html).toContain("<!doctype html>");
    expect(html).toContain("OpenClaw Latency Dashboard");
    expect(html).toContain("Per-message Timeline");
    expect(html).toContain("msg1");
    expect(html).toContain("CPU Utilization (T1-T6 Interval)");
    expect(html).toContain("GPU Utilization (T1-T6 Interval)");
    expect(html).toContain("Elapsed Time (ms)");
    expect(html).toContain("Utilization (%)");
    expect(html).toContain("avg 31.8%");
    expect(html).toContain(">T1<");
    expect(html).toContain(">T5<");
    expect(html).toContain(">T6<");
    expect(html).toContain("RAG vs No-RAG Comparison");
    expect(html).toContain("T5 Phase Hardware Breakdown");
    expect(html).toContain("T5 Load Hardware");
    expect(html).toContain("T5 Prefill Hardware");
    expect(html).toContain("T5 Decode Hardware");
    expect(html).toContain("Download timeline SVG");
    expect(html).toContain("Download CPU SVG");
    expect(html).toContain("Download GPU SVG");
    expect(html).not.toContain("Aggregate Summary");
  });

  it("renders aggregate summary when avg mode is enabled", () => {
    const report: LatencyAggregateReport = {
      recordsScanned: 1,
      messages: [],
      series: {
        e2e_local_first_visible_ms: { count: 1, avg: 260, p95: 260, p99: 260 },
        e2e_local_complete_ms: { count: 1, avg: 670, p95: 670, p99: 670 },
      },
      comparisons: {
        ragVsNoRag: {
          rag: { count: 0 },
          noRag: { count: 0 },
        },
      },
    };
    const html = renderLatencyReportHtml({ report, avgMode: true });
    expect(html).toContain("Aggregate Summary");
  });
});
