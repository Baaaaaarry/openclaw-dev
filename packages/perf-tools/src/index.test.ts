import { describe, expect, it } from "vitest";
import {
  parseLatencyReportCliArgs,
  parseLatencyVisualizeCliArgs,
  resolveDefaultLatencyDashboardFile,
  resolveDefaultLatencyTraceFile,
  summarizeLatencyRecords,
} from "./index.js";

describe("@openclaw/perf-tools", () => {
  it("exports report and cli helpers", () => {
    expect(typeof summarizeLatencyRecords).toBe("function");
    expect(typeof parseLatencyReportCliArgs).toBe("function");
    expect(typeof parseLatencyVisualizeCliArgs).toBe("function");
  });

  it("parses report cli arguments", () => {
    expect(
      parseLatencyReportCliArgs([
        "--file",
        "/tmp/latency.jsonl",
        "--hardware-file",
        "/tmp/hw.jsonl",
        "--last",
        "5",
        "--json",
      ]),
    ).toEqual({
      file: "/tmp/latency.jsonl",
      hardwareFile: "/tmp/hw.jsonl",
      last: 5,
      json: true,
    });
  });

  it("parses visualize cli arguments", () => {
    expect(
      parseLatencyVisualizeCliArgs([
        "--file",
        "/tmp/latency.jsonl",
        "--hardware-file",
        "/tmp/hw.jsonl",
        "--out",
        "/tmp/out.html",
        "--last",
        "8",
        "--avg",
      ]),
    ).toEqual({
      file: "/tmp/latency.jsonl",
      hardwareFile: "/tmp/hw.jsonl",
      out: "/tmp/out.html",
      last: 8,
      avg: true,
    });
  });

  it("keeps default output paths under the logs directory", () => {
    expect(resolveDefaultLatencyTraceFile({ HOME: "/tmp/home" } as NodeJS.ProcessEnv)).toContain(
      "latency-segments.jsonl",
    );
    expect(
      resolveDefaultLatencyDashboardFile({ HOME: "/tmp/home" } as NodeJS.ProcessEnv),
    ).toContain("latency-dashboard.html");
  });
});
