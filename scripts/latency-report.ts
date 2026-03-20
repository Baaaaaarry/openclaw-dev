import path from "node:path";
import { resolveStateDir } from "../src/config/paths.js";
import { readHardwareTraceJsonl } from "../src/infra/hardware-trace.js";
import {
  filterLastRecords,
  formatLatencyReportText,
  readLatencyTraceJsonl,
  summarizeLatencyRecords,
} from "../src/infra/latency-trace-report.js";

type Options = {
  file: string;
  hardwareFile?: string;
  last?: number;
  json: boolean;
};

function parseArgs(argv: string[]): Options {
  const options: Options = {
    file: path.join(resolveStateDir(process.env), "logs", "latency-segments.jsonl"),
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

function main(): void {
  const options = parseArgs(process.argv.slice(2));
  const records = filterLastRecords(readLatencyTraceJsonl(options.file), options.last);
  const hardwareSamples = options.hardwareFile
    ? readHardwareTraceJsonl(options.hardwareFile)
    : undefined;
  const report = summarizeLatencyRecords(records, hardwareSamples);
  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  console.log(formatLatencyReportText(report));
}

main();
