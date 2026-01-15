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
  /** Execute code in the runtime (ES module mode, supports top-level await) */
  eval(code: string): Promise<void>;
  /** Clear all pending timers */
  clearTimers(): void;
  /** Dispatch an HTTP request to the serve() handler */
  dispatchRequest(request: Request): Promise<Response>;
  /** Dispose all resources */
  dispose(): Promise<void>;
  /** Captured console.log calls */
  logs: Array<{ level: string; args: unknown[] }>;
  /** Captured fetch calls */
  fetchCalls: Array<{ url: string; method: string; headers: [string, string][] }>;
  /** Set the mock response for the next fetch call */
  setMockResponse(response: MockResponse): void;
  /** Mock file system (only available if fs option is true) */
  mockFs: MockFileSystem;
  /**
   * Get a result from the isolate. Call `await setResult(value)` in your eval code
   * to pass a value back to the host.
   */
  getResult<T = unknown>(): T | undefined;
  /** Clear the stored result */
  clearResult(): void;
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
 * // Run code and pass result back via setResult
 * await ctx.eval(`
 *   console.log("Starting fetch...");
 *   const response = await fetch("https://api.example.com/data");
 *   const data = await response.json();
 *   console.log("Got data:", data);
 *   setResult(data);
 * `);
 *
 * // Get the result
 * console.log(ctx.getResult()); // { data: "test" }
 *
 * // Check logs
 * console.log(ctx.logs); // [{ level: "log", args: ["Starting fetch..."] }, ...]
 *
 * // Check fetch calls
 * console.log(ctx.fetchCalls); // [{ url: "https://api.example.com/data", method: "GET", ... }]
 *
 * await ctx.dispose();
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
  let storedResult: unknown = undefined;

  // Create mock file system
  const mockFs = new MockFileSystem();

  // Create runtime with configured handlers
  const runtime = await createRuntime({
    console: {
      onEntry: (entry) => {
        if (entry.type === "output") {
          logs.push({ level: entry.level, args: entry.args });
        } else if (entry.type === "assert") {
          logs.push({ level: "error", args: ["Assertion failed:", ...entry.args] });
        }
      },
    },
    fetch: async (request: Request) => {
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
    fs: opts.fs ? { getDirectory: async () => mockFs } : undefined,
    customFunctions: {
      setResult: {
        fn: (value: unknown) => {
          storedResult = value;
        },
        async: false,
      },
    },
  });

  return {
    eval: runtime.eval.bind(runtime),
    clearTimers: runtime.timers.clearAll.bind(runtime.timers),
    dispatchRequest: runtime.fetch.dispatchRequest.bind(runtime.fetch),
    dispose: runtime.dispose.bind(runtime),
    logs,
    fetchCalls,
    setMockResponse(response: MockResponse) {
      mockResponse = response;
    },
    mockFs,
    getResult<T = unknown>(): T | undefined {
      return storedResult as T | undefined;
    },
    clearResult() {
      storedResult = undefined;
    },
  };
}
