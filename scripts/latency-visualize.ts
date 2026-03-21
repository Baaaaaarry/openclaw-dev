import fs from "node:fs";
import path from "node:path";
import { resolveStateDir } from "../src/config/paths.js";
import { readHardwareTraceJsonl } from "../src/infra/hardware-trace.js";
import {
  filterLastRecords,
  readLatencyTraceJsonl,
  summarizeLatencyRecords,
} from "../src/infra/latency-trace-report.js";
import { renderLatencyReportHtml } from "../src/infra/latency-trace-visualize.js";

type Options = {
  file: string;
  hardwareFile?: string;
  out: string;
  last?: number;
};

function parseArgs(argv: string[]): Options {
  const defaultLogsDir = path.join(resolveStateDir(process.env), "logs");
  const options: Options = {
    file: path.join(defaultLogsDir, "latency-segments.jsonl"),
    out: path.join(defaultLogsDir, "latency-dashboard.html"),
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
    }
  }
  return options;
}

function main(): void {
  const options = parseArgs(process.argv.slice(2));
  const records = filterLastRecords(readLatencyTraceJsonl(options.file), options.last);
  const hardwareSamples = options.hardwareFile
    ? readHardwareTraceJsonl(options.hardwareFile)
    : undefined;
  const report = summarizeLatencyRecords(records, hardwareSamples);
  const html = renderLatencyReportHtml(report);
  fs.mkdirSync(path.dirname(options.out), { recursive: true });
  fs.writeFileSync(options.out, html, "utf8");
  console.log(options.out);
}

main();
