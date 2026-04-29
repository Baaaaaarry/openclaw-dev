import fs from "node:fs/promises";
import path from "node:path";
import type { FSWatcher } from "chokidar";
import chokidar from "chokidar";
import type { ResolvedMemoryWikiConfig } from "./config.js";
import { ingestMemoryWikiSource, type IngestMemoryWikiSourceResult } from "./ingest.js";
import { initializeMemoryWikiVault } from "./vault.js";

const WATCH_IMPORT_SUPPORTED_EXTENSIONS = new Set([
  ".doc",
  ".docx",
  ".md",
  ".pdf",
  ".ppt",
  ".pptx",
]);
const WATCH_IMPORT_MANAGED_DIRS = new Set([
  ".openclaw-wiki",
  "_attachments",
  "_views",
  "concepts",
  "entities",
  "reports",
  "sources",
  "syntheses",
]);

type WatchImportState = {
  version: 1;
  files: Record<
    string,
    {
      size: number;
      mtimeMs: number;
      importedAt: string;
      pagePath: string;
    }
  >;
};

export type MemoryWikiWatchImportResult = {
  watchPath: string;
  statePath: string;
  scanned: number;
  imported: number;
  skipped: number;
  failed: number;
  importedFiles: Array<{
    inputPath: string;
    pagePath: string;
  }>;
  failures: Array<{
    inputPath: string;
    error: string;
  }>;
};

export type MemoryWikiWatchImportRun = MemoryWikiWatchImportResult & {
  stop(): Promise<void>;
};

type WatchImportQueueItem = {
  inputPath: string;
};

export type WatchFactory = (
  paths: string | readonly string[],
  options: {
    ignoreInitial: boolean;
    awaitWriteFinish: { stabilityThreshold: number; pollInterval: number };
    ignored: (watchPath: string) => boolean;
  },
) => Pick<FSWatcher, "on" | "close">;

function normalizeWatchTargets(paths: string | readonly string[]): string | string[] {
  return typeof paths === "string" ? paths : Array.from(paths);
}

function createEmptyState(): WatchImportState {
  return {
    version: 1,
    files: {},
  };
}

function normalizeWatchPath(inputPath: string): string {
  return path.resolve(inputPath);
}

function relativeWatchPath(rootDir: string, absolutePath: string): string {
  return path.relative(rootDir, absolutePath).replace(/\\/g, "/");
}

function shouldIgnoreWatchPath(rootDir: string, watchPath: string): boolean {
  const absolutePath = normalizeWatchPath(watchPath);
  const relativePath = relativeWatchPath(rootDir, absolutePath);
  if (!relativePath || relativePath.startsWith("..")) {
    return false;
  }
  const segments = relativePath.split("/").filter(Boolean);
  if (segments.some((segment) => WATCH_IMPORT_MANAGED_DIRS.has(segment))) {
    return true;
  }
  const extension = path.extname(absolutePath).toLowerCase();
  if (!extension) {
    return false;
  }
  return !WATCH_IMPORT_SUPPORTED_EXTENSIONS.has(extension);
}

async function readWatchImportState(statePath: string): Promise<WatchImportState> {
  const raw = await fs.readFile(statePath, "utf8").catch(() => null);
  if (!raw) {
    return createEmptyState();
  }
  try {
    const parsed = JSON.parse(raw) as WatchImportState;
    if (parsed?.version === 1 && parsed.files && typeof parsed.files === "object") {
      return parsed;
    }
  } catch {}
  return createEmptyState();
}

async function writeWatchImportState(statePath: string, state: WatchImportState): Promise<void> {
  await fs.mkdir(path.dirname(statePath), { recursive: true });
  await fs.writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

async function shouldImportFile(state: WatchImportState, filePath: string): Promise<boolean> {
  const stat = await fs.stat(filePath).catch(() => null);
  if (!stat?.isFile()) {
    return false;
  }
  const saved = state.files[filePath];
  if (!saved) {
    return true;
  }
  return saved.size !== stat.size || saved.mtimeMs !== stat.mtimeMs;
}

export function renderMemoryWikiWatchImportSummary(result: MemoryWikiWatchImportResult): string {
  const lines = [
    `Wiki watch-import`,
    `Watch path: ${result.watchPath}`,
    `State path: ${result.statePath}`,
    `Scanned: ${result.scanned}`,
    `Imported: ${result.imported}`,
    `Skipped: ${result.skipped}`,
    `Failed: ${result.failed}`,
  ];
  if (result.importedFiles.length > 0) {
    lines.push("", "Imported files:");
    lines.push(...result.importedFiles.map((entry) => `- ${entry.inputPath} -> ${entry.pagePath}`));
  }
  if (result.failures.length > 0) {
    lines.push("", "Failures:");
    lines.push(...result.failures.map((entry) => `- ${entry.inputPath}: ${entry.error}`));
  }
  return lines.join("\n");
}

export async function runMemoryWikiWatchImport(params: {
  config: ResolvedMemoryWikiConfig;
  watchPath?: string;
  statePath?: string;
  once?: boolean;
  settleMs?: number;
  watchFactory?: WatchFactory;
  stdout?: Pick<NodeJS.WriteStream, "write">;
}): Promise<MemoryWikiWatchImportRun> {
  await initializeMemoryWikiVault(params.config);
  const watchPath = normalizeWatchPath(params.watchPath ?? params.config.vault.path);
  const statePath =
    params.statePath ??
    path.join(params.config.vault.path, ".openclaw-wiki", "watch-import-state.json");
  const state = await readWatchImportState(statePath);
  const result: MemoryWikiWatchImportResult = {
    watchPath,
    statePath,
    scanned: 0,
    imported: 0,
    skipped: 0,
    failed: 0,
    importedFiles: [],
    failures: [],
  };
  const queue = new Map<string, WatchImportQueueItem>();
  let processing = false;
  let resolveReady: (() => void) | null = null;
  let readyPromiseResolved = false;
  const readyPromise = new Promise<void>((resolve) => {
    resolveReady = resolve;
  });

  const flushReady = () => {
    if (readyPromiseResolved) {
      return;
    }
    readyPromiseResolved = true;
    resolveReady?.();
  };

  const persistImportedFile = async (
    filePath: string,
    ingestResult: IngestMemoryWikiSourceResult,
  ) => {
    const stat = await fs.stat(filePath);
    state.files[filePath] = {
      size: stat.size,
      mtimeMs: stat.mtimeMs,
      importedAt: new Date().toISOString(),
      pagePath: ingestResult.pagePath,
    };
    await writeWatchImportState(statePath, state);
  };

  const processQueue = async () => {
    if (processing) {
      return;
    }
    processing = true;
    try {
      while (queue.size > 0) {
        const [filePath] = queue.entries().next().value as [string, WatchImportQueueItem];
        queue.delete(filePath);
        result.scanned += 1;
        const shouldImport = await shouldImportFile(state, filePath);
        if (!shouldImport) {
          result.skipped += 1;
          continue;
        }
        try {
          const ingestResult = await ingestMemoryWikiSource({
            config: params.config,
            inputPath: filePath,
          });
          await persistImportedFile(filePath, ingestResult);
          result.imported += 1;
          result.importedFiles.push({
            inputPath: filePath,
            pagePath: ingestResult.pagePath,
          });
        } catch (error) {
          result.failed += 1;
          result.failures.push({
            inputPath: filePath,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    } finally {
      processing = false;
      if (queue.size === 0) {
        flushReady();
      }
    }
  };

  const enqueueFile = (filePath: string) => {
    const absolutePath = normalizeWatchPath(filePath);
    if (shouldIgnoreWatchPath(watchPath, absolutePath)) {
      return;
    }
    queue.set(absolutePath, { inputPath: absolutePath });
    void processQueue();
  };

  const createWatcher =
    params.watchFactory ??
    ((paths, options) => chokidar.watch(normalizeWatchTargets(paths), options));
  const watcher = createWatcher(watchPath, {
    ignoreInitial: false,
    awaitWriteFinish: {
      stabilityThreshold: params.settleMs ?? 800,
      pollInterval: 100,
    },
    ignored: (candidatePath) => shouldIgnoreWatchPath(watchPath, candidatePath),
  });

  let closed = false;
  const stop = async () => {
    if (closed) {
      return;
    }
    closed = true;
    await watcher.close();
  };

  watcher.on("add", enqueueFile);
  watcher.on("change", enqueueFile);
  watcher.on("ready", () => {
    if (queue.size === 0 && !processing) {
      flushReady();
    }
  });
  watcher.on("error", (error) => {
    result.failed += 1;
    result.failures.push({
      inputPath: watchPath,
      error: error instanceof Error ? error.message : String(error),
    });
    flushReady();
  });

  if (params.once) {
    await readyPromise;
    await processQueue();
    await stop();
  }

  if (params.stdout && params.once) {
    params.stdout.write(`${renderMemoryWikiWatchImportSummary(result)}\n`);
  }

  return {
    ...result,
    stop,
  };
}
