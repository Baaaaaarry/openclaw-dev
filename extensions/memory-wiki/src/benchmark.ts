import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { resolvePreferredOpenClawTmpDir } from "openclaw/plugin-sdk/temp-path";
import type { OpenClawConfig } from "../api.js";
import { z } from "../api.js";
import { applyMemoryWikiMutation, type ApplyMemoryWikiMutation } from "./apply.js";
import { compileMemoryWikiVault } from "./compile.js";
import {
  WIKI_SEARCH_BACKENDS,
  WIKI_SEARCH_CORPORA,
  type ResolvedMemoryWikiConfig,
  type WikiSearchBackend,
  type WikiSearchCorpus,
} from "./config.js";
import { ingestMemoryWikiSource } from "./ingest.js";
import { renderWikiMarkdown, type WikiClaim } from "./markdown.js";
import { getMemoryWikiPage, searchMemoryWiki, type WikiSearchResult } from "./query.js";
import { initializeMemoryWikiVault } from "./vault.js";

export const WIKI_BENCHMARK_PROFILES = ["beir", "ragas", "crud-rag", "longmemeval", "all"] as const;

export type WikiBenchmarkProfile = (typeof WIKI_BENCHMARK_PROFILES)[number];

const WikiBenchmarkTargetSchema = z.union([
  z.string().min(1),
  z
    .object({
      path: z.string().min(1).optional(),
      id: z.string().min(1).optional(),
      title: z.string().min(1).optional(),
      corpus: z.enum(["wiki", "memory"]).optional(),
    })
    .refine((value) => Boolean(value.path || value.id || value.title), {
      message: "Benchmark target requires path, id, or title.",
    }),
]);

const WikiClaimEvidenceSchema = z.object({
  sourceId: z.string().min(1).optional(),
  path: z.string().min(1).optional(),
  lines: z.string().min(1).optional(),
  weight: z.number().min(0).optional(),
  note: z.string().min(1).optional(),
  updatedAt: z.string().min(1).optional(),
});

const WikiClaimSchema = z.object({
  id: z.string().min(1).optional(),
  text: z.string().min(1),
  status: z.string().min(1).optional(),
  confidence: z.number().min(0).max(1).optional(),
  evidence: z.array(WikiClaimEvidenceSchema).optional(),
  updatedAt: z.string().min(1).optional(),
});

const BenchmarkSearchOverrideSchema = z.object({
  backend: z.enum(WIKI_SEARCH_BACKENDS).optional(),
  corpus: z.enum(WIKI_SEARCH_CORPORA).optional(),
  topK: z.number().int().min(1).optional(),
});

const BenchmarkOperationSchema = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("ingest"),
    inputPath: z.string().min(1),
    title: z.string().min(1).optional(),
  }),
  z.object({
    op: z.literal("apply_synthesis"),
    title: z.string().min(1),
    body: z.string().min(1),
    sourceIds: z.array(z.string().min(1)).min(1),
    claims: z.array(WikiClaimSchema).optional(),
    contradictions: z.array(z.string().min(1)).optional(),
    questions: z.array(z.string().min(1)).optional(),
    confidence: z.number().min(0).max(1).optional(),
    status: z.string().min(1).optional(),
  }),
  z.object({
    op: z.literal("apply_metadata"),
    lookup: z.string().min(1),
    sourceIds: z.array(z.string().min(1)).optional(),
    claims: z.array(WikiClaimSchema).optional(),
    contradictions: z.array(z.string().min(1)).optional(),
    questions: z.array(z.string().min(1)).optional(),
    confidence: z.union([z.number().min(0).max(1), z.null()]).optional(),
    status: z.string().min(1).optional(),
  }),
  z.object({
    op: z.literal("compile"),
  }),
  z.object({
    op: z.literal("write_page"),
    relativePath: z.string().min(1),
    frontmatter: z.record(z.string(), z.unknown()),
    body: z.string(),
  }),
  z.object({
    op: z.literal("remove_page"),
    relativePath: z.string().min(1),
  }),
]);

const BenchmarkCaseBaseSchema = z.object({
  id: z.string().min(1),
  description: z.string().min(1).optional(),
  operations: z.array(BenchmarkOperationSchema).optional(),
  search: BenchmarkSearchOverrideSchema.optional(),
});

const BeirCaseSchema = BenchmarkCaseBaseSchema.extend({
  query: z.string().min(1),
  relevant: z.array(WikiBenchmarkTargetSchema).min(1),
  minRecallAtK: z.number().min(0).max(1).optional(),
  minMrr: z.number().min(0).max(1).optional(),
  minNdcgAtK: z.number().min(0).max(1).optional(),
});

const RagasCaseSchema = BenchmarkCaseBaseSchema.extend({
  query: z.string().min(1),
  relevant: z.array(WikiBenchmarkTargetSchema).min(1),
  expectedAnswerPhrases: z.array(z.string().min(1)).min(1),
  minContextPrecision: z.number().min(0).max(1).optional(),
  minContextRecall: z.number().min(0).max(1).optional(),
  minFaithfulness: z.number().min(0).max(1).optional(),
  minAnswerRelevance: z.number().min(0).max(1).optional(),
});

const CrudCaseSchema = BenchmarkCaseBaseSchema.extend({
  beforeQuery: z.string().min(1).optional(),
  beforeRelevant: z.array(WikiBenchmarkTargetSchema).optional(),
  beforeAbsent: z.array(WikiBenchmarkTargetSchema).optional(),
  mutations: z.array(BenchmarkOperationSchema).min(1),
  afterQuery: z.string().min(1),
  afterRelevant: z.array(WikiBenchmarkTargetSchema).optional(),
  afterAbsent: z.array(WikiBenchmarkTargetSchema).optional(),
  minAfterRecallAtK: z.number().min(0).max(1).optional(),
  minDeleteSuppression: z.number().min(0).max(1).optional(),
});

const LongMemEvalCaseSchema = BenchmarkCaseBaseSchema.extend({
  query: z.string().min(1),
  preferred: z.array(WikiBenchmarkTargetSchema).min(1),
  disfavored: z.array(WikiBenchmarkTargetSchema).optional(),
  expectedAnswerPhrases: z.array(z.string().min(1)).optional(),
  minPreferredRecallAtK: z.number().min(0).max(1).optional(),
  requirePreferredBeforeDisfavored: z.boolean().optional(),
  minFaithfulness: z.number().min(0).max(1).optional(),
});

const WikiBenchmarkDatasetSchema = z.object({
  version: z.literal(1),
  name: z.string().min(1),
  description: z.string().min(1).optional(),
  defaults: BenchmarkSearchOverrideSchema.optional(),
  beir: z.array(BeirCaseSchema).optional(),
  ragas: z.array(RagasCaseSchema).optional(),
  crudRag: z.array(CrudCaseSchema).optional(),
  longMemEval: z.array(LongMemEvalCaseSchema).optional(),
});

type WikiBenchmarkTarget = z.infer<typeof WikiBenchmarkTargetSchema>;
type BenchmarkOperation = z.infer<typeof BenchmarkOperationSchema>;
type WikiBenchmarkDataset = z.infer<typeof WikiBenchmarkDatasetSchema>;
type BeirCase = z.infer<typeof BeirCaseSchema>;
type RagasCase = z.infer<typeof RagasCaseSchema>;
type CrudCase = z.infer<typeof CrudCaseSchema>;
type LongMemEvalCase = z.infer<typeof LongMemEvalCaseSchema>;

type SearchExecution = {
  results: WikiSearchResult[];
  elapsedMs: number;
  topK: number;
  backend?: WikiSearchBackend;
  corpus?: WikiSearchCorpus;
};

type BaseCaseResult = {
  id: string;
  description?: string;
  passed: boolean;
  searchMs: number;
};

export type WikiBenchmarkCaseResult =
  | (BaseCaseResult & {
      profile: "beir";
      query: string;
      topK: number;
      recallAtK: number;
      mrr: number;
      ndcgAtK: number;
      hitCount: number;
      firstRelevantRank?: number;
      matchedPaths: string[];
      failureReasons: string[];
    })
  | (BaseCaseResult & {
      profile: "ragas";
      query: string;
      topK: number;
      contextPrecision: number;
      contextRecall: number;
      answerRelevance: number;
      faithfulness: number;
      matchedPaths: string[];
      failureReasons: string[];
    })
  | (BaseCaseResult & {
      profile: "crud-rag";
      beforeQuery?: string;
      afterQuery: string;
      topK: number;
      beforeRecallAtK?: number;
      afterRecallAtK: number;
      deleteSuppressionRate: number;
      mutationMs: number;
      matchedPathsAfter: string[];
      failureReasons: string[];
    })
  | (BaseCaseResult & {
      profile: "longmemeval";
      query: string;
      topK: number;
      preferredRecallAtK: number;
      faithfulness?: number;
      preferredRank?: number;
      disfavoredRank?: number;
      failureReasons: string[];
    });

type ProfileSummary = {
  caseCount: number;
  passedCases: number;
  failedCases: number;
  averageSearchMs: number;
};

export type WikiBenchmarkResult = {
  suiteName: string;
  suiteDescription?: string;
  datasetPath: string;
  evaluatedAt: string;
  selectedProfile: WikiBenchmarkProfile;
  totalCases: number;
  passedCases: number;
  failedCases: number;
  wallTimeMs: number;
  profiles: Partial<{
    beir: ProfileSummary & {
      averageRecallAtK: number;
      averageMrr: number;
      averageNdcgAtK: number;
      cases: Extract<WikiBenchmarkCaseResult, { profile: "beir" }>[];
    };
    ragas: ProfileSummary & {
      averageContextPrecision: number;
      averageContextRecall: number;
      averageAnswerRelevance: number;
      averageFaithfulness: number;
      cases: Extract<WikiBenchmarkCaseResult, { profile: "ragas" }>[];
    };
    crudRag: ProfileSummary & {
      averageBeforeRecallAtK: number;
      averageAfterRecallAtK: number;
      averageDeleteSuppressionRate: number;
      averageMutationMs: number;
      cases: Extract<WikiBenchmarkCaseResult, { profile: "crud-rag" }>[];
    };
    longMemEval: ProfileSummary & {
      averagePreferredRecallAtK: number;
      averageFaithfulness: number;
      preferenceOrderingPassRate: number;
      cases: Extract<WikiBenchmarkCaseResult, { profile: "longmemeval" }>[];
    };
  }>;
};

export function createMemoryWikiBenchmarkTemplate(): WikiBenchmarkDataset {
  return {
    version: 1,
    name: "local-rag-wiki-eval",
    description:
      "Template benchmark suite for OpenClaw memory-wiki. Replace queries and targets with your local gold set.",
    defaults: {
      backend: "local",
      corpus: "wiki",
      topK: 5,
    },
    beir: [
      {
        id: "retrieval-alpha",
        description: "BEIR-style retrieval hit rate for a canonical fact query.",
        query: "postgresql",
        relevant: ["entities/alpha.md"],
      },
    ],
    ragas: [
      {
        id: "grounded-alpha",
        description: "RAGAS-style grounded QA using expected answer phrases.",
        query: "postgresql for production writes",
        relevant: ["entities/alpha.md"],
        expectedAnswerPhrases: ["Alpha uses PostgreSQL for production writes."],
      },
    ],
    crudRag: [
      {
        id: "update-alpha",
        description: "CRUD-RAG style update propagation after a synthesis write.",
        mutations: [
          {
            op: "apply_synthesis",
            title: "Alpha rollout summary",
            body: "Alpha rollout summary now points to PostgreSQL as the production database.",
            sourceIds: ["source.alpha"],
          },
        ],
        afterQuery: "alpha rollout summary",
        afterRelevant: ["syntheses/alpha-rollout-summary.md"],
      },
    ],
    longMemEval: [
      {
        id: "memory-freshness-alpha",
        description: "LongMemEval-style preference for fresher supported pages.",
        query: "postgresql for production writes",
        preferred: ["entities/alpha.md"],
        disfavored: ["entities/alpha-legacy.md"],
        requirePreferredBeforeDisfavored: true,
      },
    ],
  };
}

function normalizeValue(value: string | undefined): string {
  return value?.trim().toLowerCase() ?? "";
}

function matchesTarget(result: WikiSearchResult, target: WikiBenchmarkTarget): boolean {
  if (typeof target === "string") {
    const expected = normalizeValue(target);
    return (
      normalizeValue(result.path) === expected ||
      normalizeValue(result.id) === expected ||
      normalizeValue(result.title) === expected
    );
  }
  if (target.corpus && result.corpus !== target.corpus) {
    return false;
  }
  if (target.path && normalizeValue(result.path) !== normalizeValue(target.path)) {
    return false;
  }
  if (target.id && normalizeValue(result.id) !== normalizeValue(target.id)) {
    return false;
  }
  if (target.title && normalizeValue(result.title) !== normalizeValue(target.title)) {
    return false;
  }
  return true;
}

function computeBinaryMetrics(results: WikiSearchResult[], relevant: WikiBenchmarkTarget[]) {
  const binaryRelevance: number[] = results.map((result) =>
    relevant.some((target) => matchesTarget(result, target)) ? 1 : 0,
  );
  const hitCount = binaryRelevance.reduce((sum, value) => sum + value, 0);
  const relevantCount = Math.max(relevant.length, 1);
  const recallAtK = hitCount / relevantCount;
  const firstRelevantRankIndex = binaryRelevance.findIndex((value) => value === 1);
  const firstRelevantRank = firstRelevantRankIndex >= 0 ? firstRelevantRankIndex + 1 : undefined;
  const mrr = firstRelevantRank ? 1 / firstRelevantRank : 0;
  const dcg = binaryRelevance.reduce(
    (sum, value, index) => sum + (value === 1 ? 1 / Math.log2(index + 2) : 0),
    0,
  );
  const idealRelevance = binaryRelevance
    .slice()
    .toSorted((left, right) => right - left)
    .slice(0, results.length);
  const idcg = idealRelevance.reduce(
    (sum, value, index) => sum + (value === 1 ? 1 / Math.log2(index + 2) : 0),
    0,
  );
  return {
    hitCount,
    recallAtK,
    mrr,
    ndcgAtK: idcg > 0 ? dcg / idcg : 0,
    firstRelevantRank,
    matchedPaths: results
      .filter((result) => relevant.some((target) => matchesTarget(result, target)))
      .map((result) => result.path),
  };
}

function average(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function resolveSearchOverrides(params: {
  dataset: WikiBenchmarkDataset;
  search?: z.infer<typeof BenchmarkSearchOverrideSchema>;
  defaultBackend?: WikiSearchBackend;
  defaultCorpus?: WikiSearchCorpus;
}): { topK: number; backend?: WikiSearchBackend; corpus?: WikiSearchCorpus } {
  return {
    topK: params.search?.topK ?? params.dataset.defaults?.topK ?? 5,
    backend: params.search?.backend ?? params.defaultBackend ?? params.dataset.defaults?.backend,
    corpus: params.search?.corpus ?? params.defaultCorpus ?? params.dataset.defaults?.corpus,
  };
}

async function executeSearch(params: {
  config: ResolvedMemoryWikiConfig;
  appConfig?: OpenClawConfig;
  query: string;
  topK: number;
  backend?: WikiSearchBackend;
  corpus?: WikiSearchCorpus;
}): Promise<SearchExecution> {
  const startedAt = performance.now();
  const results = await searchMemoryWiki({
    config: params.config,
    appConfig: params.appConfig,
    query: params.query,
    maxResults: params.topK,
    searchBackend: params.backend,
    searchCorpus: params.corpus,
  });
  return {
    results,
    elapsedMs: performance.now() - startedAt,
    topK: params.topK,
    backend: params.backend,
    corpus: params.corpus,
  };
}

async function readResultContext(
  config: ResolvedMemoryWikiConfig,
  appConfig: OpenClawConfig | undefined,
  result: WikiSearchResult,
  search: SearchExecution,
): Promise<string> {
  const content = result.snippet?.trim() ? `${result.snippet}\n` : "";
  const page = await getMemoryWikiPage({
    config,
    appConfig,
    lookup: result.id ?? result.path,
    lineCount: 200,
    searchBackend: search.backend,
    searchCorpus: result.corpus === "memory" ? (search.corpus ?? "all") : "wiki",
  }).catch(() => null);
  return `${content}${page?.content ?? ""}`;
}

async function createSandboxConfig(
  config: ResolvedMemoryWikiConfig,
): Promise<{ config: ResolvedMemoryWikiConfig; cleanup: () => Promise<void> }> {
  const sandboxRoot = await fs.mkdtemp(
    path.join(resolvePreferredOpenClawTmpDir() || os.tmpdir(), "memory-wiki-benchmark-"),
  );
  const sandboxConfig: ResolvedMemoryWikiConfig = {
    ...config,
    vault: {
      ...config.vault,
      path: sandboxRoot,
    },
  };
  const sourceExists = await fs
    .stat(config.vault.path)
    .then((stat) => stat.isDirectory())
    .catch(() => false);
  if (sourceExists) {
    await fs.cp(config.vault.path, sandboxRoot, { recursive: true });
  } else {
    await initializeMemoryWikiVault(sandboxConfig);
  }
  return {
    config: sandboxConfig,
    cleanup: async () => {
      await fs.rm(sandboxRoot, { recursive: true, force: true });
    },
  };
}

function resolveDatasetFilePath(datasetDir: string, rawPath: string): string {
  if (path.isAbsolute(rawPath)) {
    return rawPath;
  }
  return path.join(datasetDir, rawPath);
}

async function executeBenchmarkOperation(params: {
  config: ResolvedMemoryWikiConfig;
  datasetDir: string;
  operation: BenchmarkOperation;
}): Promise<void> {
  switch (params.operation.op) {
    case "ingest": {
      await ingestMemoryWikiSource({
        config: params.config,
        inputPath: resolveDatasetFilePath(params.datasetDir, params.operation.inputPath),
        title: params.operation.title,
      });
      return;
    }
    case "apply_synthesis": {
      const mutation: ApplyMemoryWikiMutation = {
        op: "create_synthesis",
        title: params.operation.title,
        body: params.operation.body,
        sourceIds: params.operation.sourceIds,
        ...(params.operation.claims ? { claims: params.operation.claims as WikiClaim[] } : {}),
        ...(params.operation.contradictions
          ? { contradictions: params.operation.contradictions }
          : {}),
        ...(params.operation.questions ? { questions: params.operation.questions } : {}),
        ...(typeof params.operation.confidence === "number"
          ? { confidence: params.operation.confidence }
          : {}),
        ...(params.operation.status ? { status: params.operation.status } : {}),
      };
      await applyMemoryWikiMutation({ config: params.config, mutation });
      return;
    }
    case "apply_metadata": {
      const mutation: ApplyMemoryWikiMutation = {
        op: "update_metadata",
        lookup: params.operation.lookup,
        ...(params.operation.sourceIds ? { sourceIds: params.operation.sourceIds } : {}),
        ...(params.operation.claims ? { claims: params.operation.claims as WikiClaim[] } : {}),
        ...(params.operation.contradictions
          ? { contradictions: params.operation.contradictions }
          : {}),
        ...(params.operation.questions ? { questions: params.operation.questions } : {}),
        ...(params.operation.confidence !== undefined
          ? { confidence: params.operation.confidence }
          : {}),
        ...(params.operation.status ? { status: params.operation.status } : {}),
      };
      await applyMemoryWikiMutation({ config: params.config, mutation });
      return;
    }
    case "compile":
      await compileMemoryWikiVault(params.config);
      return;
    case "write_page": {
      const absolutePath = path.join(params.config.vault.path, params.operation.relativePath);
      await fs.mkdir(path.dirname(absolutePath), { recursive: true });
      await fs.writeFile(
        absolutePath,
        `${renderWikiMarkdown({
          frontmatter: params.operation.frontmatter,
          body: params.operation.body,
        })}\n`,
        "utf8",
      );
      return;
    }
    case "remove_page":
      await fs.rm(path.join(params.config.vault.path, params.operation.relativePath), {
        force: true,
      });
      return;
  }
}

async function executeBenchmarkOperations(params: {
  config: ResolvedMemoryWikiConfig;
  datasetDir: string;
  operations: BenchmarkOperation[];
}): Promise<number> {
  const startedAt = performance.now();
  for (const operation of params.operations) {
    await executeBenchmarkOperation({
      config: params.config,
      datasetDir: params.datasetDir,
      operation,
    });
  }
  return performance.now() - startedAt;
}

async function evaluateBeirCase(params: {
  dataset: WikiBenchmarkDataset;
  datasetDir: string;
  config: ResolvedMemoryWikiConfig;
  appConfig?: OpenClawConfig;
  benchmarkCase: BeirCase;
  defaultBackend?: WikiSearchBackend;
  defaultCorpus?: WikiSearchCorpus;
}): Promise<Extract<WikiBenchmarkCaseResult, { profile: "beir" }>> {
  const caseConfig =
    params.benchmarkCase.operations && params.benchmarkCase.operations.length > 0
      ? await createSandboxConfig(params.config)
      : null;
  const activeConfig = caseConfig?.config ?? params.config;
  try {
    if (params.benchmarkCase.operations?.length) {
      await executeBenchmarkOperations({
        config: activeConfig,
        datasetDir: params.datasetDir,
        operations: params.benchmarkCase.operations,
      });
    }
    const searchOverrides = resolveSearchOverrides({
      dataset: params.dataset,
      search: params.benchmarkCase.search,
      defaultBackend: params.defaultBackend,
      defaultCorpus: params.defaultCorpus,
    });
    const search = await executeSearch({
      config: activeConfig,
      appConfig: params.appConfig,
      query: params.benchmarkCase.query,
      ...searchOverrides,
    });
    const metrics = computeBinaryMetrics(search.results, params.benchmarkCase.relevant);
    const failureReasons: string[] = [];
    if (
      params.benchmarkCase.minRecallAtK !== undefined &&
      metrics.recallAtK < params.benchmarkCase.minRecallAtK
    ) {
      failureReasons.push(
        `Recall@${search.topK} ${metrics.recallAtK.toFixed(3)} < ${params.benchmarkCase.minRecallAtK.toFixed(3)}`,
      );
    }
    if (params.benchmarkCase.minMrr !== undefined && metrics.mrr < params.benchmarkCase.minMrr) {
      failureReasons.push(
        `MRR ${metrics.mrr.toFixed(3)} < ${params.benchmarkCase.minMrr.toFixed(3)}`,
      );
    }
    if (
      params.benchmarkCase.minNdcgAtK !== undefined &&
      metrics.ndcgAtK < params.benchmarkCase.minNdcgAtK
    ) {
      failureReasons.push(
        `NDCG@${search.topK} ${metrics.ndcgAtK.toFixed(3)} < ${params.benchmarkCase.minNdcgAtK.toFixed(3)}`,
      );
    }
    if (
      params.benchmarkCase.minRecallAtK === undefined &&
      params.benchmarkCase.minMrr === undefined &&
      params.benchmarkCase.minNdcgAtK === undefined &&
      metrics.hitCount === 0
    ) {
      failureReasons.push(`No relevant result in top ${search.topK}.`);
    }
    return {
      profile: "beir",
      id: params.benchmarkCase.id,
      description: params.benchmarkCase.description,
      query: params.benchmarkCase.query,
      topK: search.topK,
      recallAtK: metrics.recallAtK,
      mrr: metrics.mrr,
      ndcgAtK: metrics.ndcgAtK,
      hitCount: metrics.hitCount,
      firstRelevantRank: metrics.firstRelevantRank,
      matchedPaths: metrics.matchedPaths,
      searchMs: search.elapsedMs,
      passed: failureReasons.length === 0,
      failureReasons,
    };
  } finally {
    await caseConfig?.cleanup();
  }
}

async function evaluateRagasCase(params: {
  dataset: WikiBenchmarkDataset;
  datasetDir: string;
  config: ResolvedMemoryWikiConfig;
  appConfig?: OpenClawConfig;
  benchmarkCase: RagasCase;
  defaultBackend?: WikiSearchBackend;
  defaultCorpus?: WikiSearchCorpus;
}): Promise<Extract<WikiBenchmarkCaseResult, { profile: "ragas" }>> {
  const caseConfig =
    params.benchmarkCase.operations && params.benchmarkCase.operations.length > 0
      ? await createSandboxConfig(params.config)
      : null;
  const activeConfig = caseConfig?.config ?? params.config;
  try {
    if (params.benchmarkCase.operations?.length) {
      await executeBenchmarkOperations({
        config: activeConfig,
        datasetDir: params.datasetDir,
        operations: params.benchmarkCase.operations,
      });
    }
    const searchOverrides = resolveSearchOverrides({
      dataset: params.dataset,
      search: params.benchmarkCase.search,
      defaultBackend: params.defaultBackend,
      defaultCorpus: params.defaultCorpus,
    });
    const search = await executeSearch({
      config: activeConfig,
      appConfig: params.appConfig,
      query: params.benchmarkCase.query,
      ...searchOverrides,
    });
    const metrics = computeBinaryMetrics(search.results, params.benchmarkCase.relevant);
    const retrievedContexts = await Promise.all(
      search.results.map((result) =>
        readResultContext(activeConfig, params.appConfig, result, search),
      ),
    );
    const relevantContexts = search.results.flatMap((result, index) =>
      params.benchmarkCase.relevant.some((target) => matchesTarget(result, target))
        ? [retrievedContexts[index] ?? ""]
        : [],
    );
    const answerRelevance =
      params.benchmarkCase.expectedAnswerPhrases.filter((phrase) =>
        normalizeValue(retrievedContexts[0]).includes(normalizeValue(phrase)),
      ).length / params.benchmarkCase.expectedAnswerPhrases.length;
    const faithfulness =
      params.benchmarkCase.expectedAnswerPhrases.filter((phrase) =>
        relevantContexts.some((context) =>
          normalizeValue(context).includes(normalizeValue(phrase)),
        ),
      ).length / params.benchmarkCase.expectedAnswerPhrases.length;
    const contextPrecision =
      search.results.length > 0 ? metrics.hitCount / search.results.length : 0;
    const contextRecall = metrics.recallAtK;
    const failureReasons: string[] = [];
    if (
      params.benchmarkCase.minContextPrecision !== undefined &&
      contextPrecision < params.benchmarkCase.minContextPrecision
    ) {
      failureReasons.push(
        `Context precision ${contextPrecision.toFixed(3)} < ${params.benchmarkCase.minContextPrecision.toFixed(3)}`,
      );
    }
    if (
      params.benchmarkCase.minContextRecall !== undefined &&
      contextRecall < params.benchmarkCase.minContextRecall
    ) {
      failureReasons.push(
        `Context recall ${contextRecall.toFixed(3)} < ${params.benchmarkCase.minContextRecall.toFixed(3)}`,
      );
    }
    if (
      params.benchmarkCase.minFaithfulness !== undefined &&
      faithfulness < params.benchmarkCase.minFaithfulness
    ) {
      failureReasons.push(
        `Faithfulness ${faithfulness.toFixed(3)} < ${params.benchmarkCase.minFaithfulness.toFixed(3)}`,
      );
    }
    if (
      params.benchmarkCase.minAnswerRelevance !== undefined &&
      answerRelevance < params.benchmarkCase.minAnswerRelevance
    ) {
      failureReasons.push(
        `Answer relevance ${answerRelevance.toFixed(3)} < ${params.benchmarkCase.minAnswerRelevance.toFixed(3)}`,
      );
    }
    if (
      params.benchmarkCase.minContextPrecision === undefined &&
      params.benchmarkCase.minContextRecall === undefined &&
      params.benchmarkCase.minFaithfulness === undefined &&
      params.benchmarkCase.minAnswerRelevance === undefined &&
      !(contextRecall > 0 && faithfulness > 0)
    ) {
      failureReasons.push("No grounded answer support found in retrieved relevant context.");
    }
    return {
      profile: "ragas",
      id: params.benchmarkCase.id,
      description: params.benchmarkCase.description,
      query: params.benchmarkCase.query,
      topK: search.topK,
      contextPrecision,
      contextRecall,
      answerRelevance,
      faithfulness,
      matchedPaths: metrics.matchedPaths,
      searchMs: search.elapsedMs,
      passed: failureReasons.length === 0,
      failureReasons,
    };
  } finally {
    await caseConfig?.cleanup();
  }
}

async function evaluateCrudCase(params: {
  dataset: WikiBenchmarkDataset;
  datasetDir: string;
  config: ResolvedMemoryWikiConfig;
  appConfig?: OpenClawConfig;
  benchmarkCase: CrudCase;
  defaultBackend?: WikiSearchBackend;
  defaultCorpus?: WikiSearchCorpus;
}): Promise<Extract<WikiBenchmarkCaseResult, { profile: "crud-rag" }>> {
  const sandbox = await createSandboxConfig(params.config);
  try {
    const searchOverrides = resolveSearchOverrides({
      dataset: params.dataset,
      search: params.benchmarkCase.search,
      defaultBackend: params.defaultBackend,
      defaultCorpus: params.defaultCorpus,
    });
    if (params.benchmarkCase.operations?.length) {
      await executeBenchmarkOperations({
        config: sandbox.config,
        datasetDir: params.datasetDir,
        operations: params.benchmarkCase.operations,
      });
    }
    let beforeRecallAtK: number | undefined;
    if (params.benchmarkCase.beforeQuery) {
      const beforeSearch = await executeSearch({
        config: sandbox.config,
        appConfig: params.appConfig,
        query: params.benchmarkCase.beforeQuery,
        ...searchOverrides,
      });
      if (params.benchmarkCase.beforeRelevant?.length) {
        beforeRecallAtK = computeBinaryMetrics(
          beforeSearch.results,
          params.benchmarkCase.beforeRelevant,
        ).recallAtK;
      }
    }
    const mutationMs = await executeBenchmarkOperations({
      config: sandbox.config,
      datasetDir: params.datasetDir,
      operations: params.benchmarkCase.mutations,
    });
    const afterSearch = await executeSearch({
      config: sandbox.config,
      appConfig: params.appConfig,
      query: params.benchmarkCase.afterQuery,
      ...searchOverrides,
    });
    const afterMetrics = computeBinaryMetrics(
      afterSearch.results,
      params.benchmarkCase.afterRelevant ?? [],
    );
    const absentTargets = params.benchmarkCase.afterAbsent ?? [];
    const absentHits = afterSearch.results.filter((result) =>
      absentTargets.some((target) => matchesTarget(result, target)),
    ).length;
    const deleteSuppressionRate =
      absentTargets.length > 0 ? Math.max(0, 1 - absentHits / absentTargets.length) : 1;
    const failureReasons: string[] = [];
    const requiredAfterRecall =
      params.benchmarkCase.minAfterRecallAtK ??
      ((params.benchmarkCase.afterRelevant?.length ?? 0) > 0
        ? 1 / params.benchmarkCase.afterRelevant!.length
        : 0);
    if (
      (params.benchmarkCase.afterRelevant?.length ?? 0) > 0 &&
      afterMetrics.recallAtK < requiredAfterRecall
    ) {
      failureReasons.push(
        `After recall@${afterSearch.topK} ${afterMetrics.recallAtK.toFixed(3)} < ${requiredAfterRecall.toFixed(3)}`,
      );
    }
    const requiredDeleteSuppression = params.benchmarkCase.minDeleteSuppression ?? 1;
    if (deleteSuppressionRate < requiredDeleteSuppression) {
      failureReasons.push(
        `Delete suppression ${deleteSuppressionRate.toFixed(3)} < ${requiredDeleteSuppression.toFixed(3)}`,
      );
    }
    return {
      profile: "crud-rag",
      id: params.benchmarkCase.id,
      description: params.benchmarkCase.description,
      beforeQuery: params.benchmarkCase.beforeQuery,
      afterQuery: params.benchmarkCase.afterQuery,
      topK: afterSearch.topK,
      beforeRecallAtK,
      afterRecallAtK: afterMetrics.recallAtK,
      deleteSuppressionRate,
      mutationMs,
      matchedPathsAfter: afterMetrics.matchedPaths,
      searchMs: afterSearch.elapsedMs,
      passed: failureReasons.length === 0,
      failureReasons,
    };
  } finally {
    await sandbox.cleanup();
  }
}

async function evaluateLongMemCase(params: {
  dataset: WikiBenchmarkDataset;
  datasetDir: string;
  config: ResolvedMemoryWikiConfig;
  appConfig?: OpenClawConfig;
  benchmarkCase: LongMemEvalCase;
  defaultBackend?: WikiSearchBackend;
  defaultCorpus?: WikiSearchCorpus;
}): Promise<Extract<WikiBenchmarkCaseResult, { profile: "longmemeval" }>> {
  const caseConfig =
    params.benchmarkCase.operations && params.benchmarkCase.operations.length > 0
      ? await createSandboxConfig(params.config)
      : null;
  const activeConfig = caseConfig?.config ?? params.config;
  try {
    if (params.benchmarkCase.operations?.length) {
      await executeBenchmarkOperations({
        config: activeConfig,
        datasetDir: params.datasetDir,
        operations: params.benchmarkCase.operations,
      });
    }
    const searchOverrides = resolveSearchOverrides({
      dataset: params.dataset,
      search: params.benchmarkCase.search,
      defaultBackend: params.defaultBackend,
      defaultCorpus: params.defaultCorpus,
    });
    const search = await executeSearch({
      config: activeConfig,
      appConfig: params.appConfig,
      query: params.benchmarkCase.query,
      ...searchOverrides,
    });
    const preferredMetrics = computeBinaryMetrics(search.results, params.benchmarkCase.preferred);
    const preferredRank = search.results.findIndex((result) =>
      params.benchmarkCase.preferred.some((target) => matchesTarget(result, target)),
    );
    const disfavoredRank = search.results.findIndex((result) =>
      params.benchmarkCase.disfavored?.some((target) => matchesTarget(result, target)),
    );
    let faithfulness: number | undefined;
    if (params.benchmarkCase.expectedAnswerPhrases?.length) {
      const contexts = await Promise.all(
        search.results.map((result) =>
          readResultContext(activeConfig, params.appConfig, result, search),
        ),
      );
      faithfulness =
        params.benchmarkCase.expectedAnswerPhrases.filter((phrase) =>
          contexts.some((context) => normalizeValue(context).includes(normalizeValue(phrase))),
        ).length / params.benchmarkCase.expectedAnswerPhrases.length;
    }
    const failureReasons: string[] = [];
    const requiredRecall =
      params.benchmarkCase.minPreferredRecallAtK ??
      1 / Math.max(params.benchmarkCase.preferred.length, 1);
    if (preferredMetrics.recallAtK < requiredRecall) {
      failureReasons.push(
        `Preferred recall@${search.topK} ${preferredMetrics.recallAtK.toFixed(3)} < ${requiredRecall.toFixed(3)}`,
      );
    }
    if (
      params.benchmarkCase.requirePreferredBeforeDisfavored &&
      preferredRank >= 0 &&
      disfavoredRank >= 0 &&
      preferredRank > disfavoredRank
    ) {
      failureReasons.push(
        `Preferred result ranked after disfavored result (${preferredRank + 1} > ${disfavoredRank + 1}).`,
      );
    }
    if (
      params.benchmarkCase.minFaithfulness !== undefined &&
      (faithfulness ?? 0) < params.benchmarkCase.minFaithfulness
    ) {
      failureReasons.push(
        `Faithfulness ${(faithfulness ?? 0).toFixed(3)} < ${params.benchmarkCase.minFaithfulness.toFixed(3)}`,
      );
    }
    return {
      profile: "longmemeval",
      id: params.benchmarkCase.id,
      description: params.benchmarkCase.description,
      query: params.benchmarkCase.query,
      topK: search.topK,
      preferredRecallAtK: preferredMetrics.recallAtK,
      faithfulness,
      preferredRank: preferredRank >= 0 ? preferredRank + 1 : undefined,
      disfavoredRank: disfavoredRank >= 0 ? disfavoredRank + 1 : undefined,
      searchMs: search.elapsedMs,
      passed: failureReasons.length === 0,
      failureReasons,
    };
  } finally {
    await caseConfig?.cleanup();
  }
}

export async function runMemoryWikiBenchmark(params: {
  config: ResolvedMemoryWikiConfig;
  datasetPath: string;
  appConfig?: OpenClawConfig;
  profile?: WikiBenchmarkProfile;
  searchBackend?: WikiSearchBackend;
  searchCorpus?: WikiSearchCorpus;
}): Promise<WikiBenchmarkResult> {
  const startedAt = performance.now();
  const datasetPath = path.resolve(params.datasetPath);
  const datasetDir = path.dirname(datasetPath);
  const raw = await fs.readFile(datasetPath, "utf8");
  const dataset = WikiBenchmarkDatasetSchema.parse(JSON.parse(raw));
  const selectedProfile = params.profile ?? "all";
  const profiles: WikiBenchmarkResult["profiles"] = {};
  const caseResults: WikiBenchmarkCaseResult[] = [];

  if (selectedProfile === "all" || selectedProfile === "beir") {
    const cases = await Promise.all(
      (dataset.beir ?? []).map((benchmarkCase) =>
        evaluateBeirCase({
          dataset,
          datasetDir,
          config: params.config,
          appConfig: params.appConfig,
          benchmarkCase,
          defaultBackend: params.searchBackend,
          defaultCorpus: params.searchCorpus,
        }),
      ),
    );
    caseResults.push(...cases);
    profiles.beir = {
      caseCount: cases.length,
      passedCases: cases.filter((benchmarkCase) => benchmarkCase.passed).length,
      failedCases: cases.filter((benchmarkCase) => !benchmarkCase.passed).length,
      averageSearchMs: average(cases.map((benchmarkCase) => benchmarkCase.searchMs)),
      averageRecallAtK: average(cases.map((benchmarkCase) => benchmarkCase.recallAtK)),
      averageMrr: average(cases.map((benchmarkCase) => benchmarkCase.mrr)),
      averageNdcgAtK: average(cases.map((benchmarkCase) => benchmarkCase.ndcgAtK)),
      cases,
    };
  }

  if (selectedProfile === "all" || selectedProfile === "ragas") {
    const cases = await Promise.all(
      (dataset.ragas ?? []).map((benchmarkCase) =>
        evaluateRagasCase({
          dataset,
          datasetDir,
          config: params.config,
          appConfig: params.appConfig,
          benchmarkCase,
          defaultBackend: params.searchBackend,
          defaultCorpus: params.searchCorpus,
        }),
      ),
    );
    caseResults.push(...cases);
    profiles.ragas = {
      caseCount: cases.length,
      passedCases: cases.filter((benchmarkCase) => benchmarkCase.passed).length,
      failedCases: cases.filter((benchmarkCase) => !benchmarkCase.passed).length,
      averageSearchMs: average(cases.map((benchmarkCase) => benchmarkCase.searchMs)),
      averageContextPrecision: average(
        cases.map((benchmarkCase) => benchmarkCase.contextPrecision),
      ),
      averageContextRecall: average(cases.map((benchmarkCase) => benchmarkCase.contextRecall)),
      averageAnswerRelevance: average(cases.map((benchmarkCase) => benchmarkCase.answerRelevance)),
      averageFaithfulness: average(cases.map((benchmarkCase) => benchmarkCase.faithfulness)),
      cases,
    };
  }

  if (selectedProfile === "all" || selectedProfile === "crud-rag") {
    const cases = await Promise.all(
      (dataset.crudRag ?? []).map((benchmarkCase) =>
        evaluateCrudCase({
          dataset,
          datasetDir,
          config: params.config,
          appConfig: params.appConfig,
          benchmarkCase,
          defaultBackend: params.searchBackend,
          defaultCorpus: params.searchCorpus,
        }),
      ),
    );
    caseResults.push(...cases);
    profiles.crudRag = {
      caseCount: cases.length,
      passedCases: cases.filter((benchmarkCase) => benchmarkCase.passed).length,
      failedCases: cases.filter((benchmarkCase) => !benchmarkCase.passed).length,
      averageSearchMs: average(cases.map((benchmarkCase) => benchmarkCase.searchMs)),
      averageBeforeRecallAtK: average(
        cases.flatMap((benchmarkCase) =>
          typeof benchmarkCase.beforeRecallAtK === "number" ? [benchmarkCase.beforeRecallAtK] : [],
        ),
      ),
      averageAfterRecallAtK: average(cases.map((benchmarkCase) => benchmarkCase.afterRecallAtK)),
      averageDeleteSuppressionRate: average(
        cases.map((benchmarkCase) => benchmarkCase.deleteSuppressionRate),
      ),
      averageMutationMs: average(cases.map((benchmarkCase) => benchmarkCase.mutationMs)),
      cases,
    };
  }

  if (selectedProfile === "all" || selectedProfile === "longmemeval") {
    const cases = await Promise.all(
      (dataset.longMemEval ?? []).map((benchmarkCase) =>
        evaluateLongMemCase({
          dataset,
          datasetDir,
          config: params.config,
          appConfig: params.appConfig,
          benchmarkCase,
          defaultBackend: params.searchBackend,
          defaultCorpus: params.searchCorpus,
        }),
      ),
    );
    caseResults.push(...cases);
    profiles.longMemEval = {
      caseCount: cases.length,
      passedCases: cases.filter((benchmarkCase) => benchmarkCase.passed).length,
      failedCases: cases.filter((benchmarkCase) => !benchmarkCase.passed).length,
      averageSearchMs: average(cases.map((benchmarkCase) => benchmarkCase.searchMs)),
      averagePreferredRecallAtK: average(
        cases.map((benchmarkCase) => benchmarkCase.preferredRecallAtK),
      ),
      averageFaithfulness: average(
        cases.flatMap((benchmarkCase) =>
          typeof benchmarkCase.faithfulness === "number" ? [benchmarkCase.faithfulness] : [],
        ),
      ),
      preferenceOrderingPassRate:
        cases.length > 0
          ? cases.filter((benchmarkCase) => benchmarkCase.passed).length / cases.length
          : 0,
      cases,
    };
  }

  return {
    suiteName: dataset.name,
    ...(dataset.description ? { suiteDescription: dataset.description } : {}),
    datasetPath,
    evaluatedAt: new Date().toISOString(),
    selectedProfile,
    totalCases: caseResults.length,
    passedCases: caseResults.filter((benchmarkCase) => benchmarkCase.passed).length,
    failedCases: caseResults.filter((benchmarkCase) => !benchmarkCase.passed).length,
    wallTimeMs: performance.now() - startedAt,
    profiles,
  };
}

function formatFailureLines(caseResults: WikiBenchmarkCaseResult[]): string[] {
  return caseResults.flatMap((benchmarkCase) =>
    benchmarkCase.passed
      ? []
      : benchmarkCase.failureReasons.map(
          (reason) => `- ${benchmarkCase.profile}:${benchmarkCase.id}: ${reason}`,
        ),
  );
}

export function renderMemoryWikiBenchmarkResult(result: WikiBenchmarkResult): string {
  const lines = [
    `Wiki benchmark suite: ${result.suiteName}`,
    `Dataset: ${result.datasetPath}`,
    `Profile: ${result.selectedProfile}`,
    `Cases: ${result.passedCases}/${result.totalCases} passed (${result.failedCases} failed)`,
    `Wall time: ${result.wallTimeMs.toFixed(1)}ms`,
  ];

  if (result.profiles.beir) {
    lines.push(
      `BEIR-style retrieval: ${result.profiles.beir.passedCases}/${result.profiles.beir.caseCount} passed | Recall@k ${result.profiles.beir.averageRecallAtK.toFixed(3)} | MRR ${result.profiles.beir.averageMrr.toFixed(3)} | NDCG@k ${result.profiles.beir.averageNdcgAtK.toFixed(3)}`,
    );
  }
  if (result.profiles.ragas) {
    lines.push(
      `RAGAS-style grounding: ${result.profiles.ragas.passedCases}/${result.profiles.ragas.caseCount} passed | Precision ${result.profiles.ragas.averageContextPrecision.toFixed(3)} | Recall ${result.profiles.ragas.averageContextRecall.toFixed(3)} | Faithfulness ${result.profiles.ragas.averageFaithfulness.toFixed(3)}`,
    );
  }
  if (result.profiles.crudRag) {
    lines.push(
      `CRUD-RAG update flow: ${result.profiles.crudRag.passedCases}/${result.profiles.crudRag.caseCount} passed | After recall ${result.profiles.crudRag.averageAfterRecallAtK.toFixed(3)} | Delete suppression ${result.profiles.crudRag.averageDeleteSuppressionRate.toFixed(3)} | Mutation ${result.profiles.crudRag.averageMutationMs.toFixed(1)}ms`,
    );
  }
  if (result.profiles.longMemEval) {
    lines.push(
      `LongMemEval-style memory: ${result.profiles.longMemEval.passedCases}/${result.profiles.longMemEval.caseCount} passed | Preferred recall ${result.profiles.longMemEval.averagePreferredRecallAtK.toFixed(3)} | Ordering pass ${result.profiles.longMemEval.preferenceOrderingPassRate.toFixed(3)} | Faithfulness ${result.profiles.longMemEval.averageFaithfulness.toFixed(3)}`,
    );
  }

  const failures = formatFailureLines([
    ...(result.profiles.beir?.cases ?? []),
    ...(result.profiles.ragas?.cases ?? []),
    ...(result.profiles.crudRag?.cases ?? []),
    ...(result.profiles.longMemEval?.cases ?? []),
  ]);
  if (failures.length > 0) {
    lines.push("", "Failures:", ...failures);
  }

  return lines.join("\n");
}

export async function writeMemoryWikiBenchmarkTemplate(outputPath: string): Promise<string> {
  const absolutePath = path.resolve(outputPath);
  await fs.mkdir(path.dirname(absolutePath), { recursive: true });
  await fs.writeFile(
    absolutePath,
    `${JSON.stringify(createMemoryWikiBenchmarkTemplate(), null, 2)}\n`,
    "utf8",
  );
  return absolutePath;
}
