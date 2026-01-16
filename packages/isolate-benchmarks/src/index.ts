import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { DirectScenario } from "./scenarios/direct.ts";
import { IsolateRuntimeScenario } from "./scenarios/isolate-runtime.ts";
import { IsolateClientScenario } from "./scenarios/isolate-client.ts";
import { generatePayload } from "./utils/data-generator.ts";
import { printResults } from "./utils/reporter.ts";
import type { BenchmarkResult, BenchmarkScenario } from "./types.ts";

const PAYLOAD_SIZE = 20 * 1024 * 1024; // 20 MB
const WEBSOCKET_MESSAGES = 10000;

const __dirname = dirname(fileURLToPath(import.meta.url));
const BASELINE_PATH = join(__dirname, "..", "baseline.json");

export interface BaselineData {
  timestamp: string;
  payloadSize: number;
  websocketMessages: number;
  results: BenchmarkResult[];
}

export function loadBaseline(): BaselineData | null {
  if (!existsSync(BASELINE_PATH)) {
    return null;
  }
  try {
    const data = readFileSync(BASELINE_PATH, "utf-8");
    return JSON.parse(data) as BaselineData;
  } catch {
    return null;
  }
}

export function saveBaseline(results: BenchmarkResult[]): void {
  const data: BaselineData = {
    timestamp: new Date().toISOString(),
    payloadSize: PAYLOAD_SIZE,
    websocketMessages: WEBSOCKET_MESSAGES,
    results,
  };
  writeFileSync(BASELINE_PATH, JSON.stringify(data, null, 2) + "\n");
  console.log(`\nBaseline saved to ${BASELINE_PATH}`);
}

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
  const shouldSave = process.argv.includes("--save");
  const baseline = loadBaseline();

  runBenchmarks()
    .then((results) => {
      printResults(results, {
        payloadSizeMB: PAYLOAD_SIZE / 1024 / 1024,
        websocketMessages: WEBSOCKET_MESSAGES,
        baseline: baseline?.results ?? null,
      });

      if (shouldSave) {
        saveBaseline(results);
      }
    })
    .catch(console.error);
}
