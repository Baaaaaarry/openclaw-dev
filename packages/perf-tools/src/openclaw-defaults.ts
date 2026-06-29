import path from "node:path";
import { resolveStateDir } from "../../../src/config/paths.js";

export function resolveDefaultPerfLogsDir(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(resolveStateDir(env), "logs");
}

export function resolveDefaultLatencyTraceFile(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(resolveDefaultPerfLogsDir(env), "latency-segments.jsonl");
}

export function resolveDefaultLatencyDashboardFile(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(resolveDefaultPerfLogsDir(env), "latency-dashboard.html");
}
