import fs from "node:fs";
import path from "node:path";
import {
  resolveDefaultLatencyDashboardFile,
  resolveDefaultLatencyTraceFile,
} from "../openclaw-defaults.js";
import {
  filterLastRecords,
  readLatencyTraceJsonl,
  summarizeLatencyRecords,
} from "../report/latency-trace-report.js";
import { renderLatencyReportHtml } from "../report/latency-trace-visualize.js";
import { readHardwareTraceJsonl } from "../runtime/hardware-trace.js";

export type LatencyVisualizeCliOptions = {
  file: string;
  hardwareFile?: string;
  out: string;
  last?: number;
  avg: boolean;
};

export function parseLatencyVisualizeCliArgs(argv: string[]): LatencyVisualizeCliOptions {
  const options: LatencyVisualizeCliOptions = {
    file: resolveDefaultLatencyTraceFile(process.env),
    out: resolveDefaultLatencyDashboardFile(process.env),
    avg: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--file" && argv[index + 1]) {
      options.file = argv[index + 1]!;
      index += 1;
      continue;
    }
    if (arg === "--hardware-file" && argv[index + 1]) {
      options.hardwareFile = argv[index + 1]!;
      index += 1;
      continue;
    }
    if (arg === "--out" && argv[index + 1]) {
      options.out = argv[index + 1]!;
      index += 1;
      continue;
    }
    if (arg === "--last" && argv[index + 1]) {
      const parsed = Number(argv[index + 1]);
      if (Number.isFinite(parsed) && parsed > 0) {
        options.last = Math.floor(parsed);
      }
      index += 1;
      continue;
    }
    if (arg === "--avg") {
      options.avg = true;
    }
  }
  return options;
}

export function renderLatencyDashboard(argv: string[] = process.argv.slice(2)): {
  out: string;
  html: string;
} {
  const options = parseLatencyVisualizeCliArgs(argv);
  const records = filterLastRecords(readLatencyTraceJsonl(options.file), options.last);
  const hardwareSamples = options.hardwareFile
    ? readHardwareTraceJsonl(options.hardwareFile)
    : undefined;
  const report = summarizeLatencyRecords(records, hardwareSamples);
  const html = renderLatencyReportHtml({
    report,
    hardwareSamples,
    avgMode: options.avg,
  });
  return { out: options.out, html };
}

export function main(argv: string[] = process.argv.slice(2)): void {
  const { out, html } = renderLatencyDashboard(argv);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, html, "utf8");
  console.log(out);
}
