import { describe, expect, it } from "vitest";
import {
  formatLatencyReportText,
  parseLatencyTraceJsonl,
  summarizeLatencyRecords,
} from "./latency-trace-report.js";

describe("latency-trace-report", () => {
  it("summarizes per-message T1-T6 metrics", () => {
    const records = parseLatencyTraceJsonl(
      [
        JSON.stringify({
          type: "latency.segment",
          segment: "t1_feishu_inbound",
          durationMs: 10,
          channel: "feishu",
          accountId: "main",
          chatId: "oc_chat",
          messageId: "om_msg_1",
        }),
        JSON.stringify({
          type: "latency.segment",
          segment: "t2_gateway_enqueue",
          durationMs: 5,
          channel: "feishu",
          accountId: "main",
          chatId: "oc_chat",
          messageId: "om_msg_1",
        }),
        JSON.stringify({
          type: "latency.segment",
          segment: "t3_worker_queue_wait",
          durationMs: 6,
          channel: "feishu",
          accountId: "main",
          chatId: "oc_chat",
          messageId: "om_msg_1",
        }),
        JSON.stringify({
          type: "latency.segment",
          segment: "t4_agent_preprocess",
          durationMs: 7,
          channel: "feishu",
          accountId: "main",
          chatId: "oc_chat",
          messageId: "om_msg_1",
        }),
        JSON.stringify({
          type: "latency.segment",
          segment: "t5_llm_inference",
          stage: "ttft",
          durationMs: 80,
          channel: "feishu",
          accountId: "main",
          chatId: "oc_chat",
          messageId: "om_msg_1",
        }),
        JSON.stringify({
          type: "latency.segment",
          segment: "t5_llm_inference",
          stage: "native",
          durationMs: 300,
          totalMs: 300,
          loadMs: 20,
          promptEvalMs: 100,
          evalMs: 180,
          promptEvalCount: 20,
          evalCount: 12,
          channel: "feishu",
          accountId: "main",
          chatId: "oc_chat",
          messageId: "om_msg_1",
        }),
        JSON.stringify({
          type: "latency.segment",
          segment: "t5_llm_inference",
          stage: "ttft",
          durationMs: 40,
          channel: "feishu",
          accountId: "main",
          chatId: "oc_chat",
          messageId: "om_msg_1",
        }),
        JSON.stringify({
          type: "latency.segment",
          segment: "t5_llm_inference",
          stage: "native",
          durationMs: 120,
          totalMs: 120,
          loadMs: 10,
          promptEvalMs: 30,
          evalMs: 80,
          promptEvalCount: 10,
          evalCount: 8,
          channel: "feishu",
          accountId: "main",
          chatId: "oc_chat",
          messageId: "om_msg_1",
        }),
        JSON.stringify({
          type: "latency.segment",
          segment: "t6_feishu_return",
          stage: "first_ack",
          durationMs: 45,
          channel: "feishu",
          accountId: "main",
          chatId: "oc_chat",
          messageId: "om_msg_1",
        }),
        JSON.stringify({
          type: "latency.segment",
          segment: "t6_feishu_return",
          stage: "final_ack",
          durationMs: 55,
          channel: "feishu",
          accountId: "main",
          chatId: "oc_chat",
          messageId: "om_msg_1",
        }),
      ].join("\n"),
    );

    const report = summarizeLatencyRecords(records);
    expect(report.messages).toHaveLength(1);
    expect(report.messages[0]?.t1FeishuInboundMs).toBe(10);
    expect(report.messages[0]?.t5LlmTtftMs).toBe(80);
    expect(report.messages[0]?.t5LlmTtftSumMs).toBe(120);
    expect(report.messages[0]?.t5LlmCallCount).toBe(2);
    expect(report.messages[0]?.t5LlmTotalMs).toBe(420);
    expect(report.messages[0]?.t5LlmLoadMs).toBe(30);
    expect(report.messages[0]?.t5InputTokens).toBe(30);
    expect(report.messages[0]?.t5OutputTokens).toBe(20);
    expect(report.messages[0]?.t5TotalTokens).toBe(50);
    expect(report.messages[0]?.t4RagRecallMs).toBeUndefined();
    expect(report.messages[0]?.t5PrefillTokensPerSec).toBe(230.76923076923077);
    expect(report.messages[0]?.t5DecodeTokensPerSec).toBe(76.92307692307692);
    expect(report.messages[0]?.localFirstVisibleMs).toBe(10 + 5 + 6 + 7 + 80 + 45);
    expect(report.messages[0]?.t6FeishuFinalAckMs).toBe(55);
    expect(report.messages[0]?.localCompleteMs).toBe(10 + 5 + 6 + 7 + 420 + 55);
    expect(report.series.t5_llm_total_ms?.avg).toBe(420);
  });

  it("formats a readable report", () => {
    const report = summarizeLatencyRecords(
      parseLatencyTraceJsonl(
        JSON.stringify({
          type: "latency.segment",
          segment: "t2_gateway_enqueue",
          durationMs: 12,
          channel: "feishu",
          accountId: "main",
          chatId: "oc_chat",
          messageId: "om_msg_1",
        }),
      ),
    );
    const text = formatLatencyReportText(report);
    expect(text).toContain("Per-message Summary:");
    expect(text).toContain("Derived summary:");
    expect(text).toContain("RAG vs No-RAG comparison:");
    expect(text).toContain("T2=12.0ms");
    expect(text).toContain("t5_llm_call_count");
    expect(text).toContain("t2_gateway_enqueue_ms");
  });

  it("correlates hardware samples during the llm window", () => {
    const report = summarizeLatencyRecords(
      parseLatencyTraceJsonl(
        [
          JSON.stringify({
            type: "latency.segment",
            segment: "t5_llm_inference",
            stage: "ttft",
            durationMs: 100,
            startedAtMs: 1_000,
            endedAtMs: 1_100,
            channel: "feishu",
            accountId: "main",
            messageId: "om_msg_1",
          }),
          JSON.stringify({
            type: "latency.segment",
            segment: "t5_llm_inference",
            stage: "completed",
            durationMs: 400,
            totalMs: 400,
            startedAtMs: 1_000,
            endedAtMs: 1_400,
            inputTokens: 100,
            outputTokens: 20,
            totalTokens: 120,
            channel: "feishu",
            accountId: "main",
            messageId: "om_msg_1",
          }),
        ].join("\n"),
      ),
      [
        {
          ts: "2026-01-01T00:00:01.050Z",
          epochMs: 1_050,
          cpuUtilPct: 40,
          loadAvg1: 1,
          loadAvg5: 1,
          loadAvg15: 1,
          memTotalBytes: 100,
          memFreeBytes: 40,
          memUsedBytes: 60,
          memUtilPct: 60,
          gpus: [
            {
              index: 0,
              utilizationGpuPct: 80,
              memoryUsedMiB: 10,
              memoryTotalMiB: 20,
              powerDrawW: 100,
            },
          ],
        },
        {
          ts: "2026-01-01T00:00:01.350Z",
          epochMs: 1_350,
          cpuUtilPct: 60,
          loadAvg1: 1,
          loadAvg5: 1,
          loadAvg15: 1,
          memTotalBytes: 100,
          memFreeBytes: 20,
          memUsedBytes: 80,
          memUtilPct: 80,
          gpus: [
            {
              index: 0,
              utilizationGpuPct: 60,
              memoryUsedMiB: 12,
              memoryTotalMiB: 20,
              powerDrawW: 120,
            },
          ],
        },
      ],
    );

    expect(report.messages[0]?.hardwareSampleCount).toBe(2);
    expect(report.messages[0]?.hardwareCpuUtilAvgPct).toBe(50);
    expect(report.messages[0]?.hardwareMemUtilAvgPct).toBe(70);
    expect(report.messages[0]?.hardwareGpuUtilAvgPct).toBe(70);
    expect(report.messages[0]?.hardwareGpuMemUtilAvgPct).toBe(55);
    expect(report.messages[0]?.hardwareGpuPowerAvgW).toBe(110);
    expect(report.messages[0]?.hardwareLlm?.gpuUtilMaxPct).toBe(80);
  });

  it("falls back to utilization.memory when gpu memory totals are unavailable", () => {
    const report = summarizeLatencyRecords(
      parseLatencyTraceJsonl(
        [
          JSON.stringify({
            type: "latency.segment",
            segment: "t5_llm_inference",
            stage: "ttft",
            durationMs: 100,
            startedAtMs: 1_000,
            endedAtMs: 1_100,
            channel: "feishu",
            accountId: "main",
            messageId: "om_msg_1",
          }),
          JSON.stringify({
            type: "latency.segment",
            segment: "t5_llm_inference",
            stage: "completed",
            durationMs: 400,
            totalMs: 400,
            startedAtMs: 1_000,
            endedAtMs: 1_400,
            channel: "feishu",
            accountId: "main",
            messageId: "om_msg_1",
          }),
        ].join("\n"),
      ),
      [
        {
          ts: "2026-01-01T00:00:01.050Z",
          epochMs: 1_050,
          memTotalBytes: 100,
          memFreeBytes: 40,
          memUsedBytes: 60,
          memUtilPct: 60,
          gpus: [
            {
              index: 0,
              utilizationGpuPct: 80,
              utilizationMemPct: 62,
            },
          ],
        },
      ],
    );

    expect(report.messages[0]?.hardwareGpuMemUtilAvgPct).toBe(62);
  });

  it("merges records with the same message id across differing chat id representations", () => {
    const report = summarizeLatencyRecords(
      parseLatencyTraceJsonl(
        [
          JSON.stringify({
            type: "latency.segment",
            segment: "t1_feishu_inbound",
            durationMs: 1200,
            channel: "feishu",
            accountId: "agent_cr",
            chatId: "oc_chat_1",
            messageId: "om_msg_1",
            runId: "run_1",
          }),
          JSON.stringify({
            type: "latency.segment",
            segment: "t2_gateway_enqueue",
            durationMs: 20,
            channel: "feishu",
            accountId: "agent_cr",
            chatId: "user:ou_1",
            messageId: "om_msg_1",
            runId: "run_1",
          }),
          JSON.stringify({
            type: "latency.segment",
            segment: "t5_llm_inference",
            stage: "native",
            durationMs: 300,
            totalMs: 300,
            channel: "feishu",
            accountId: "agent_cr",
            chatId: "user:ou_1",
            messageId: "om_msg_1",
            runId: "run_1",
          }),
        ].join("\n"),
      ),
    );

    expect(report.messages).toHaveLength(1);
    expect(report.messages[0]?.t1FeishuInboundMs).toBe(1200);
    expect(report.messages[0]?.t2GatewayEnqueueMs).toBe(20);
    expect(report.messages[0]?.t5LlmCallCount).toBe(1);
    expect(report.messages[0]?.t5LlmTotalMs).toBe(300);
  });

  it("tracks automatic rag recall windows and compares rag vs no-rag groups", () => {
    const report = summarizeLatencyRecords(
      parseLatencyTraceJsonl(
        [
          JSON.stringify({
            type: "latency.segment",
            segment: "t4_agent_preprocess",
            stage: "rag_recall",
            durationMs: 120,
            startedAtMs: 900,
            endedAtMs: 1_020,
            totalTokens: 3,
            channel: "feishu",
            accountId: "main",
            messageId: "om_msg_rag",
          }),
          JSON.stringify({
            type: "latency.segment",
            segment: "t5_llm_inference",
            stage: "ttft",
            durationMs: 100,
            startedAtMs: 1_100,
            endedAtMs: 1_200,
            channel: "feishu",
            accountId: "main",
            messageId: "om_msg_rag",
          }),
          JSON.stringify({
            type: "latency.segment",
            segment: "t5_llm_inference",
            stage: "completed",
            durationMs: 500,
            totalMs: 500,
            startedAtMs: 1_100,
            endedAtMs: 1_600,
            inputTokens: 200,
            outputTokens: 20,
            channel: "feishu",
            accountId: "main",
            messageId: "om_msg_rag",
          }),
          JSON.stringify({
            type: "latency.segment",
            segment: "t5_llm_inference",
            stage: "ttft",
            durationMs: 80,
            startedAtMs: 2_100,
            endedAtMs: 2_180,
            channel: "feishu",
            accountId: "main",
            messageId: "om_msg_plain",
          }),
          JSON.stringify({
            type: "latency.segment",
            segment: "t5_llm_inference",
            stage: "completed",
            durationMs: 300,
            totalMs: 300,
            startedAtMs: 2_100,
            endedAtMs: 2_400,
            inputTokens: 120,
            outputTokens: 18,
            channel: "feishu",
            accountId: "main",
            messageId: "om_msg_plain",
          }),
        ].join("\n"),
      ),
      [
        {
          ts: "2026-01-01T00:00:00.950Z",
          epochMs: 950,
          cpuUtilPct: 35,
          loadAvg1: 1,
          loadAvg5: 1,
          loadAvg15: 1,
          memTotalBytes: 100,
          memFreeBytes: 30,
          memUsedBytes: 70,
          memUtilPct: 70,
          gpus: [{ index: 0, utilizationGpuPct: 10, utilizationMemPct: 15, powerDrawW: 12 }],
        },
        {
          ts: "2026-01-01T00:00:01.300Z",
          epochMs: 1_300,
          cpuUtilPct: 20,
          loadAvg1: 1,
          loadAvg5: 1,
          loadAvg15: 1,
          memTotalBytes: 100,
          memFreeBytes: 30,
          memUsedBytes: 70,
          memUtilPct: 70,
          gpus: [{ index: 0, utilizationGpuPct: 80, utilizationMemPct: 65, powerDrawW: 55 }],
        },
        {
          ts: "2026-01-01T00:00:02.250Z",
          epochMs: 2_250,
          cpuUtilPct: 18,
          loadAvg1: 1,
          loadAvg5: 1,
          loadAvg15: 1,
          memTotalBytes: 100,
          memFreeBytes: 35,
          memUsedBytes: 65,
          memUtilPct: 65,
          gpus: [{ index: 0, utilizationGpuPct: 72, utilizationMemPct: 58, powerDrawW: 48 }],
        },
      ],
    );

    const ragMessage = report.messages.find((message) => message.messageId === "om_msg_rag");
    const plainMessage = report.messages.find((message) => message.messageId === "om_msg_plain");
    expect(ragMessage?.t4RagRecallMs).toBe(120);
    expect(ragMessage?.t4RagRecallResults).toBe(3);
    expect(ragMessage?.ragUsed).toBe(true);
    expect(ragMessage?.hardwareRag?.cpuUtilAvgPct).toBe(35);
    expect(ragMessage?.hardwareRag?.computePlacement).toBe("mixed");
    expect(ragMessage?.hardwareLlm?.gpuUtilAvgPct).toBe(80);
    expect(plainMessage?.ragUsed).toBe(false);
    expect(report.comparisons.ragVsNoRag.rag.count).toBe(1);
    expect(report.comparisons.ragVsNoRag.rag.ragPlacement).toBe("mixed");
    expect(report.comparisons.ragVsNoRag.noRag.count).toBe(1);
    expect(report.comparisons.ragVsNoRag.noRag.t4RagRecallAvgMs).toBeUndefined();
  });
});
