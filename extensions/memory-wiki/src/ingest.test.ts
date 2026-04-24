import fs from "node:fs/promises";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ingestMemoryWikiSource } from "./ingest.js";
import { createMemoryWikiTestHarness } from "./test-helpers.js";

const { extractWikiSourceContentMock } = vi.hoisted(() => ({
  extractWikiSourceContentMock: vi.fn(),
}));

vi.mock("./document-extract.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./document-extract.js")>();
  return {
    ...actual,
    extractWikiSourceContent: extractWikiSourceContentMock.mockImplementation(
      actual.extractWikiSourceContent,
    ),
  };
});

const { createTempDir, createVault } = createMemoryWikiTestHarness();

describe("ingestMemoryWikiSource", () => {
  beforeEach(() => {
    extractWikiSourceContentMock.mockClear();
  });

  it("copies a local text file into sources markdown", async () => {
    const rootDir = await createTempDir("memory-wiki-ingest-");
    const inputPath = path.join(rootDir, "meeting-notes.txt");
    await fs.writeFile(inputPath, "hello from source\n", "utf8");
    const { config } = await createVault({
      rootDir: path.join(rootDir, "vault"),
    });

    const result = await ingestMemoryWikiSource({
      config,
      inputPath,
      nowMs: Date.UTC(2026, 3, 5, 12, 0, 0),
    });

    expect(result.pageId).toBe("source.meeting-notes");
    expect(result.pagePath).toBe("sources/meeting-notes.md");
    expect(result.indexUpdatedFiles.length).toBeGreaterThan(0);
    await expect(
      fs.readFile(path.join(config.vault.path, "sources", "meeting-notes.md"), "utf8"),
    ).resolves.toContain("hello from source");
    await expect(fs.readFile(path.join(config.vault.path, "index.md"), "utf8")).resolves.toContain(
      "[meeting notes](sources/meeting-notes.md)",
    );
  });

  it("records extracted pdf source metadata in the source page", async () => {
    extractWikiSourceContentMock.mockResolvedValueOnce({
      text: "Quarterly results\nRevenue up 18%",
      format: "pdf",
      extractedBy: "pdfjs",
    });
    const rootDir = await createTempDir("memory-wiki-ingest-pdf-");
    const inputPath = path.join(rootDir, "report.pdf");
    await fs.writeFile(inputPath, Buffer.from("%PDF-test"), "utf8");
    const { config } = await createVault({
      rootDir: path.join(rootDir, "vault"),
    });

    await ingestMemoryWikiSource({
      config,
      inputPath,
      nowMs: Date.UTC(2026, 3, 5, 12, 0, 0),
    });

    await expect(
      fs.readFile(path.join(config.vault.path, "sources", "report.md"), "utf8"),
    ).resolves.toContain("Format: `pdf`");
    await expect(
      fs.readFile(path.join(config.vault.path, "sources", "report.md"), "utf8"),
    ).resolves.toContain("Extracted via: `pdfjs`");
    await expect(
      fs.readFile(path.join(config.vault.path, "sources", "report.md"), "utf8"),
    ).resolves.toContain("Revenue up 18%");
  });
});
