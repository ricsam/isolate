export interface BenchmarkResult {
  scenario: string;
  benchmark: string;
  durationMs: number;
  throughputMBps?: number;
  messagesPerSecond?: number;
}

export interface BenchmarkScenario {
  name: string;
  setup(): Promise<void>;
  teardown(): Promise<void>;
  runFileTransfer(payload: Uint8Array): Promise<number>;
  runWebSocketPingPong(count: number): Promise<number>;
}
