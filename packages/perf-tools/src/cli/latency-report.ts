import { resolveDefaultLatencyTraceFile } from "../openclaw-defaults.js";
import {
  filterLastRecords,
  formatLatencyReportText,
  readLatencyTraceJsonl,
  summarizeLatencyRecords,
} from "../report/latency-trace-report.js";
import { readHardwareTraceJsonl } from "../runtime/hardware-trace.js";

export type LatencyReportCliOptions = {
  file: string;
  hardwareFile?: string;
  last?: number;
  json: boolean;
};

export function parseLatencyReportCliArgs(argv: string[]): LatencyReportCliOptions {
  const options: LatencyReportCliOptions = {
    file: resolveDefaultLatencyTraceFile(process.env),
    json: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--file" && argv[index + 1]) {
      options.file = argv[index + 1]!;
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
    if (arg === "--hardware-file" && argv[index + 1]) {
      options.hardwareFile = argv[index + 1]!;
      index += 1;
      continue;
    }
    if (arg === "--json") {
      options.json = true;
    }
  }
  return options;
}

export function runLatencyReportCli(argv: string[] = process.argv.slice(2)): string {
  const options = parseLatencyReportCliArgs(argv);
  const records = filterLastRecords(readLatencyTraceJsonl(options.file), options.last);
  const hardwareSamples = options.hardwareFile
    ? readHardwareTraceJsonl(options.hardwareFile)
    : undefined;
  const report = summarizeLatencyRecords(records, hardwareSamples);
  if (options.json) {
    return JSON.stringify(report, null, 2);
  }
  return formatLatencyReportText(report);
}

export function main(argv: string[] = process.argv.slice(2)): void {
  console.log(runLatencyReportCli(argv));
}
