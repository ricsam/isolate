import type { BenchmarkResult } from "../types.ts";

export interface ReporterOptions {
  payloadSizeMB: number;
  websocketMessages: number;
}

export function printResults(results: BenchmarkResult[], options: ReporterOptions): void {
  const fileTransfer = results.filter((r) => r.benchmark === "file-transfer");
  const websocket = results.filter((r) => r.benchmark === "websocket-ping-pong");

  console.log(`\n=== File Transfer (${options.payloadSizeMB} MB upload + download) ===\n`);
  console.table(
    fileTransfer.map((r) => ({
      Scenario: r.scenario,
      "Duration (ms)": r.durationMs.toFixed(2),
      "Throughput (MB/s)": r.throughputMBps?.toFixed(2) ?? "N/A",
    }))
  );

  console.log(`\n=== WebSocket Ping/Pong (${options.websocketMessages} roundtrips) ===\n`);
  console.table(
    websocket.map((r) => ({
      Scenario: r.scenario,
      "Duration (ms)": r.durationMs < 0 ? "SKIPPED" : r.durationMs.toFixed(2),
      "Messages/sec": r.durationMs < 0 ? "N/A" : (r.messagesPerSecond?.toFixed(0) ?? "N/A"),
    }))
  );
}
