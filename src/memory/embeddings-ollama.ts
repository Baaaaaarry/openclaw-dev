import { resolveApiKeyForProvider } from "../agents/model-auth.js";
import { OLLAMA_NATIVE_BASE_URL } from "../agents/ollama-stream.js";
import type { EmbeddingProvider, EmbeddingProviderOptions } from "./embeddings.js";
import { postJson } from "./post-json.js";
import { buildRemoteBaseUrlPolicy } from "./remote-http.js";

export type OllamaEmbeddingClient = {
  baseUrl: string;
  headers: Record<string, string>;
  model: string;
};

export const DEFAULT_OLLAMA_EMBEDDING_MODEL = "all-minilm";

export function normalizeOllamaEmbeddingModel(model: string): string {
  const trimmed = model.trim();
  if (!trimmed) {
    return DEFAULT_OLLAMA_EMBEDDING_MODEL;
  }
  if (trimmed.startsWith("ollama/")) {
    return trimmed.slice("ollama/".length);
  }
  return trimmed;
}

function normalizeOllamaBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, "").replace(/\/v1$/i, "");
}

export async function resolveOllamaEmbeddingClient(
  options: EmbeddingProviderOptions,
): Promise<OllamaEmbeddingClient> {
  const remote = options.remote;
  const providerConfig = options.config.models?.providers?.ollama;
  const baseUrl = normalizeOllamaBaseUrl(
    remote?.baseUrl?.trim() || providerConfig?.baseUrl?.trim() || OLLAMA_NATIVE_BASE_URL,
  );
  const headerOverrides = Object.assign({}, providerConfig?.headers, remote?.headers);
  let apiKey = remote?.apiKey?.trim();
  if (!apiKey) {
    try {
      const resolved = await resolveApiKeyForProvider({
        provider: "ollama",
        cfg: options.config,
        agentDir: options.agentDir,
      });
      apiKey = resolved.apiKey;
    } catch {
      apiKey = undefined;
    }
  }
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...headerOverrides,
  };
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }
  return {
    baseUrl,
    headers,
    model: normalizeOllamaEmbeddingModel(options.model),
  };
}

export async function createOllamaEmbeddingProvider(
  options: EmbeddingProviderOptions,
): Promise<{ provider: EmbeddingProvider; client: OllamaEmbeddingClient }> {
  const client = await resolveOllamaEmbeddingClient(options);
  const url = `${client.baseUrl}/api/embed`;
  const ssrfPolicy = buildRemoteBaseUrlPolicy(client.baseUrl);

  const embed = async (input: string[]): Promise<number[][]> => {
    if (input.length === 0) {
      return [];
    }
    return await postJson({
      url,
      headers: client.headers,
      ssrfPolicy,
      body: {
        model: client.model,
        input: input.length === 1 ? input[0] : input,
      },
      errorPrefix: "ollama embeddings failed",
      parse: (payload) => {
        const typedPayload = payload as { embeddings?: number[][] };
        return typedPayload.embeddings ?? [];
      },
    });
  };

  return {
    provider: {
      id: "ollama",
      model: client.model,
      embedQuery: async (text) => {
        const [vector] = await embed([text]);
        return vector ?? [];
      },
      embedBatch: embed,
    },
    client,
  };
}
