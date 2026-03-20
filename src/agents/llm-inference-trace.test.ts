import { describe, expect, it, vi } from "vitest";

const diagnosticMocks = vi.hoisted(() => ({
  logLatencySegment: vi.fn(),
}));

vi.mock("../logging/diagnostic.js", () => ({
  logLatencySegment: diagnosticMocks.logLatencySegment,
}));

import { wrapStreamFnLlmInference } from "./llm-inference-trace.js";

function createMockStream() {
  const message = {
    role: "assistant" as const,
    content: [{ type: "text" as const, text: "ok" }],
    usage: {
      input: 120,
      output: 30,
      totalTokens: 150,
    },
  };
  return {
    async result() {
      return message;
    },
    [Symbol.asyncIterator]() {
      let step = 0;
      return {
        async next() {
          step += 1;
          if (step === 1) {
            return { done: false as const, value: { type: "done", message } };
          }
          return { done: true as const, value: undefined };
        },
      };
    },
  };
}

describe("wrapStreamFnLlmInference", () => {
  it("records generic ttft and total for non-ollama models", async () => {
    diagnosticMocks.logLatencySegment.mockClear();
    const wrapped = wrapStreamFnLlmInference(() => createMockStream() as never, {
      channel: "feishu",
      messageId: "om_1",
      runId: "run-1",
      transport: "openai-responses-stream",
    });

    const stream = await wrapped(
      { id: "gpt-5.4", provider: "openai", api: "openai-responses" } as never,
      {} as never,
      {} as never,
    );

    for await (const _event of stream) {
      // consume
    }

    expect(diagnosticMocks.logLatencySegment).toHaveBeenCalledWith(
      expect.objectContaining({
        segment: "t5_llm_inference",
        stage: "ttft",
        provider: "openai",
        model: "gpt-5.4",
        runId: "run-1",
      }),
    );
    expect(diagnosticMocks.logLatencySegment).toHaveBeenCalledWith(
      expect.objectContaining({
        segment: "t5_llm_inference",
        stage: "completed",
        provider: "openai",
        model: "gpt-5.4",
        runId: "run-1",
        inputTokens: 120,
        outputTokens: 30,
        totalTokens: 150,
      }),
    );
  });
});
