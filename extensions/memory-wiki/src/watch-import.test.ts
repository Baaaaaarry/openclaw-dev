import { EventEmitter } from "node:events";
import fs from "node:fs/promises";
import path from "node:path";
import type { FSWatcher } from "chokidar";
import { describe, expect, it, vi } from "vitest";
import { createMemoryWikiTestHarness } from "./test-helpers.js";
import { runMemoryWikiWatchImport, type WatchFactory } from "./watch-import.js";

const { createTempDir, createVault } = createMemoryWikiTestHarness();

function createMockWatcherFactory(emit: (emitter: EventEmitter) => void) {
  const close = vi.fn(async () => {});
  const watchFactoryImpl: WatchFactory = () => {
    const emitter = new EventEmitter();
    const watcher = Object.assign(emitter, {
      close,
    }) as unknown as Pick<FSWatcher, "on" | "close">;
    setImmediate(() => emit(emitter));
    return watcher;
  };
  const watchFactory = vi.fn(watchFactoryImpl) as unknown as WatchFactory;
  return { watchFactory, close };
}

describe("runMemoryWikiWatchImport", () => {
  it("imports supported files from the watched directory once", async () => {
    const rootDir = await createTempDir("memory-wiki-watch-");
    const watchDir = path.join(rootDir, "watched");
    await fs.mkdir(watchDir, { recursive: true });
    const inputPath = path.join(watchDir, "travel-policy.docx");
    await fs.writeFile(inputPath, Buffer.from(`PK_fake`, "utf8"));

    const { config } = await createVault({
      rootDir: path.join(rootDir, "vault"),
      initialize: true,
    });

    const zipBuffer = await (async () => {
      const JSZip = (await import("jszip")).default;
      const zip = new JSZip();
      zip.file(
        "word/document.xml",
        '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Travel policy</w:t></w:r></w:p><w:p><w:r><w:t>Flight invoice required</w:t></w:r></w:p></w:body></w:document>',
      );
      return Buffer.from(await zip.generateAsync({ type: "nodebuffer" }));
    })();
    await fs.writeFile(inputPath, zipBuffer);

    const { watchFactory, close } = createMockWatcherFactory((watcher) => {
      watcher.emit("add", inputPath);
      watcher.emit("ready");
    });

    const result = await runMemoryWikiWatchImport({
      config,
      watchPath: watchDir,
      once: true,
      watchFactory,
    });

    expect(result.imported).toBe(1);
    expect(result.failed).toBe(0);
    expect(result.importedFiles[0]?.pagePath).toBe("sources/travel-policy.md");
    await expect(
      fs.readFile(path.join(config.vault.path, "sources", "travel-policy.md"), "utf8"),
    ).resolves.toContain("Flight invoice required");
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("ignores files created inside managed wiki directories", async () => {
    const rootDir = await createTempDir("memory-wiki-watch-ignore-");
    const { config } = await createVault({
      rootDir: path.join(rootDir, "vault"),
      initialize: true,
    });
    const managedFile = path.join(config.vault.path, "sources", "alpha.md");
    await fs.writeFile(managedFile, "# should ignore\n", "utf8");

    const { watchFactory } = createMockWatcherFactory((watcher) => {
      watcher.emit("add", managedFile);
      watcher.emit("ready");
    });

    const result = await runMemoryWikiWatchImport({
      config,
      watchPath: config.vault.path,
      once: true,
      watchFactory,
    });

    expect(result.imported).toBe(0);
    expect(result.scanned).toBe(0);
  });
});
