import { DirectScenario } from "./scenarios/direct.ts";
import { IsolateRuntimeScenario } from "./scenarios/isolate-runtime.ts";
import { IsolateClientScenario } from "./scenarios/isolate-client.ts";
import { generatePayload } from "./utils/data-generator.ts";
import { printResults } from "./utils/reporter.ts";
import type { BenchmarkResult, BenchmarkScenario } from "./types.ts";

const PAYLOAD_SIZE = 20 * 1024 * 1024; // 20 MB
const WEBSOCKET_MESSAGES = 1000;

export async function runBenchmarks(): Promise<BenchmarkResult[]> {
  const payload = generatePayload(PAYLOAD_SIZE);
  const results: BenchmarkResult[] = [];

  const scenarios: BenchmarkScenario[] = [
    new DirectScenario(),
    new IsolateRuntimeScenario(),
    new IsolateClientScenario(),
  ];

  for (const scenario of scenarios) {
    console.log(`\nRunning scenario: ${scenario.name}...`);

    await scenario.setup();

    // File transfer benchmark
    const fileTransferMs = await scenario.runFileTransfer(payload);
    results.push({
      scenario: scenario.name,
      benchmark: "file-transfer",
      durationMs: fileTransferMs,
      throughputMBps: ((PAYLOAD_SIZE * 2) / 1024 / 1024) / (fileTransferMs / 1000),
    });

    // WebSocket benchmark
    const websocketMs = await scenario.runWebSocketPingPong(WEBSOCKET_MESSAGES);
    results.push({
      scenario: scenario.name,
      benchmark: "websocket-ping-pong",
      durationMs: websocketMs,
      messagesPerSecond: (WEBSOCKET_MESSAGES * 2) / (websocketMs / 1000),
    });

    await scenario.teardown();
  }

  return results;
}

// CLI entry point
const scriptPath = new URL(import.meta.url).pathname;
if (process.argv[1] === scriptPath || process.argv[1]?.endsWith("/index.ts")) {
  runBenchmarks()
    .then((results) => printResults(results, {
      payloadSizeMB: PAYLOAD_SIZE / 1024 / 1024,
      websocketMessages: WEBSOCKET_MESSAGES,
    }))
    .catch(console.error);
}
