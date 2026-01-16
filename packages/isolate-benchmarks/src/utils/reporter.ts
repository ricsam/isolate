import type { BenchmarkResult } from "../types.ts";

export interface ReporterOptions {
  payloadSizeMB: number;
  websocketMessages: number;
  baseline: BenchmarkResult[] | null;
}

function formatDiff(current: number, baseline: number | undefined): string {
  if (baseline === undefined || baseline <= 0) return "";
  const diff = ((current - baseline) / baseline) * 100;
  const sign = diff > 0 ? "+" : "";
  return ` (${sign}${diff.toFixed(1)}%)`;
}

function getBaselineValue(
  baseline: BenchmarkResult[] | null,
  scenario: string,
  benchmark: string
): number | undefined {
  if (!baseline) return undefined;
  const match = baseline.find(
    (r) => r.scenario === scenario && r.benchmark === benchmark
  );
  return match?.durationMs;
}

export function printResults(results: BenchmarkResult[], options: ReporterOptions): void {
  const fileTransfer = results.filter((r) => r.benchmark === "file-transfer");
  const websocket = results.filter((r) => r.benchmark === "websocket-ping-pong");

  if (options.baseline) {
    console.log("\n(Comparing against saved baseline)");
  }

  console.log(`\n=== File Transfer (${options.payloadSizeMB} MB upload + download) ===\n`);
  console.table(
    fileTransfer.map((r) => {
      const baselineMs = getBaselineValue(options.baseline, r.scenario, r.benchmark);
      return {
        Scenario: r.scenario,
        "Duration (ms)": r.durationMs.toFixed(2) + formatDiff(r.durationMs, baselineMs),
        "Throughput (MB/s)": r.throughputMBps?.toFixed(2) ?? "N/A",
      };
    })
  );

  console.log(`\n=== WebSocket Ping/Pong (${options.websocketMessages} roundtrips) ===\n`);
  console.table(
    websocket.map((r) => {
      const baselineMs = getBaselineValue(options.baseline, r.scenario, r.benchmark);
      return {
        Scenario: r.scenario,
        "Duration (ms)": r.durationMs < 0
          ? "SKIPPED"
          : r.durationMs.toFixed(2) + formatDiff(r.durationMs, baselineMs),
        "Messages/sec": r.durationMs < 0 ? "N/A" : (r.messagesPerSecond?.toFixed(0) ?? "N/A"),
      };
    })
  );
}
