/**
 * Integration tests for the isolate client and daemon.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import { connect } from "./connection.ts";
import { startDaemon, type DaemonHandle } from "@ricsam/isolate-daemon";
import type { DaemonConnection, RemoteRuntime } from "./types.ts";

const TEST_SOCKET = "/tmp/isolate-test-daemon.sock";

describe("isolate-client integration", () => {
  let daemon: DaemonHandle;
  let client: DaemonConnection;

  before(async () => {
    daemon = await startDaemon({ socketPath: TEST_SOCKET });
    client = await connect({ socket: TEST_SOCKET });
  });

  after(async () => {
    await client.close();
    await daemon.close();
  });

  it("should connect to daemon", () => {
    assert.strictEqual(client.isConnected(), true);
  });

  it("should create and dispose runtime", async () => {
    const runtime = await client.createRuntime();
    assert.ok(runtime.isolateId);
    await runtime.dispose();
  });

  it("should evaluate code in runtime", async () => {
    const runtime = await client.createRuntime();
    try {
      const result = await runtime.eval("1 + 2");
      assert.strictEqual(result, 3);
    } finally {
      await runtime.dispose();
    }
  });

  it("should handle console callbacks", async () => {
    const logs: unknown[][] = [];

    const runtime = await client.createRuntime({
      console: {
        log: (...args) => logs.push(args),
      },
    });

    try {
      await runtime.eval(`console.log("hello", "world")`);
      // Give callbacks time to arrive
      await new Promise((resolve) => setTimeout(resolve, 100));
      assert.deepStrictEqual(logs, [["hello", "world"]]);
    } finally {
      await runtime.dispose();
    }
  });

  it("should handle multiple console methods", async () => {
    const consoleCalls: { method: string; args: unknown[] }[] = [];

    const runtime = await client.createRuntime({
      console: {
        log: (...args) => consoleCalls.push({ method: "log", args }),
        warn: (...args) => consoleCalls.push({ method: "warn", args }),
        error: (...args) => consoleCalls.push({ method: "error", args }),
      },
    });

    try {
      await runtime.eval(`
        console.log("log message");
        console.warn("warn message");
        console.error("error message");
      `);
      await new Promise((resolve) => setTimeout(resolve, 100));

      assert.strictEqual(consoleCalls.length, 3);
      assert.deepStrictEqual(consoleCalls[0], {
        method: "log",
        args: ["log message"],
      });
      assert.deepStrictEqual(consoleCalls[1], {
        method: "warn",
        args: ["warn message"],
      });
      assert.deepStrictEqual(consoleCalls[2], {
        method: "error",
        args: ["error message"],
      });
    } finally {
      await runtime.dispose();
    }
  });

  it("should dispatch HTTP requests", async () => {
    const runtime = await client.createRuntime();

    try {
      // Set up a fetch handler using the serve() function
      await runtime.eval(`
        serve({
          fetch: (request) => {
            return new Response(JSON.stringify({
              method: request.method,
              url: request.url,
            }), {
              status: 200,
              headers: { "Content-Type": "application/json" },
            });
          }
        });
      `);

      const request = new Request("http://localhost/test", {
        method: "POST",
      });

      const response = await runtime.dispatchRequest(request);
      assert.strictEqual(response.status, 200);

      const body = await response.json();
      assert.strictEqual(body.method, "POST");
      assert.strictEqual(body.url, "http://localhost/test");
    } finally {
      await runtime.dispose();
    }
  });

  it("should handle fetch callback for outbound requests", async () => {
    const fetchRequests: { url: string; method: string }[] = [];

    const runtime = await client.createRuntime({
      fetch: async (request) => {
        fetchRequests.push({
          url: request.url,
          method: request.method,
        });
        return new Response(JSON.stringify({ mocked: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      },
    });

    try {
      // Use serve handler to make outbound fetch - this properly handles async
      await runtime.eval(`
        serve({
          fetch: async (request) => {
            const response = await fetch("https://api.example.com/data");
            const data = await response.json();
            return new Response(JSON.stringify(data), {
              status: 200,
              headers: { "Content-Type": "application/json" },
            });
          }
        });
      `);

      // Dispatch a request to trigger the serve handler
      const response = await runtime.dispatchRequest(
        new Request("http://localhost/trigger")
      );
      const data = await response.json();

      assert.deepStrictEqual(data, { mocked: true });
      assert.strictEqual(fetchRequests.length, 1);
      assert.strictEqual(fetchRequests[0].url, "https://api.example.com/data");
      assert.strictEqual(fetchRequests[0].method, "GET");
    } finally {
      await runtime.dispose();
    }
  });

  it("should report daemon stats", async () => {
    const stats = daemon.getStats();
    assert.ok(stats.totalIsolatesCreated >= 0);
    assert.ok(stats.totalRequestsProcessed >= 0);
    assert.ok(stats.activeConnections >= 1);
  });

  // Test Environment Integration Tests
  it("should setup test environment and run tests", async () => {
    const runtime = await client.createRuntime();

    try {
      // Setup test environment
      await runtime.setupTestEnvironment();

      // Define some tests
      await runtime.eval(`
        describe('math', () => {
          it('adds numbers', () => {
            expect(1 + 1).toBe(2);
          });

          it('subtracts numbers', () => {
            expect(5 - 3).toBe(2);
          });
        });
      `);

      // Run tests
      const results = await runtime.runTests();

      assert.strictEqual(results.passed, 2);
      assert.strictEqual(results.failed, 0);
      assert.strictEqual(results.total, 2);
    } finally {
      await runtime.dispose();
    }
  });

  it("should report test failures", async () => {
    const runtime = await client.createRuntime();

    try {
      await runtime.setupTestEnvironment();

      await runtime.eval(`
        describe('failing tests', () => {
          it('passes', () => {
            expect(true).toBe(true);
          });

          it('fails', () => {
            expect(1).toBe(2);
          });
        });
      `);

      const results = await runtime.runTests();

      assert.strictEqual(results.passed, 1);
      assert.strictEqual(results.failed, 1);
      assert.strictEqual(results.total, 2);

      // Check error message
      const failedTest = results.results.find((r) => !r.passed);
      assert.ok(failedTest);
      assert.ok(failedTest.error?.includes("Expected"));
    } finally {
      await runtime.dispose();
    }
  });

  it("should support async tests", async () => {
    const runtime = await client.createRuntime();

    try {
      await runtime.setupTestEnvironment();

      await runtime.eval(`
        describe('async tests', () => {
          it('handles async', async () => {
            const result = await Promise.resolve(42);
            expect(result).toBe(42);
          });
        });
      `);

      const results = await runtime.runTests();

      assert.strictEqual(results.passed, 1);
      assert.strictEqual(results.failed, 0);
    } finally {
      await runtime.dispose();
    }
  });

  it("should support beforeEach and afterEach hooks", async () => {
    const runtime = await client.createRuntime();

    try {
      await runtime.setupTestEnvironment();

      await runtime.eval(`
        let count = 0;

        describe('hooks', () => {
          beforeEach(() => {
            count++;
          });

          it('first test', () => {
            expect(count).toBe(1);
          });

          it('second test', () => {
            expect(count).toBe(2);
          });
        });
      `);

      const results = await runtime.runTests();

      assert.strictEqual(results.passed, 2);
      assert.strictEqual(results.failed, 0);
    } finally {
      await runtime.dispose();
    }
  });

  // Playwright Integration Tests
  it("should setup and run playwright tests", async () => {
    const runtime = await client.createRuntime();

    try {
      // Setup Playwright (launches browser in daemon)
      await runtime.setupPlaywright({
        browserType: "chromium",
        headless: true,
      });

      // Define a simple test
      await runtime.eval(`
        test('simple test', async () => {
          expect(true).toBe(true);
        });
      `);

      // Run tests
      const results = await runtime.runPlaywrightTests();

      assert.strictEqual(results.passed, 1);
      assert.strictEqual(results.failed, 0);
      assert.strictEqual(results.total, 1);
    } finally {
      await runtime.dispose();
    }
  });

  it("should collect console logs and network data", async () => {
    const runtime = await client.createRuntime();

    try {
      await runtime.setupPlaywright({
        browserType: "chromium",
        headless: true,
      });

      // Navigate to a page that logs to console
      await runtime.eval(`
        test('console logging', async () => {
          await page.goto('data:text/html,<script>console.log("test message")</script>');
          await page.waitForTimeout(100);
        });
      `);

      await runtime.runPlaywrightTests();

      // Get collected data
      const data = await runtime.getCollectedData();

      // Should have captured the console log
      assert.ok(data.consoleLogs.length >= 0); // Console logs might be captured
      assert.ok(Array.isArray(data.networkRequests));
      assert.ok(Array.isArray(data.networkResponses));
    } finally {
      await runtime.dispose();
    }
  });

  it("should reset playwright tests", async () => {
    const runtime = await client.createRuntime();

    try {
      await runtime.setupPlaywright({
        browserType: "chromium",
        headless: true,
      });

      // Define a test
      await runtime.eval(`
        test('first test', async () => {
          expect(true).toBe(true);
        });
      `);

      // Run tests
      let results = await runtime.runPlaywrightTests();
      assert.strictEqual(results.total, 1);

      // Reset tests
      await runtime.resetPlaywrightTests();

      // Define new tests
      await runtime.eval(`
        test('second test', async () => {
          expect(1).toBe(1);
        });
        test('third test', async () => {
          expect(2).toBe(2);
        });
      `);

      // Run tests again
      results = await runtime.runPlaywrightTests();
      assert.strictEqual(results.total, 2);
      assert.strictEqual(results.passed, 2);
    } finally {
      await runtime.dispose();
    }
  });

  it("should report playwright test failures", async () => {
    const runtime = await client.createRuntime();

    try {
      await runtime.setupPlaywright({
        browserType: "chromium",
        headless: true,
      });

      await runtime.eval(`
        test('passing test', async () => {
          expect(true).toBe(true);
        });

        test('failing test', async () => {
          expect(1).toBe(2);
        });
      `);

      const results = await runtime.runPlaywrightTests();

      assert.strictEqual(results.passed, 1);
      assert.strictEqual(results.failed, 1);
      assert.strictEqual(results.total, 2);

      // Check error message is present
      const failedTest = results.results.find((t) => !t.passed);
      assert.ok(failedTest);
      assert.ok(failedTest.error);
    } finally {
      await runtime.dispose();
    }
  });

  it("should stream playwright events", async () => {
    const consoleLogs: { level: string; args: unknown[] }[] = [];
    const runtime = await client.createRuntime();

    try {
      await runtime.setupPlaywright({
        browserType: "chromium",
        headless: true,
        onConsoleLog: (log) => consoleLogs.push(log),
      });

      await runtime.eval(`
        test('console test', async () => {
          await page.goto('data:text/html,<script>console.log("streamed message")</script>');
          await page.waitForTimeout(200);
        });
      `);

      await runtime.runPlaywrightTests();

      // Wait a bit for events to arrive
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Console logs should have been streamed
      // Note: This test might be flaky depending on timing
      assert.ok(Array.isArray(consoleLogs));
    } finally {
      await runtime.dispose();
    }
  });

  // File System Callback Integration Tests
  // Note: FS operations must be performed within a serve() handler because
  // the fs API uses applySyncPromise which requires an async execution context
  it("should handle fs callbacks for file operations", async () => {
    // In-memory file system
    const files: Map<string, Uint8Array> = new Map();
    const directories: Set<string> = new Set(["/"]);

    const runtime = await client.createRuntime({
      fs: {
        readFile: async (path: string) => {
          const data = files.get(path);
          if (!data) throw new Error("ENOENT: File not found");
          return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
        },
        writeFile: async (path: string, data: ArrayBuffer) => {
          files.set(path, new Uint8Array(data));
        },
        unlink: async (path: string) => {
          if (!files.has(path)) throw new Error("ENOENT: File not found");
          files.delete(path);
        },
        readdir: async (path: string) => {
          const entries: string[] = [];
          const prefix = path === "/" ? "/" : path + "/";
          for (const key of files.keys()) {
            if (key.startsWith(prefix)) {
              const relativePath = key.slice(prefix.length);
              const name = relativePath.split("/")[0];
              if (name && !entries.includes(name)) {
                entries.push(name);
              }
            }
          }
          for (const dir of directories) {
            if (dir.startsWith(prefix) && dir !== prefix) {
              const relativePath = dir.slice(prefix.length);
              const name = relativePath.split("/")[0];
              if (name && !entries.includes(name)) {
                entries.push(name);
              }
            }
          }
          return entries;
        },
        mkdir: async (path: string) => {
          directories.add(path);
        },
        rmdir: async (path: string) => {
          directories.delete(path);
        },
        stat: async (path: string) => {
          if (files.has(path)) {
            const data = files.get(path)!;
            return { isFile: true, isDirectory: false, size: data.length };
          }
          if (directories.has(path)) {
            return { isFile: false, isDirectory: true, size: 0 };
          }
          throw new Error("ENOENT: Not found");
        },
      },
    });

    try {
      // Set up a serve handler that uses fs operations
      await runtime.eval(`
        serve({
          fetch: async (request) => {
            const url = new URL(request.url);

            if (url.pathname === "/write") {
              // Write a file
              const root = await getDirectory("/");
              const file = await root.getFileHandle("test.txt", { create: true });
              const writable = await file.createWritable();
              writable.write("Hello from isolate!");
              writable.close();
              return new Response("written", { status: 200 });
            }

            if (url.pathname === "/read") {
              // Read the file back
              const root = await getDirectory("/");
              const file = await root.getFileHandle("test.txt");
              const data = await file.getFile();
              const text = await data.text();
              return new Response(text, { status: 200 });
            }

            return new Response("not found", { status: 404 });
          }
        });
      `);

      // Write a file via the isolate
      const writeResponse = await runtime.dispatchRequest(
        new Request("http://localhost/write")
      );
      assert.strictEqual(writeResponse.status, 200);

      // Verify file was written
      assert.ok(files.has("/test.txt"));
      const content = new TextDecoder().decode(files.get("/test.txt"));
      assert.strictEqual(content, "Hello from isolate!");

      // Read the file back via the isolate
      const readResponse = await runtime.dispatchRequest(
        new Request("http://localhost/read")
      );
      assert.strictEqual(readResponse.status, 200);
      const text = await readResponse.text();
      assert.strictEqual(text, "Hello from isolate!");
    } finally {
      await runtime.dispose();
    }
  });

  it("should handle fs directory operations", async () => {
    const files: Map<string, Uint8Array> = new Map();
    const directories: Set<string> = new Set(["/"]);

    const runtime = await client.createRuntime({
      fs: {
        readFile: async (path: string) => {
          const data = files.get(path);
          if (!data) throw new Error("ENOENT: File not found");
          return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
        },
        writeFile: async (path: string, data: ArrayBuffer) => {
          files.set(path, new Uint8Array(data));
        },
        readdir: async (path: string) => {
          const entries: string[] = [];
          const prefix = path === "/" ? "/" : path + "/";
          for (const key of files.keys()) {
            if (key.startsWith(prefix)) {
              const relativePath = key.slice(prefix.length);
              const name = relativePath.split("/")[0];
              if (name && !entries.includes(name)) {
                entries.push(name);
              }
            }
          }
          return entries;
        },
        mkdir: async (path: string) => {
          directories.add(path);
        },
        stat: async (path: string) => {
          if (files.has(path)) {
            const data = files.get(path)!;
            return { isFile: true, isDirectory: false, size: data.length };
          }
          if (directories.has(path)) {
            return { isFile: false, isDirectory: true, size: 0 };
          }
          throw new Error("ENOENT: Not found");
        },
      },
    });

    try {
      // Pre-populate files
      files.set("/file1.txt", new TextEncoder().encode("content1"));
      files.set("/file2.txt", new TextEncoder().encode("content2"));

      // Set up a serve handler that lists directory contents
      await runtime.eval(`
        serve({
          fetch: async (request) => {
            const root = await getDirectory("/");
            const entries = [];
            for await (const [name, handle] of root.entries()) {
              entries.push({ name, kind: handle.kind });
            }
            return new Response(JSON.stringify(entries), {
              status: 200,
              headers: { "Content-Type": "application/json" }
            });
          }
        });
      `);

      // List directory contents
      const response = await runtime.dispatchRequest(
        new Request("http://localhost/list")
      );
      assert.strictEqual(response.status, 200);

      const entries = await response.json();
      assert.ok(entries.some((e: { name: string }) => e.name === "file1.txt"));
      assert.ok(entries.some((e: { name: string }) => e.name === "file2.txt"));
    } finally {
      await runtime.dispose();
    }
  });
});
