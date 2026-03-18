import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createOllamaPayloadLogger } from "./ollama-payload-log.js";

describe("createOllamaPayloadLogger", () => {
  it("persists request and response payloads to jsonl", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-ollama-payload-"));
    const file = path.join(tmp, "ollama-payload.jsonl");
    const logger = createOllamaPayloadLogger({
      env: {
        ...process.env,
        OPENCLAW_OLLAMA_PAYLOAD_LOG: "1",
        OPENCLAW_OLLAMA_PAYLOAD_LOG_FILE: file,
      },
      baseUrl: "http://127.0.0.1:11434",
      chatUrl: "http://127.0.0.1:11434/api/chat",
      trace: {
        runId: "run-1",
        sessionKey: "session-1",
        provider: "ollama",
        model: "qwen3:32b",
      },
    });

    expect(logger).not.toBeNull();
    logger?.recordRequest({
      model: "qwen3:32b",
      messages: [{ role: "user", content: "hello" }],
      stream: true,
    });
    logger?.recordResponse({
      model: "qwen3:32b",
      message: { role: "assistant", content: "world" },
      done: true,
    });

    await new Promise((resolve) => setTimeout(resolve, 30));
    const content = await fs.readFile(file, "utf8");
    expect(content).toContain('"stage":"request"');
    expect(content).toContain('"stage":"response"');
    expect(content).toContain('"runId":"run-1"');
    expect(content).toContain('"content":"hello"');
    expect(content).toContain('"content":"world"');
  });
});
