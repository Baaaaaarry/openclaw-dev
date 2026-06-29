# `@openclaw/perf-tools`

Reusable latency tracing, hardware sampling, report summarization, and HTML visualization code extracted from the OpenClaw performance analysis work.

## Contents

- `src/runtime`
  - latency trace types
  - diagnostic latency event schema
  - JSONL persistence helpers
  - CPU / GPU hardware sampler
- `src/report`
  - latency record reader
  - T1-T6 summarization
  - T5 load / prefill / decode correlation
  - RAG / LLM hardware window analysis
  - HTML dashboard rendering
- `src/cli`
  - `latency-report`
  - `latency-visualize`

## Reuse Model

This package is organized as a standalone workspace package so other projects can either:

1. import it directly inside the monorepo; or
2. copy `packages/perf-tools` into another repository and replace the small OpenClaw-specific adapters listed below.

## OpenClaw-Specific Adapters

These files still depend on OpenClaw runtime helpers and are the only places you normally need to adapt when reusing the package elsewhere:

- `src/openclaw-defaults.ts`
  - resolves the default `state/logs` directory
- `src/runtime/hardware-trace.ts`
  - uses OpenClaw queued file writing and config/path helpers
- `src/runtime/latency-trace-persist.ts`
  - uses OpenClaw path helpers and the diagnostic event bus

The report and visualization layers are already file-oriented and can be reused with plain JSONL inputs.

## Current Entry Points

- `src/index.ts`
- `src/runtime/index.ts`
- `src/report/index.ts`
- `src/cli/latency-report.ts`
- `src/cli/latency-visualize.ts`

## Compatibility

OpenClaw keeps the legacy imports under `src/infra/*` and `scripts/latency-*` as thin compatibility wrappers, so existing runtime code and operational commands do not need to change.
