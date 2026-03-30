import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { getQueuedFileWriter, type QueuedFileWriter } from "../agents/queued-file-writer.js";
import type { OpenClawConfig } from "../config/config.js";
import { resolveStateDir } from "../config/paths.js";
import { resolveUserPath } from "../utils.js";
import { parseBooleanValue } from "../utils/boolean.js";

const execFileAsync = promisify(execFile);
const writers = new Map<string, QueuedFileWriter>();
const DEFAULT_HARDWARE_TRACE_FILENAME = "hardware-trace.jsonl";
const DEFAULT_INTERVAL_MS = 1000;

type CpuSnapshot = {
  idle: number;
  total: number;
};

type HardwareTraceState = {
  filePath?: string;
  timer?: NodeJS.Timeout;
  inFlight?: boolean;
  lastCpu?: CpuSnapshot;
};

export type HardwareGpuSample = {
  index?: number;
  name?: string;
  utilizationGpuPct?: number;
  utilizationMemPct?: number;
  memoryUsedMiB?: number;
  memoryTotalMiB?: number;
  powerDrawW?: number;
  smClockMHz?: number;
  memClockMHz?: number;
  maxMemClockMHz?: number;
  memoryBusWidthBits?: number;
  memBandwidthPeakGBps?: number;
  memBandwidthEstimateGBps?: number;
  pcieLinkGenCurrent?: number;
  pcieLinkWidthCurrent?: number;
  temperatureC?: number;
};

export type HardwareTraceSample = {
  ts: string;
  epochMs: number;
  cpuUtilPct?: number;
  loadAvg1?: number;
  loadAvg5?: number;
  loadAvg15?: number;
  memTotalBytes: number;
  memFreeBytes: number;
  memUsedBytes: number;
  memUtilPct: number;
  gpus?: HardwareGpuSample[];
};

function getState(): HardwareTraceState {
  const globalStore = globalThis as typeof globalThis & {
    __openclawHardwareTraceState?: HardwareTraceState;
  };
  if (!globalStore.__openclawHardwareTraceState) {
    globalStore.__openclawHardwareTraceState = {};
  }
  return globalStore.__openclawHardwareTraceState;
}

function getWriter(filePath: string): QueuedFileWriter {
  return getQueuedFileWriter(writers, filePath);
}

function getCpuSnapshot(): CpuSnapshot {
  const cpus = os.cpus();
  let idle = 0;
  let total = 0;
  for (const cpu of cpus) {
    idle += cpu.times.idle;
    total += cpu.times.user + cpu.times.nice + cpu.times.sys + cpu.times.idle + cpu.times.irq;
  }
  return { idle, total };
}

function computeCpuUtilPct(prev: CpuSnapshot | undefined, next: CpuSnapshot): number | undefined {
  if (!prev) {
    return undefined;
  }
  const idleDelta = next.idle - prev.idle;
  const totalDelta = next.total - prev.total;
  if (!(totalDelta > 0)) {
    return undefined;
  }
  const busy = totalDelta - idleDelta;
  return Math.max(0, Math.min(100, (busy / totalDelta) * 100));
}

function toNumber(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = Number(value.trim());
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseValueNumber(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }
  const match = value.match(/-?\d+(?:\.\d+)?/);
  return match ? toNumber(match[0]) : undefined;
}

function mergeGpuSampleLists(
  ...lists: Array<Array<Partial<HardwareGpuSample>> | undefined>
): HardwareGpuSample[] | undefined {
  const merged = new Map<number, HardwareGpuSample>();
  for (const list of lists) {
    for (const partial of list ?? []) {
      const index = partial.index;
      if (typeof index !== "number" || !Number.isFinite(index)) {
        continue;
      }
      const current = merged.get(index) ?? ({ index } satisfies HardwareGpuSample);
      merged.set(index, { ...current, ...partial });
    }
  }
  if (merged.size === 0) {
    return undefined;
  }
  return [...merged.values()]
    .toSorted((a, b) => (a.index ?? 0) - (b.index ?? 0))
    .map((gpu) => finalizeGpuSample(gpu));
}

function finalizeGpuSample(sample: HardwareGpuSample): HardwareGpuSample {
  const memoryBusWidth = sample.memoryBusWidthBits;
  const maxMemClock = sample.maxMemClockMHz;
  const memClock = sample.memClockMHz;
  const memUtil = sample.utilizationMemPct;
  const memBandwidthPeakGBps =
    typeof maxMemClock === "number" &&
    Number.isFinite(maxMemClock) &&
    maxMemClock > 0 &&
    typeof memoryBusWidth === "number" &&
    Number.isFinite(memoryBusWidth) &&
    memoryBusWidth > 0
      ? (maxMemClock * (memoryBusWidth / 8) * 2) / 1000
      : sample.memBandwidthPeakGBps;
  const memBandwidthCurrentCapGBps =
    typeof memClock === "number" &&
    Number.isFinite(memClock) &&
    memClock > 0 &&
    typeof memoryBusWidth === "number" &&
    Number.isFinite(memoryBusWidth) &&
    memoryBusWidth > 0
      ? (memClock * (memoryBusWidth / 8) * 2) / 1000
      : undefined;
  const memBandwidthEstimateGBps =
    typeof memUtil === "number" &&
    Number.isFinite(memUtil) &&
    memUtil >= 0 &&
    typeof memBandwidthCurrentCapGBps === "number" &&
    Number.isFinite(memBandwidthCurrentCapGBps)
      ? (memUtil / 100) * memBandwidthCurrentCapGBps
      : sample.memBandwidthEstimateGBps;
  return {
    ...sample,
    memBandwidthPeakGBps,
    memBandwidthEstimateGBps,
  };
}

async function collectNvidiaQueryCsv(fields: string[]): Promise<string[][] | undefined> {
  try {
    const { stdout } = await execFileAsync(
      "nvidia-smi",
      [`--query-gpu=${fields.join(",")}`, "--format=csv,noheader,nounits"],
      { timeout: 800, maxBuffer: 1024 * 1024 },
    );
    const rows = stdout
      .trim()
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((row) => row.split(",").map((value) => value.trim()));
    return rows.length > 0 ? rows : undefined;
  } catch {
    return undefined;
  }
}

async function collectNvidiaGpuBaseSamples(): Promise<Partial<HardwareGpuSample>[] | undefined> {
  const rows = await collectNvidiaQueryCsv([
    "index",
    "name",
    "utilization.gpu",
    "power.draw",
    "clocks.sm",
    "temperature.gpu",
  ]);
  return rows?.map(([index, name, utilizationGpuPct, powerDrawW, smClockMHz, temperatureC]) => ({
    index: toNumber(index),
    name,
    utilizationGpuPct: toNumber(utilizationGpuPct),
    powerDrawW: toNumber(powerDrawW),
    smClockMHz: toNumber(smClockMHz),
    temperatureC: toNumber(temperatureC),
  }));
}

async function collectNvidiaGpuMemorySamples(): Promise<Partial<HardwareGpuSample>[] | undefined> {
  const rows = await collectNvidiaQueryCsv([
    "index",
    "utilization.memory",
    "memory.used",
    "memory.total",
    "clocks.mem",
  ]);
  return rows?.map(([index, utilizationMemPct, memoryUsedMiB, memoryTotalMiB, memClockMHz]) => ({
    index: toNumber(index),
    utilizationMemPct: toNumber(utilizationMemPct),
    memoryUsedMiB: toNumber(memoryUsedMiB),
    memoryTotalMiB: toNumber(memoryTotalMiB),
    memClockMHz: toNumber(memClockMHz),
  }));
}

async function collectNvidiaGpuMetadataSamples(): Promise<
  Partial<HardwareGpuSample>[] | undefined
> {
  const rows = await collectNvidiaQueryCsv([
    "index",
    "clocks.max.mem",
    "memory.bus_width",
    "pcie.link.gen.current",
    "pcie.link.width.current",
  ]);
  return rows?.map(
    ([index, maxMemClockMHz, memoryBusWidthBits, pcieLinkGenCurrent, pcieLinkWidthCurrent]) => ({
      index: toNumber(index),
      maxMemClockMHz: toNumber(maxMemClockMHz),
      memoryBusWidthBits: toNumber(memoryBusWidthBits),
      pcieLinkGenCurrent: toNumber(pcieLinkGenCurrent),
      pcieLinkWidthCurrent: toNumber(pcieLinkWidthCurrent),
    }),
  );
}

function extractXmlTag(section: string, tag: string): string | undefined {
  const match = section.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return match?.[1]?.trim();
}

function extractXmlSection(section: string, tag: string): string | undefined {
  return extractXmlTag(section, tag);
}

async function collectNvidiaGpuXmlSamples(): Promise<Partial<HardwareGpuSample>[] | undefined> {
  try {
    const { stdout } = await execFileAsync("nvidia-smi", ["-q", "-x"], {
      timeout: 1200,
      maxBuffer: 4 * 1024 * 1024,
    });
    const sections = [...stdout.matchAll(/<gpu(?:\s+id="[^"]*")?>([\s\S]*?)<\/gpu>/gi)].map(
      (match) => match[1],
    );
    if (sections.length === 0) {
      return undefined;
    }
    return sections.map((section, index) => {
      const utilizationSection = extractXmlSection(section, "utilization") ?? section;
      const fbMemorySection = extractXmlSection(section, "fb_memory_usage") ?? section;
      const clocksSection = extractXmlSection(section, "clocks") ?? section;
      const maxClocksSection = extractXmlSection(section, "max_clocks") ?? section;
      const pciSection = extractXmlSection(section, "pci") ?? section;
      const tempSection = extractXmlSection(section, "temperature") ?? section;
      return {
        index,
        name: extractXmlTag(section, "product_name"),
        utilizationGpuPct: parseValueNumber(extractXmlTag(utilizationSection, "gpu_util")),
        utilizationMemPct: parseValueNumber(extractXmlTag(utilizationSection, "memory_util")),
        memoryUsedMiB: parseValueNumber(extractXmlTag(fbMemorySection, "used")),
        memoryTotalMiB: parseValueNumber(extractXmlTag(fbMemorySection, "total")),
        powerDrawW: parseValueNumber(extractXmlTag(section, "power_draw")),
        smClockMHz: parseValueNumber(extractXmlTag(clocksSection, "sm_clock")),
        memClockMHz: parseValueNumber(extractXmlTag(clocksSection, "mem_clock")),
        maxMemClockMHz:
          parseValueNumber(extractXmlTag(maxClocksSection, "mem_clock")) ??
          parseValueNumber(extractXmlTag(section, "max_mem_clock")),
        memoryBusWidthBits: parseValueNumber(extractXmlTag(section, "memory_bus_width")),
        pcieLinkGenCurrent:
          parseValueNumber(extractXmlTag(pciSection, "current_link_gen")) ??
          parseValueNumber(extractXmlTag(pciSection, "link_gen")),
        pcieLinkWidthCurrent:
          parseValueNumber(extractXmlTag(pciSection, "current_link_width")) ??
          parseValueNumber(extractXmlTag(pciSection, "link_width")),
        temperatureC: parseValueNumber(extractXmlTag(tempSection, "gpu_temp")),
      } satisfies Partial<HardwareGpuSample>;
    });
  } catch {
    return undefined;
  }
}

async function collectNvidiaGpuSamples(): Promise<HardwareGpuSample[] | undefined> {
  return mergeGpuSampleLists(
    await collectNvidiaGpuBaseSamples(),
    await collectNvidiaGpuMemorySamples(),
    await collectNvidiaGpuMetadataSamples(),
    await collectNvidiaGpuXmlSamples(),
  );
}

async function collectHardwareSample(state: HardwareTraceState): Promise<HardwareTraceSample> {
  const epochMs = Date.now();
  const cpuSnapshot = getCpuSnapshot();
  const cpuUtilPct = computeCpuUtilPct(state.lastCpu, cpuSnapshot);
  state.lastCpu = cpuSnapshot;
  const [loadAvg1, loadAvg5, loadAvg15] = os.loadavg();
  const memTotalBytes = os.totalmem();
  const memFreeBytes = os.freemem();
  const memUsedBytes = Math.max(0, memTotalBytes - memFreeBytes);
  return {
    ts: new Date(epochMs).toISOString(),
    epochMs,
    cpuUtilPct,
    loadAvg1,
    loadAvg5,
    loadAvg15,
    memTotalBytes,
    memFreeBytes,
    memUsedBytes,
    memUtilPct: memTotalBytes > 0 ? (memUsedBytes / memTotalBytes) * 100 : 0,
    gpus: await collectNvidiaGpuSamples(),
  };
}

function writeSample(writer: QueuedFileWriter, sample: HardwareTraceSample): void {
  writer.write(`${JSON.stringify(sample)}\n`);
}

function scheduleSampling(
  state: HardwareTraceState,
  writer: QueuedFileWriter,
  intervalMs: number,
): void {
  const tick = async () => {
    if (state.inFlight) {
      return;
    }
    state.inFlight = true;
    try {
      const sample = await collectHardwareSample(state);
      writeSample(writer, sample);
    } finally {
      state.inFlight = false;
    }
  };
  void tick();
  state.timer = setInterval(() => {
    void tick();
  }, intervalMs);
  state.timer.unref?.();
}

export function resolveHardwareTraceFilePath(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.OPENCLAW_HARDWARE_TRACE_FILE?.trim();
  if (override) {
    const resolved = resolveUserPath(override);
    const normalized = resolved.replace(/[/\\]+$/, "");
    try {
      if (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()) {
        return path.join(resolved, DEFAULT_HARDWARE_TRACE_FILENAME);
      }
    } catch {
      // ignore
    }
    try {
      if (
        normalized !== resolved &&
        fs.existsSync(normalized) &&
        fs.statSync(normalized).isDirectory()
      ) {
        return path.join(normalized, DEFAULT_HARDWARE_TRACE_FILENAME);
      }
    } catch {
      // ignore
    }
    return resolved;
  }
  return path.join(resolveStateDir(env), "logs", DEFAULT_HARDWARE_TRACE_FILENAME);
}

export function isHardwareTraceEnabled(
  _cfg?: OpenClawConfig,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return parseBooleanValue(env.OPENCLAW_HARDWARE_TRACE) ?? false;
}

function resolveIntervalMs(env: NodeJS.ProcessEnv = process.env): number {
  const parsed = Number(env.OPENCLAW_HARDWARE_TRACE_INTERVAL_MS);
  if (Number.isFinite(parsed) && parsed >= 200) {
    return Math.floor(parsed);
  }
  return DEFAULT_INTERVAL_MS;
}

export function startHardwareTrace(
  cfg?: OpenClawConfig,
  env: NodeJS.ProcessEnv = process.env,
): void {
  if (!isHardwareTraceEnabled(cfg, env)) {
    return;
  }
  const state = getState();
  const filePath = resolveHardwareTraceFilePath(env);
  if (state.timer && state.filePath === filePath) {
    return;
  }
  if (state.timer) {
    clearInterval(state.timer);
  }
  state.filePath = filePath;
  state.lastCpu = undefined;
  const writer = getWriter(filePath);
  scheduleSampling(state, writer, resolveIntervalMs(env));
}

export function stopHardwareTrace(): void {
  const state = getState();
  if (state.timer) {
    clearInterval(state.timer);
  }
  state.timer = undefined;
  state.inFlight = false;
  state.lastCpu = undefined;
  state.filePath = undefined;
}

export function parseHardwareTraceJsonl(content: string): HardwareTraceSample[] {
  return content
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line) as HardwareTraceSample;
      } catch {
        return null;
      }
    })
    .filter((entry): entry is HardwareTraceSample => Boolean(entry));
}

export function readHardwareTraceJsonl(file: string): HardwareTraceSample[] {
  if (!fs.existsSync(file)) {
    return [];
  }
  return parseHardwareTraceJsonl(fs.readFileSync(file, "utf8"));
}
