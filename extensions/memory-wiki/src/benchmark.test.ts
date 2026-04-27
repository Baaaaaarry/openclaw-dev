import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createMemoryWikiBenchmarkTemplate,
  renderMemoryWikiBenchmarkResult,
  runMemoryWikiBenchmark,
} from "./benchmark.js";
import { compileMemoryWikiVault } from "./compile.js";
import { renderWikiMarkdown } from "./markdown.js";
import { createMemoryWikiTestHarness } from "./test-helpers.js";

const { createVault } = createMemoryWikiTestHarness();

describe("runMemoryWikiBenchmark", () => {
  let suiteRoot = "";
  let caseId = 0;

  beforeAll(async () => {
    suiteRoot = await fs.mkdtemp(path.join(os.tmpdir(), "memory-wiki-benchmark-suite-"));
  });

  afterAll(async () => {
    if (suiteRoot) {
      await fs.rm(suiteRoot, { recursive: true, force: true });
    }
  });

  function nextCaseRoot() {
    return path.join(suiteRoot, `case-${caseId++}`);
  }

  it("runs all benchmark profiles against the current wiki", async () => {
    const { rootDir, config } = await createVault({
      rootDir: nextCaseRoot(),
      initialize: true,
    });

    await fs.writeFile(
      path.join(rootDir, "sources", "alpha.md"),
      renderWikiMarkdown({
        frontmatter: {
          pageType: "source",
          id: "source.alpha",
          title: "Alpha Source",
          updatedAt: "2026-04-10T00:00:00.000Z",
        },
        body: "# Alpha Source\n\nPostgreSQL deployment notes.\n",
      }),
      "utf8",
    );
    await fs.writeFile(
      path.join(rootDir, "entities", "alpha.md"),
      renderWikiMarkdown({
        frontmatter: {
          pageType: "entity",
          id: "entity.alpha",
          title: "Alpha",
          sourceIds: ["source.alpha"],
          updatedAt: "2026-04-10T00:00:00.000Z",
          claims: [
            {
              id: "claim.alpha.postgres",
              text: "Alpha uses PostgreSQL for production writes.",
              status: "supported",
              confidence: 0.95,
              evidence: [{ sourceId: "source.alpha", lines: "1-2" }],
            },
          ],
        },
        body: "# Alpha\n\nCurrent production stack.\n",
      }),
      "utf8",
    );
    await fs.writeFile(
      path.join(rootDir, "entities", "alpha-legacy.md"),
      renderWikiMarkdown({
        frontmatter: {
          pageType: "entity",
          id: "entity.alpha.legacy",
          title: "Alpha Legacy",
          sourceIds: ["source.alpha"],
          updatedAt: "2025-10-01T00:00:00.000Z",
          claims: [
            {
              id: "claim.alpha.mysql",
              text: "Alpha used MySQL before the migration.",
              status: "contested",
              confidence: 0.4,
              evidence: [{ sourceId: "source.alpha", lines: "1-2" }],
            },
          ],
        },
        body: "# Alpha Legacy\n\nDeprecated architecture note.\n",
      }),
      "utf8",
    );

    await compileMemoryWikiVault(config);

    const datasetPath = path.join(rootDir, "benchmark.json");
    await fs.writeFile(
      datasetPath,
      `${JSON.stringify(
        {
          version: 1,
          name: "memory-wiki-suite",
          defaults: {
            backend: "local",
            corpus: "wiki",
            topK: 5,
          },
          beir: [
            {
              id: "retrieval-alpha",
              query: "postgresql",
              relevant: ["entities/alpha.md"],
            },
          ],
          ragas: [
            {
              id: "grounded-alpha",
              query: "postgresql for production writes",
              relevant: ["entities/alpha.md"],
              expectedAnswerPhrases: ["Alpha uses PostgreSQL for production writes."],
            },
          ],
          crudRag: [
            {
              id: "crud-synthesis",
              mutations: [
                {
                  op: "apply_synthesis",
                  title: "Alpha rollout summary",
                  body: "Alpha rollout summary points to PostgreSQL as the production database.",
                  sourceIds: ["source.alpha"],
                },
              ],
              afterQuery: "alpha rollout summary",
              afterRelevant: ["syntheses/alpha-rollout-summary.md"],
            },
          ],
          longMemEval: [
            {
              id: "fresh-memory",
              query: "postgresql for production writes",
              preferred: ["entities/alpha.md"],
              disfavored: ["entities/alpha-legacy.md"],
              requirePreferredBeforeDisfavored: true,
            },
          ],
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    const result = await runMemoryWikiBenchmark({
      config,
      datasetPath,
      profile: "all",
      searchBackend: "local",
      searchCorpus: "wiki",
    });

    expect(result.failedCases).toBe(0);
    expect(result.totalCases).toBe(4);
    expect(result.profiles.beir?.averageRecallAtK).toBe(1);
    expect(result.profiles.ragas?.averageFaithfulness).toBe(1);
    expect(result.profiles.crudRag?.averageAfterRecallAtK).toBe(1);
    expect(result.profiles.longMemEval?.preferenceOrderingPassRate).toBe(1);

    const rendered = renderMemoryWikiBenchmarkResult(result);
    expect(rendered).toContain("BEIR-style retrieval");
    expect(rendered).toContain("RAGAS-style grounding");
    expect(rendered).toContain("CRUD-RAG update flow");
    expect(rendered).toContain("LongMemEval-style memory");
  });

  it("creates a benchmark template with all four profiles", () => {
    const template = createMemoryWikiBenchmarkTemplate();
    expect(template.beir).toHaveLength(1);
    expect(template.ragas).toHaveLength(1);
    expect(template.crudRag).toHaveLength(1);
    expect(template.longMemEval).toHaveLength(1);
  });
});
