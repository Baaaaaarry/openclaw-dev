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
    expect(text).toContain("T2=12.0ms");
    expect(text).toContain("t5_llm_call_count");
    expect(text).toContain("t2_gateway_enqueue_ms");
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
});
