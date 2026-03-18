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
          segment: "t5_ollama_inference",
          stage: "ttft",
          durationMs: 80,
          channel: "feishu",
          accountId: "main",
          chatId: "oc_chat",
          messageId: "om_msg_1",
        }),
        JSON.stringify({
          type: "latency.segment",
          segment: "t5_ollama_inference",
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
    expect(report.messages[0]?.t5OllamaTtftMs).toBe(80);
    expect(report.messages[0]?.t5OllamaTotalMs).toBe(300);
    expect(report.messages[0]?.t5OllamaLoadMs).toBe(20);
    expect(report.messages[0]?.t6FeishuFinalAckMs).toBe(55);
    expect(report.series.t5_ollama_total_ms?.avg).toBe(300);
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
    expect(text).toContain("Per-message T1-T6:");
    expect(text).toContain("T2=12.0ms");
    expect(text).toContain("t2_gateway_enqueue_ms");
  });
});
