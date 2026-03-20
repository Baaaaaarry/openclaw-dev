import type { DiagnosticTraceIdentity } from "../infra/latency-trace.js";
import { createLlmPayloadLogger, type LlmPayloadLogger } from "./llm-payload-log.js";

export type OllamaPayloadLogger = LlmPayloadLogger;

export function createOllamaPayloadLogger(params: {
  env?: NodeJS.ProcessEnv;
  trace?: DiagnosticTraceIdentity;
  baseUrl: string;
  chatUrl: string;
}): OllamaPayloadLogger | null {
  return createLlmPayloadLogger({
    env: params.env,
    trace: params.trace,
    provider: params.trace?.provider,
    modelApi: "ollama",
    baseUrl: params.baseUrl,
    requestUrl: params.chatUrl,
    transport: "ollama-api-chat",
  });
}
