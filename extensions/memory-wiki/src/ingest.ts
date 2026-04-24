import fs from "node:fs/promises";
import path from "node:path";
import { compileMemoryWikiVault } from "./compile.js";
import type { ResolvedMemoryWikiConfig } from "./config.js";
import { extractWikiSourceContent } from "./document-extract.js";
import { appendMemoryWikiLog } from "./log.js";
import { renderMarkdownFence, renderWikiMarkdown, slugifyWikiSegment } from "./markdown.js";
import { initializeMemoryWikiVault } from "./vault.js";

export type IngestMemoryWikiSourceResult = {
  sourcePath: string;
  pageId: string;
  pagePath: string;
  title: string;
  bytes: number;
  created: boolean;
  indexUpdatedFiles: string[];
};

function pathExists(filePath: string): Promise<boolean> {
  return fs
    .access(filePath)
    .then(() => true)
    .catch(() => false);
}

function resolveSourceTitle(sourcePath: string, explicitTitle?: string): string {
  if (explicitTitle?.trim()) {
    return explicitTitle.trim();
  }
  return path.basename(sourcePath, path.extname(sourcePath)).replace(/[-_]+/g, " ").trim();
}

export async function ingestMemoryWikiSource(params: {
  config: ResolvedMemoryWikiConfig;
  inputPath: string;
  title?: string;
  nowMs?: number;
}): Promise<IngestMemoryWikiSourceResult> {
  await initializeMemoryWikiVault(params.config, { nowMs: params.nowMs });
  const sourcePath = path.resolve(params.inputPath);
  const buffer = await fs.readFile(sourcePath);
  const extracted = await extractWikiSourceContent({ buffer, sourcePath });
  const title = resolveSourceTitle(sourcePath, params.title);
  const slug = slugifyWikiSegment(title);
  const pageId = `source.${slug}`;
  const pageRelativePath = path.join("sources", `${slug}.md`);
  const pagePath = path.join(params.config.vault.path, pageRelativePath);
  const created = !(await pathExists(pagePath));
  const timestamp = new Date(params.nowMs ?? Date.now()).toISOString();

  const markdown = renderWikiMarkdown({
    frontmatter: {
      pageType: "source",
      id: pageId,
      title,
      sourceType: "local-file",
      sourceFormat: extracted.format,
      sourceExtractedBy: extracted.extractedBy,
      sourcePath,
      ingestedAt: timestamp,
      updatedAt: timestamp,
      status: "active",
    },
    body: [
      `# ${title}`,
      "",
      "## Source",
      `- Type: \`local-file\``,
      `- Format: \`${extracted.format}\``,
      `- Extracted via: \`${extracted.extractedBy}\``,
      `- Path: \`${sourcePath}\``,
      `- Bytes: ${buffer.byteLength}`,
      `- Updated: ${timestamp}`,
      "",
      "## Content",
      renderMarkdownFence(extracted.text, "text"),
      "",
      "## Notes",
      "<!-- openclaw:human:start -->",
      "<!-- openclaw:human:end -->",
      "",
    ].join("\n"),
  });

  await fs.writeFile(pagePath, markdown, "utf8");
  await appendMemoryWikiLog(params.config.vault.path, {
    type: "ingest",
    timestamp,
    details: {
      inputPath: sourcePath,
      pageId,
      pagePath: pageRelativePath.split(path.sep).join("/"),
      bytes: buffer.byteLength,
      created,
    },
  });
  const compile = await compileMemoryWikiVault(params.config);

  return {
    sourcePath,
    pageId,
    pagePath: pageRelativePath.split(path.sep).join("/"),
    title,
    bytes: buffer.byteLength,
    created,
    indexUpdatedFiles: compile.updatedFiles,
  };
}
