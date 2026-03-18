import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { emitDiagnosticEvent, resetDiagnosticEventsForTest } from "./diagnostic-events.js";
import {
  buildLatencyCorrelationKey,
  startLatencyTracePersist,
  stopLatencyTracePersist,
} from "./latency-trace-persist.js";

describe("latency-trace-persist", () => {
  beforeEach(() => {
    resetDiagnosticEventsForTest();
    stopLatencyTracePersist();
  });

  afterEach(() => {
    stopLatencyTracePersist();
  });

  it("builds correlation key from message identity", () => {
    expect(
      buildLatencyCorrelationKey({
        channel: "feishu",
        accountId: "main",
        chatId: "oc_chat",
        messageId: "om_msg_1",
      }),
    ).toBe("feishu|main|oc_chat|om_msg_1");
  });

  it("persists latency segments to jsonl", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-latency-"));
    const file = path.join(tmp, "latency.jsonl");

    startLatencyTracePersist(undefined, {
      ...process.env,
      OPENCLAW_LATENCY_TRACE: "1",
      OPENCLAW_LATENCY_TRACE_FILE: file,
    });

    emitDiagnosticEvent({
      type: "latency.segment",
      segment: "t2_gateway_enqueue",
      durationMs: 12,
      channel: "feishu",
      accountId: "main",
      chatId: "oc_chat",
      messageId: "om_msg_1",
    });

    await new Promise((resolve) => setTimeout(resolve, 30));
    const content = await fs.readFile(file, "utf8");
    expect(content).toContain('"type":"latency.segment"');
    expect(content).toContain('"segment":"t2_gateway_enqueue"');
    expect(content).toContain('"correlationKey":"feishu|main|oc_chat|om_msg_1"');
  });
});
