import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createLlmPayloadLogger } from "./llm-payload-log.js";

function createMockStream() {
  const message = {
    role: "assistant" as const,
    content: [{ type: "text" as const, text: "world" }],
  };
  return {
    async result() {
      return message;
    },
    [Symbol.asyncIterator]() {
      let done = false;
      return {
        async next() {
          if (done) {
            return { done: true as const, value: undefined };
          }
          done = true;
          return { done: false as const, value: { partial: message } };
        },
      };
    },
  };
}

describe("createLlmPayloadLogger", () => {
  it("persists non-ollama request and response payloads to jsonl", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-llm-payload-"));
    const file = path.join(tmp, "llm-payload.jsonl");
    const logger = createLlmPayloadLogger({
      env: {
        ...process.env,
        OPENCLAW_LLM_PAYLOAD_LOG: "1",
        OPENCLAW_LLM_PAYLOAD_LOG_FILE: file,
      },
      provider: "openai",
      modelApi: "openai-responses",
      baseUrl: "https://api.openai.com",
      requestUrl: "https://api.openai.com/v1/responses",
      trace: {
        runId: "run-1",
        sessionKey: "session-1",
        provider: "openai",
        model: "gpt-5.4",
      },
    });

    expect(logger).not.toBeNull();

    const wrapped = logger?.wrapStreamFn((_, __, options) => {
      options?.onPayload?.({
        model: "gpt-5.4",
        input: [{ role: "user", content: "hello" }],
      });
      return createMockStream() as never;
    });

    const stream = wrapped?.(
      { id: "gpt-5.4", provider: "openai", api: "openai-responses" } as never,
      {} as never,
      {} as never,
    );
    const resolved = await stream;
    await resolved?.result();

    await new Promise((resolve) => setTimeout(resolve, 30));
    const content = await fs.readFile(file, "utf8");
    expect(content).toContain('"stage":"request"');
    expect(content).toContain('"stage":"response"');
    expect(content).toContain('"provider":"openai"');
    expect(content).toContain('"model":"gpt-5.4"');
    expect(content).toContain('"content":"hello"');
    expect(content).toContain('"text":"world"');
  });
});
