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
const NOISE_THREAD_COMMANDS = new Set(["ps", "nvidia-smi", "bash", "zsh", "sh", "timeout", "tee"]);
const PREFERRED_THREAD_HINTS = [
  "openclaw",
  "node",
  "ollama",
  "llama",
  "llama-server",
  "llama.cpp",
  "python",
  "vllm",
  "sglang",
  "triton",
  "ray",
  "uvicorn",
];

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

export type HardwareThreadSample = {
  pid?: number;
  tid?: number;
  cpuPct?: number;
  command?: string;
  args?: string;
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
  topCpuThreads?: HardwareThreadSample[];
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

async function collectNvidiaGpuSamples(): Promise<HardwareGpuSample[] | undefined> {
  const rows = await collectNvidiaQueryCsv([
    "index",
    "name",
    "utilization.gpu",
    "utilization.memory",
    "memory.used",
    "memory.total",
    "power.draw",
    "clocks.sm",
    "clocks.mem",
    "clocks.max.mem",
    "memory.bus_width",
    "pcie.link.gen.current",
    "pcie.link.width.current",
    "temperature.gpu",
  ]);
  if (rows && rows.length > 0) {
    return rows.map(
      ([
        index,
        name,
        utilizationGpuPct,
        utilizationMemPct,
        memoryUsedMiB,
        memoryTotalMiB,
        powerDrawW,
        smClockMHz,
        memClockMHz,
        maxMemClockMHz,
        memoryBusWidthBits,
        pcieLinkGenCurrent,
        pcieLinkWidthCurrent,
        temperatureC,
      ]) =>
        finalizeGpuSample({
          index: toNumber(index),
          name,
          utilizationGpuPct: toNumber(utilizationGpuPct),
          utilizationMemPct: toNumber(utilizationMemPct),
          memoryUsedMiB: toNumber(memoryUsedMiB),
          memoryTotalMiB: toNumber(memoryTotalMiB),
          powerDrawW: toNumber(powerDrawW),
          smClockMHz: toNumber(smClockMHz),
          memClockMHz: toNumber(memClockMHz),
          maxMemClockMHz: toNumber(maxMemClockMHz),
          memoryBusWidthBits: toNumber(memoryBusWidthBits),
          pcieLinkGenCurrent: toNumber(pcieLinkGenCurrent),
          pcieLinkWidthCurrent: toNumber(pcieLinkWidthCurrent),
          temperatureC: toNumber(temperatureC),
        }),
    );
  }
  const base = await collectNvidiaGpuBaseSamples();
  const memory = await collectNvidiaGpuMemorySamples();
  const metadata = await collectNvidiaGpuMetadataSamples();
  const source = base ?? memory ?? metadata;
  if (!source) {
    return undefined;
  }
  const byIndex = new Map<number, Partial<HardwareGpuSample>>();
  for (const sample of [...(base ?? []), ...(memory ?? []), ...(metadata ?? [])]) {
    if (typeof sample.index !== "number" || !Number.isFinite(sample.index)) {
      continue;
    }
    byIndex.set(sample.index, { ...byIndex.get(sample.index), ...sample });
  }
  return [...byIndex.values()]
    .filter((sample): sample is HardwareGpuSample => typeof sample.index === "number")
    .toSorted((a, b) => (a.index ?? 0) - (b.index ?? 0))
    .map((sample) => finalizeGpuSample(sample));
}

function truncateText(value: string | undefined, maxChars: number): string | undefined {
  if (!value) {
    return undefined;
  }
  return value.length > maxChars ? `${value.slice(0, Math.max(0, maxChars - 1))}…` : value;
}

function isNoiseThreadSample(sample: HardwareThreadSample): boolean {
  const command = sample.command?.toLowerCase().trim() ?? "";
  const args = sample.args?.toLowerCase() ?? "";
  if (NOISE_THREAD_COMMANDS.has(command)) {
    return true;
  }
  return (
    args.includes("nvidia-smi --query-gpu") ||
    args.includes("ps -elo") ||
    args.includes("ps -eLo".toLowerCase())
  );
}

function isPreferredRuntimeThread(sample: HardwareThreadSample): boolean {
  const haystack = `${sample.command ?? ""} ${sample.args ?? ""}`.toLowerCase();
  return PREFERRED_THREAD_HINTS.some((hint) => haystack.includes(hint));
}

function resolveThreadSampleLimit(env: NodeJS.ProcessEnv = process.env): number {
  const parsed = Number(env.OPENCLAW_HARDWARE_TRACE_THREAD_LIMIT);
  if (Number.isFinite(parsed) && parsed >= 1 && parsed <= 64) {
    return Math.floor(parsed);
  }
  return 8;
}

async function collectTopCpuThreads(
  env: NodeJS.ProcessEnv = process.env,
): Promise<HardwareThreadSample[] | undefined> {
  if (process.platform !== "linux") {
    return undefined;
  }
  try {
    const limit = resolveThreadSampleLimit(env);
    const { stdout } = await execFileAsync(
      "ps",
      ["-eLo", "pid=,tid=,pcpu=,comm=,args=", "--sort=-pcpu"],
      { timeout: 700, maxBuffer: 1024 * 1024 },
    );
    const rows = stdout
      .trim()
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    const samples: HardwareThreadSample[] = [];
    for (const row of rows) {
      const match = row.match(/^(\d+)\s+(\d+)\s+([0-9.]+)\s+(\S+)\s*(.*)$/);
      if (!match) {
        continue;
      }
      const [, pid, tid, cpuPct, command, args] = match;
      const parsedCpuPct = toNumber(cpuPct);
      if (typeof parsedCpuPct !== "number" || !Number.isFinite(parsedCpuPct) || parsedCpuPct <= 0) {
        continue;
      }
      samples.push({
        pid: toNumber(pid),
        tid: toNumber(tid),
        cpuPct: parsedCpuPct,
        command: truncateText(command, 48),
        args: truncateText(args, 160),
      });
      if (samples.length >= limit) {
        break;
      }
    }
    const nonNoise = samples.filter((sample) => !isNoiseThreadSample(sample));
    const preferred = nonNoise.filter(isPreferredRuntimeThread);
    const ranked = [
      ...preferred,
      ...nonNoise.filter((sample) => !isPreferredRuntimeThread(sample)),
    ];
    return ranked.length > 0 ? ranked.slice(0, limit) : undefined;
  } catch {
    return undefined;
  }
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
  const [gpus, topCpuThreads] = await Promise.all([
    collectNvidiaGpuSamples(),
    collectTopCpuThreads(),
  ]);
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
    gpus,
    topCpuThreads,
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
