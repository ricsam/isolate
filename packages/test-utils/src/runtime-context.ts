import type ivm from "isolated-vm";
import { MockFileSystem } from "./mock-fs.ts";

export interface MockResponse {
  status?: number;
  body?: string;
  headers?: Record<string, string>;
}

export interface RuntimeTestContextOptions {
  /** Enable file system APIs with mock file system */
  fs?: boolean;
}

export interface RuntimeTestContext {
  isolate: ivm.Isolate;
  context: ivm.Context;
  /** Advance virtual time and process pending timers */
  tick(ms?: number): Promise<void>;
  dispose(): void;
  /** Captured console.log calls */
  logs: Array<{ level: string; args: unknown[] }>;
  /** Captured fetch calls */
  fetchCalls: Array<{ url: string; method: string; headers: [string, string][] }>;
  /** Set the mock response for the next fetch call */
  setMockResponse(response: MockResponse): void;
  /** Mock file system (only available if fs option is true) */
  mockFs: MockFileSystem;
}

/**
 * Create a full runtime test context with all APIs set up.
 * Includes console logging capture, fetch mocking, and optionally file system.
 *
 * @example
 * const ctx = await createRuntimeTestContext({ fs: true });
 *
 * // Set up mock response for fetch
 * ctx.setMockResponse({ status: 200, body: '{"data": "test"}' });
 *
 * // Run code
 * await ctx.context.eval(`
 *   (async () => {
 *     console.log("Starting fetch...");
 *     const response = await fetch("https://api.example.com/data");
 *     const data = await response.json();
 *     console.log("Got data:", data);
 *   })()
 * `, { promise: true });
 *
 * // Check logs
 * console.log(ctx.logs); // [{ level: "log", args: ["Starting fetch..."] }, ...]
 *
 * // Check fetch calls
 * console.log(ctx.fetchCalls); // [{ url: "https://api.example.com/data", method: "GET", ... }]
 *
 * ctx.dispose();
 */
export async function createRuntimeTestContext(
  options?: RuntimeTestContextOptions
): Promise<RuntimeTestContext> {
  const opts = options ?? {};
  const { createRuntime } = await import("@ricsam/isolate-runtime");
  const { clearAllInstanceState } = await import("@ricsam/isolate-core");

  // Clear any previous instance state
  clearAllInstanceState();

  // State for capturing logs and fetch calls
  const logs: Array<{ level: string; args: unknown[] }> = [];
  const fetchCalls: Array<{
    url: string;
    method: string;
    headers: [string, string][];
  }> = [];

  let mockResponse: MockResponse = { status: 200, body: "" };

  // Create mock file system
  const mockFs = new MockFileSystem();

  // Create runtime with configured handlers
  const runtime = await createRuntime({
    console: {
      onLog: (level: string, ...args: unknown[]) => {
        logs.push({ level, args });
      },
    },
    fetch: {
      onFetch: async (request: Request) => {
        // Capture fetch call
        fetchCalls.push({
          url: request.url,
          method: request.method,
          headers: [...request.headers.entries()],
        });

        // Return mock response
        return new Response(mockResponse.body ?? "", {
          status: mockResponse.status ?? 200,
          headers: mockResponse.headers,
        });
      },
    },
    fs: opts.fs ? { getDirectory: async () => mockFs } : undefined,
  });

  return {
    isolate: runtime.isolate,
    context: runtime.context,
    tick: runtime.tick.bind(runtime),
    dispose: runtime.dispose.bind(runtime),
    logs,
    fetchCalls,
    setMockResponse(response: MockResponse) {
      mockResponse = response;
    },
    mockFs,
  };
}
