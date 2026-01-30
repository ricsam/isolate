/**
 * Integration tests for the isolate client and daemon.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import path from "node:path";
import { connect } from "./connection.ts";
import { startDaemon, type DaemonHandle } from "@ricsam/isolate-daemon";
import { chromium, type Browser, type Page } from "playwright";
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
    assert.ok(runtime.id); // New id property
    assert.strictEqual(runtime.id, runtime.isolateId); // Should be equal
    await runtime.dispose();
  });

  it("should evaluate code in runtime", async () => {
    const logs: string[] = [];
    const runtime = await client.createRuntime({
      console: {
        onEntry: (entry) => {
          if (entry.type === "output" && entry.level === "log") {
            logs.push(entry.stdout);
          }
        },
      },
    });
    try {
      // eval returns void now (always module mode)
      await runtime.eval("console.log(1 + 2)");
      // No delay needed - eval waits for callbacks to complete
      assert.strictEqual(logs[0], "3");
    } finally {
      await runtime.dispose();
    }
  });

  it("should handle console callbacks", async () => {
    const logs: string[] = [];

    const runtime = await client.createRuntime({
      console: {
        onEntry: (entry) => {
          if (entry.type === "output" && entry.level === "log") {
            logs.push(entry.stdout);
          }
        },
      },
    });

    try {
      await runtime.eval(`console.log("hello", "world")`);
      // No delay needed - eval waits for callbacks to complete
      assert.deepStrictEqual(logs, ["hello world"]);
    } finally {
      await runtime.dispose();
    }
  });

  it("should handle multiple console methods", async () => {
    const consoleCalls: { method: string; stdout: string }[] = [];

    const runtime = await client.createRuntime({
      console: {
        onEntry: (entry) => {
          if (entry.type === "output") {
            consoleCalls.push({ method: entry.level, stdout: entry.stdout });
          }
        },
      },
    });

    try {
      await runtime.eval(`
        console.log("log message");
        console.warn("warn message");
        console.error("error message");
      `);
      // No delay needed - eval waits for callbacks to complete
      assert.strictEqual(consoleCalls.length, 3);
      assert.deepStrictEqual(consoleCalls[0], {
        method: "log",
        stdout: "log message",
      });
      assert.deepStrictEqual(consoleCalls[1], {
        method: "warn",
        stdout: "warn message",
      });
      assert.deepStrictEqual(consoleCalls[2], {
        method: "error",
        stdout: "error message",
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

      const response = await runtime.fetch.dispatchRequest(request);
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
      const response = await runtime.fetch.dispatchRequest(
        new Request("http://localhost/trigger")
      );
      const data = await response.json();

      assert.deepStrictEqual(data, { mocked: true });
      assert.strictEqual(fetchRequests.length, 1);
      assert.strictEqual(fetchRequests[0]!.url, "https://api.example.com/data");
      assert.strictEqual(fetchRequests[0]!.method, "GET");
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

  // maxExecutionMs timeout tests
  it("should timeout on infinite loop with maxExecutionMs", async () => {
    const runtime = await client.createRuntime();
    try {
      await assert.rejects(
        async () => {
          await runtime.eval(`while(true) {}`, { maxExecutionMs: 100 });
        },
        /Script execution timed out/,
        "should throw timeout error"
      );
    } finally {
      await runtime.dispose();
    }
  });

  it("should complete when code finishes within maxExecutionMs", async () => {
    const logs: string[] = [];
    const runtime = await client.createRuntime({
      console: {
        onEntry: (entry) => {
          if (entry.type === "output" && entry.level === "log") {
            logs.push(entry.stdout);
          }
        },
      },
    });

    try {
      await runtime.eval(`console.log("fast code");`, { maxExecutionMs: 5000 });
      assert.strictEqual(logs[0], "fast code");
    } finally {
      await runtime.dispose();
    }
  });

  // Test Environment Integration Tests
  it("should setup test environment and run tests", async () => {
    const runtime = await client.createRuntime({
      testEnvironment: true,
    });

    try {
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
      const results = await runtime.testEnvironment.runTests();

      assert.strictEqual(results.passed, 2);
      assert.strictEqual(results.failed, 0);
      assert.strictEqual(results.total, 2);
    } finally {
      await runtime.dispose();
    }
  });

  it("should report test failures", async () => {
    const runtime = await client.createRuntime({
      testEnvironment: true,
    });

    try {
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

      const results = await runtime.testEnvironment.runTests();

      assert.strictEqual(results.passed, 1);
      assert.strictEqual(results.failed, 1);
      assert.strictEqual(results.total, 2);

      // Check error message
      const failedTest = results.tests.find((r) => r.status === "fail");
      assert.ok(failedTest);
      assert.ok(failedTest.error?.message?.includes("Expected"));
    } finally {
      await runtime.dispose();
    }
  });

  it("should support async tests", async () => {
    const runtime = await client.createRuntime({
      testEnvironment: true,
    });

    try {
      await runtime.eval(`
        describe('async tests', () => {
          it('handles async', async () => {
            const result = await Promise.resolve(42);
            expect(result).toBe(42);
          });
        });
      `);

      const results = await runtime.testEnvironment.runTests();

      assert.strictEqual(results.passed, 1);
      assert.strictEqual(results.failed, 0);
    } finally {
      await runtime.dispose();
    }
  });

  it("should support beforeEach and afterEach hooks", async () => {
    const runtime = await client.createRuntime({
      testEnvironment: true,
    });

    try {
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

      const results = await runtime.testEnvironment.runTests();

      assert.strictEqual(results.passed, 2);
      assert.strictEqual(results.failed, 0);
    } finally {
      await runtime.dispose();
    }
  });

  // Playwright Integration Tests
  // NOTE: Client now owns the browser - tests launch browser and pass page to createRuntime
  it("should setup and run playwright tests", async () => {
    const browser = await chromium.launch({ headless: true });
    const browserContext = await browser.newContext();
    const page = await browserContext.newPage();

    const runtime = await client.createRuntime({
      testEnvironment: true,
      playwright: { page },
    });

    try {
      // Define a simple test
      await runtime.eval(`
        test('simple test', async () => {
          expect(true).toBe(true);
        });
      `);

      // Run tests
      const results = await runtime.testEnvironment.runTests();

      assert.strictEqual(results.passed, 1);
      assert.strictEqual(results.failed, 0);
      assert.strictEqual(results.total, 1);
    } finally {
      await runtime.dispose();
      await browser.close();
    }
  });

  it("should collect console logs and network data", async () => {
    const browser = await chromium.launch({ headless: true });
    const browserContext = await browser.newContext();
    const page = await browserContext.newPage();

    const runtime = await client.createRuntime({
      testEnvironment: true,
      playwright: { page },
    });

    try {
      // Navigate to a page that logs to console
      await runtime.eval(`
        test('console logging', async () => {
          await page.goto('data:text/html,<script>console.log("test message")</script>');
          await page.waitForTimeout(100);
        });
      `);

      await runtime.testEnvironment.runTests();

      // Get collected data
      const data = runtime.playwright.getCollectedData();

      // Should have captured the console log from the browser page
      assert.ok(data.browserConsoleLogs.length > 0, "Expected at least one browser console log");
      assert.ok(
        data.browserConsoleLogs.some((log) => log.stdout.includes("test message")),
        `Expected a log containing "test message", got: ${JSON.stringify(data.browserConsoleLogs)}`
      );
      assert.ok(Array.isArray(data.networkRequests));
      assert.ok(Array.isArray(data.networkResponses));
    } finally {
      await runtime.dispose();
      await browser.close();
    }
  });

  it("should reset playwright tests", async () => {
    const browser = await chromium.launch({ headless: true });
    const browserContext = await browser.newContext();
    const page = await browserContext.newPage();

    const runtime = await client.createRuntime({
      testEnvironment: true,
      playwright: { page },
    });

    try {
      // Define a test
      await runtime.eval(`
        test('first test', async () => {
          expect(true).toBe(true);
        });
      `);

      // Run tests
      let results = await runtime.testEnvironment.runTests();
      assert.strictEqual(results.total, 1);

      // Reset tests
      await runtime.testEnvironment.reset();

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
      results = await runtime.testEnvironment.runTests();
      assert.strictEqual(results.total, 2);
      assert.strictEqual(results.passed, 2);
    } finally {
      await runtime.dispose();
      await browser.close();
    }
  });

  it("should report playwright test failures", async () => {
    const browser = await chromium.launch({ headless: true });
    const browserContext = await browser.newContext();
    const page = await browserContext.newPage();

    const runtime = await client.createRuntime({
      testEnvironment: true,
      playwright: { page },
    });

    try {
      await runtime.eval(`
        test('passing test', async () => {
          expect(true).toBe(true);
        });

        test('failing test', async () => {
          expect(1).toBe(2);
        });
      `);

      const results = await runtime.testEnvironment.runTests();

      assert.strictEqual(results.passed, 1);
      assert.strictEqual(results.failed, 1);
      assert.strictEqual(results.total, 2);

      // Check error message is present
      const failedTest = results.tests.find((t) => t.status === "fail");
      assert.ok(failedTest);
      assert.ok(failedTest.error);
    } finally {
      await runtime.dispose();
      await browser.close();
    }
  });

  it("should stream playwright events", async () => {
    const consoleLogs: { level: string; stdout: string }[] = [];
    const browser = await chromium.launch({ headless: true });
    const browserContext = await browser.newContext();
    const page = await browserContext.newPage();

    const runtime = await client.createRuntime({
      testEnvironment: true,
      playwright: {
        page,
        onEvent: (event) => {
          if (event.type === "browserConsoleLog") {
            consoleLogs.push({ level: event.level, stdout: event.stdout });
          }
        },
      },
    });

    try {
      await runtime.eval(`
        test('console test', async () => {
          await page.goto('data:text/html,<script>console.log("streamed message")</script>');
          await page.waitForTimeout(200);
        });
      `);

      await runtime.testEnvironment.runTests();
      // Console logs should have been streamed via client-side page listeners
      assert.ok(consoleLogs.length > 0, "Expected at least one streamed console log");
      assert.ok(
        consoleLogs.some((log) => log.stdout.includes("streamed message")),
        `Expected a log containing "streamed message", got: ${JSON.stringify(consoleLogs)}`
      );
    } finally {
      await runtime.dispose();
      await browser.close();
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
        readFile: async (path: string): Promise<ArrayBuffer> => {
          const data = files.get(path);
          if (!data) throw new Error("ENOENT: File not found");
          return data.buffer.slice(
            data.byteOffset,
            data.byteOffset + data.byteLength
          ) as ArrayBuffer;
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
      const writeResponse = await runtime.fetch.dispatchRequest(
        new Request("http://localhost/write")
      );
      assert.strictEqual(writeResponse.status, 200);

      // Verify file was written
      assert.ok(files.has("/test.txt"));
      const content = new TextDecoder().decode(files.get("/test.txt"));
      assert.strictEqual(content, "Hello from isolate!");

      // Read the file back via the isolate
      const readResponse = await runtime.fetch.dispatchRequest(
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
        readFile: async (path: string): Promise<ArrayBuffer> => {
          const data = files.get(path);
          if (!data) throw new Error("ENOENT: File not found");
          return data.buffer.slice(
            data.byteOffset,
            data.byteOffset + data.byteLength
          ) as ArrayBuffer;
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
      const response = await runtime.fetch.dispatchRequest(
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

  // Custom Functions Integration Tests
  // Note: Custom functions use applySyncPromise which only works within
  // an async execution context like a serve() handler
  it("should call custom async functions from isolate", async () => {
    const calls: { name: string; args: unknown[] }[] = [];

    const runtime = await client.createRuntime({
      customFunctions: {
        hashPassword: {
          fn: async (...args) => {
            const password = args[0];
            calls.push({ name: "hashPassword", args: [password] });
            return `hashed:${password}`;
          },
          type: 'async',
        },
        queryDatabase: {
          fn: async (...args) => {
            const sql = args[0];
            calls.push({ name: "queryDatabase", args: [sql] });
            return [
              { id: 1, name: "Alice" },
              { id: 2, name: "Bob" },
            ];
          },
          type: 'async',
        },
      },
    });

    try {
      // Use serve handler to call custom functions (required execution context)
      await runtime.eval(`
        serve({
          fetch: async (request) => {
            const hash = await hashPassword("secret123");
            const users = await queryDatabase("SELECT * FROM users");
            return new Response(JSON.stringify({ hash, users }), {
              headers: { "Content-Type": "application/json" }
            });
          }
        });
      `);

      const response = await runtime.fetch.dispatchRequest(
        new Request("http://localhost/test")
      );
      const result = await response.json();

      assert.deepStrictEqual(result, {
        hash: "hashed:secret123",
        users: [
          { id: 1, name: "Alice" },
          { id: 2, name: "Bob" },
        ],
      });

      assert.strictEqual(calls.length, 2);
      assert.deepStrictEqual(calls[0], {
        name: "hashPassword",
        args: ["secret123"],
      });
      assert.deepStrictEqual(calls[1], {
        name: "queryDatabase",
        args: ["SELECT * FROM users"],
      });
    } finally {
      await runtime.dispose();
    }
  });

  it("should call custom sync functions from isolate", async () => {
    const runtime = await client.createRuntime({
      customFunctions: {
        getConfig: {
          fn: () => ({ apiKey: "sk-test", environment: "testing" }),
          type: 'sync',
        },
        formatDate: {
          fn: (...args) => new Date(args[0] as number).toISOString(),
          type: 'sync',
        },
      },
    });

    try {
      await runtime.eval(`
        serve({
          fetch: async (request) => {
            const config = await getConfig();
            const date = await formatDate(1704067200000);
            return new Response(JSON.stringify({ config, date }), {
              headers: { "Content-Type": "application/json" }
            });
          }
        });
      `);

      const response = await runtime.fetch.dispatchRequest(
        new Request("http://localhost/test")
      );
      const result = await response.json();

      assert.deepStrictEqual(result, {
        config: { apiKey: "sk-test", environment: "testing" },
        date: "2024-01-01T00:00:00.000Z",
      });
    } finally {
      await runtime.dispose();
    }
  });

  it("should handle custom function errors", async () => {
    const runtime = await client.createRuntime({
      customFunctions: {
        failingFunction: {
          fn: async () => {
            throw new Error("Custom function error");
          },
          type: 'async',
        },
      },
    });

    try {
      await runtime.eval(`
        serve({
          fetch: async (request) => {
            try {
              await failingFunction();
              return new Response("should not reach");
            } catch (err) {
              return new Response(err.message, { status: 500 });
            }
          }
        });
      `);

      const response = await runtime.fetch.dispatchRequest(
        new Request("http://localhost/test")
      );
      const errorMessage = await response.text();

      assert.strictEqual(response.status, 500);
      assert.ok(errorMessage.includes("Custom function error"));
    } finally {
      await runtime.dispose();
    }
  });

  it("should pass multiple arguments to custom functions", async () => {
    const runtime = await client.createRuntime({
      customFunctions: {
        sum: {
          fn: async (...args) => (args as number[]).reduce((a, b) => a + b, 0),
          type: 'async',
        },
        concat: {
          fn: async (...args) =>
            (args[0] as string) + (args[1] as string) + (args[2] as string),
          type: 'async',
        },
      },
    });

    try {
      await runtime.eval(`
        serve({
          fetch: async (request) => {
            const total = await sum(1, 2, 3, 4, 5);
            const str = await concat("hello", " ", "world");
            return new Response(JSON.stringify({ total, str }), {
              headers: { "Content-Type": "application/json" }
            });
          }
        });
      `);

      const response = await runtime.fetch.dispatchRequest(
        new Request("http://localhost/test")
      );
      const result = await response.json();

      assert.deepStrictEqual(result, {
        total: 15,
        str: "hello world",
      });
    } finally {
      await runtime.dispose();
    }
  });

  it("should call custom functions in direct eval without serve handler", async () => {
    const calls: string[] = [];
    const logs: string[] = [];

    const runtime = await client.createRuntime({
      console: {
        onEntry: (entry) => {
          if (entry.type === "output" && entry.level === "log") {
            logs.push(entry.stdout);
          }
        },
      },
      customFunctions: {
        greet: {
          fn: async (...args) => {
            const name = args[0] as string;
            calls.push(`greet:${name}`);
            return `Hello, ${name}!`;
          },
          type: 'async',
        },
        add: {
          fn: async (...args) => {
            const a = args[0] as number;
            const b = args[1] as number;
            calls.push(`add:${a}+${b}`);
            return a + b;
          },
          type: 'async',
        },
      },
    });

    try {
      // Direct eval without serve() handler - now always module mode
      // Use console.log to capture results since eval returns void
      await runtime.eval(`
        const greeting = await greet("World");
        const sum = await add(5, 3);
        console.log(greeting, sum);
      `);
      // No delay needed - eval waits for callbacks to complete
      assert.strictEqual(logs[0], "Hello, World! 8");
      assert.strictEqual(calls.length, 2);
      assert.strictEqual(calls[0], "greet:World");
      assert.strictEqual(calls[1], "add:5+3");
    } finally {
      await runtime.dispose();
    }
  });

  it("should work with custom functions that are not async", async () => {
    const calls: string[] = [];
    const logs: string[] = [];

    const runtime = await client.createRuntime({
      console: {
        onEntry: (entry) => {
          if (entry.type === "output" && entry.level === "log") {
            logs.push(entry.stdout);
          }
        },
      },
      customFunctions: {
        greet: {
          fn: (...args) => {
            const name = args[0] as string;
            calls.push(`greet:${name}`);
            return `Hello, ${name}!`;
          },
          type: 'sync',
        },
        add: {
          fn: (...args) => {
            const a = args[0] as number;
            const b = args[1] as number;
            calls.push(`add:${a}+${b}`);
            return a + b;
          },
          type: 'sync',
        },
      },
    });

    try {
      // Direct eval without serve() handler - now always module mode
      // Use console.log to capture results since eval returns void
      await runtime.eval(`
        const greeting = greet("World");
        const sum = add(5, 3);
        console.log(greeting, sum);
      `);
      // No delay needed - eval waits for callbacks to complete
      assert.strictEqual(logs[0], "Hello, World! 8");
      assert.strictEqual(calls.length, 2);
      assert.strictEqual(calls[0], "greet:World");
      assert.strictEqual(calls[1], "add:5+3");
    } finally {
      await runtime.dispose();
    }
  });

  // Module Loader Integration Tests
  it("should load virtual modules via module loader", async () => {
    const logs: string[] = [];

    const runtime = await client.createRuntime({
      console: {
        onEntry: (entry) => {
          if (entry.type === "output" && entry.level === "log") {
            logs.push(entry.stdout);
          }
        },
      },
      moduleLoader: async (moduleName: string, importer) => {
        if (moduleName === "@/utils") {
          return {
            code: `
            export function add(a, b) { return a + b; }
            export function multiply(a, b) { return a * b; }
          `,
            resolveDir: importer.resolveDir,
          };
        }
        throw new Error(`Unknown module: ${moduleName}`);
      },
    });

    try {
      // Module evaluation returns undefined, but side effects work
      await runtime.eval(`
        import { add, multiply } from "@/utils";
        console.log("sum:", add(2, 3));
        console.log("product:", multiply(4, 5));
      `); // module: true is now default
      // No delay needed - eval waits for callbacks to complete
      assert.ok(logs.some((l) => l.includes("sum: 5")));
      assert.ok(logs.some((l) => l.includes("product: 20")));
    } finally {
      await runtime.dispose();
    }
  });

  it("should handle nested module imports", async () => {
    const logs: string[] = [];

    const runtime = await client.createRuntime({
      console: {
        onEntry: (entry) => {
          if (entry.type === "output" && entry.level === "log") {
            logs.push(entry.stdout);
          }
        },
      },
      moduleLoader: async (moduleName: string, importer) => {
        if (moduleName === "@/math") {
          return {
            code: `
            export function square(x) { return x * x; }
          `,
            resolveDir: importer.resolveDir,
          };
        }
        if (moduleName === "@/calc") {
          return {
            code: `
            import { square } from "@/math";
            export function sumOfSquares(a, b) {
              return square(a) + square(b);
            }
          `,
            resolveDir: importer.resolveDir,
          };
        }
        throw new Error(`Unknown module: ${moduleName}`);
      },
    });

    try {
      await runtime.eval(`
        import { sumOfSquares } from "@/calc";
        console.log("result:", sumOfSquares(3, 4));
      `); // module: true is now default
      // No delay needed - eval waits for callbacks to complete
      assert.ok(logs.some((l) => l.includes("result: 25")));
    } finally {
      await runtime.dispose();
    }
  });

  it("should cache loaded modules", async () => {
    let loadCount = 0;
    const logs: string[] = [];

    const runtime = await client.createRuntime({
      console: {
        onEntry: (entry) => {
          if (entry.type === "output" && entry.level === "log") {
            logs.push(entry.stdout);
          }
        },
      },
      moduleLoader: async (moduleName: string, importer) => {
        loadCount++;
        if (moduleName === "@/counter") {
          return {
            code: `export const value = ${loadCount};`,
            resolveDir: importer.resolveDir,
          };
        }
        throw new Error(`Unknown module: ${moduleName}`);
      },
    });

    try {
      await runtime.eval(`
        import { value as v1 } from "@/counter";
        import { value as v2 } from "@/counter";
        console.log("values:", v1, v2);
      `); // module: true is now default
      // No delay needed - eval waits for callbacks to complete
      // Module should be cached, so both imports get the same value
      assert.strictEqual(loadCount, 1);
      assert.ok(logs.some((l) => l.includes("values: 1 1")));
    } finally {
      await runtime.dispose();
    }
  });

  it("should handle module loader errors", async () => {
    const runtime = await client.createRuntime({
      moduleLoader: async (moduleName: string) => {
        throw new Error(`Module not found: ${moduleName}`);
      },
    });

    try {
      await assert.rejects(async () => {
        await runtime.eval(`
            import { foo } from "@/nonexistent";
          `); // module: true is now default
      }, /Module not found/);
    } finally {
      await runtime.dispose();
    }
  });

  it("should error when importing without module loader", async () => {
    const runtime = await client.createRuntime();

    try {
      await assert.rejects(async () => {
        await runtime.eval(`
            import { foo } from "@/some-module";
          `); // module: true is now default
      }, /No module loader registered/);
    } finally {
      await runtime.dispose();
    }
  });

  it("should preserve error message and type from module loader", async () => {
    const runtime = await client.createRuntime({
      moduleLoader: async (moduleName: string) => {
        const error = new TypeError(`Invalid module specifier: ${moduleName}`);
        throw error;
      },
    });

    try {
      await assert.rejects(
        async () => {
          await runtime.eval(`import { foo } from "@/bad-module";`);
        },
        (err: Error) => {
          assert.ok(err.message.includes("Invalid module specifier: @/bad-module"));
          return true;
        }
      );
    } finally {
      await runtime.dispose();
    }
  });

  it("should propagate error from nested module import", async () => {
    const runtime = await client.createRuntime({
      moduleLoader: async (moduleName: string, importer) => {
        if (moduleName === "@/parent") {
          return {
            code: `import { child } from "@/child"; export const parent = child;`,
            resolveDir: importer.resolveDir,
          };
        }
        if (moduleName === "@/child") {
          throw new Error(`Failed to load child module`);
        }
        throw new Error(`Unknown module: ${moduleName}`);
      },
    });

    try {
      await assert.rejects(
        async () => {
          await runtime.eval(`import { parent } from "@/parent";`);
        },
        /Failed to load child module/
      );
    } finally {
      await runtime.dispose();
    }
  });

  it("should handle async rejection in module loader", async () => {
    const runtime = await client.createRuntime({
      moduleLoader: async (moduleName: string) => {
        // Simulate async operation that fails
        await new Promise((resolve) => setTimeout(resolve, 10));
        return Promise.reject(new Error(`Async load failed: ${moduleName}`));
      },
    });

    try {
      await assert.rejects(
        async () => {
          await runtime.eval(`import { foo } from "@/async-fail";`);
        },
        /Async load failed: @\/async-fail/
      );
    } finally {
      await runtime.dispose();
    }
  });

  it("should pass importer.path as entry filename when importing from entry code", async () => {
    let capturedImporter: { path: string; resolveDir: string } | null = null;

    const runtime = await client.createRuntime({
      moduleLoader: async (moduleName: string, importer) => {
        capturedImporter = importer;
        if (moduleName === "@/test") {
          return {
            code: `export const value = 42;`,
            resolveDir: importer.resolveDir,
          };
        }
        throw new Error(`Unknown module: ${moduleName}`);
      },
    });

    try {
      await runtime.eval(`import { value } from "@/test";`, "entry.js");
      // entry.js is normalized to /entry.js
      assert.strictEqual(capturedImporter!.path, "/entry.js");
      assert.strictEqual(capturedImporter!.resolveDir, "/");
    } finally {
      await runtime.dispose();
    }
  });

  it("should pass correct importer.path for nested imports", async () => {
    const importerPaths: Map<string, string> = new Map();

    const runtime = await client.createRuntime({
      moduleLoader: async (moduleName: string, importer) => {
        importerPaths.set(moduleName, importer.path);
        if (moduleName === "@/moduleA") {
          return {
            code: `import { b } from "@/moduleB"; export const a = b + 1;`,
            resolveDir: "/modules",
          };
        }
        if (moduleName === "@/moduleB") {
          return {
            code: `export const b = 10;`,
            resolveDir: "/modules",
          };
        }
        throw new Error(`Unknown module: ${moduleName}`);
      },
    });

    try {
      await runtime.eval(`import { a } from "@/moduleA";`, "main.js");
      // @/moduleA should be imported by /main.js (normalized from main.js)
      assert.strictEqual(importerPaths.get("@/moduleA"), "/main.js");
      // @/moduleB should be imported by @/moduleA (which resolved to /modules/moduleA)
      assert.strictEqual(importerPaths.get("@/moduleB"), "/modules/moduleA");
    } finally {
      await runtime.dispose();
    }
  });

  it("should enable relative path resolution using importer.path", async () => {
    // Virtual file system with absolute paths
    const files: Record<string, string> = {
      "/foo/bar.js": `
        import { value } from "../one.js";
        globalThis.result = value;
      `,
      "/one.js": `
        import { hello } from "./foo/hello.js";
        export const value = hello + " world";
      `,
      "/foo/hello.js": `
        export const hello = "hello";
      `,
    };

    // Track what the importer resolves to for each import
    const resolvedImporters: Map<string, string> = new Map();

    const runtime = await client.createRuntime({
      moduleLoader: async (specifier: string, importer) => {
        // Resolve the specifier relative to the importer's resolveDir
        const resolvedPath = path.posix.normalize(
          path.posix.join(importer.resolveDir, specifier)
        );

        // Track for debugging
        resolvedImporters.set(specifier, importer.path);

        const code = files[resolvedPath];
        if (!code) {
          throw new Error(`Module not found: ${specifier} (resolved to ${resolvedPath})`);
        }
        return { code, resolveDir: path.posix.dirname(resolvedPath) };
      },
    });

    try {
      await runtime.eval(files["/foo/bar.js"]!, "/foo/bar.js");

      // Verify the resolution chain worked correctly
      // ../one.js was imported from /foo/bar.js
      assert.strictEqual(resolvedImporters.get("../one.js"), "/foo/bar.js");
      // ./foo/hello.js was imported from ../one.js (which resolved to /one.js)
      assert.strictEqual(resolvedImporters.get("./foo/hello.js"), "/one.js");

      // Verify the final result
      await runtime.eval(`
        if (globalThis.result !== "hello world") {
          throw new Error("Expected 'hello world' but got: " + globalThis.result);
        }
      `);
    } finally {
      await runtime.dispose();
    }
  });

  // Combined Module Loader and Custom Functions Tests
  // Note: Custom functions require serve() handler context (applySyncPromise limitation)
  it("should use custom functions in serve handler with module setup", async () => {
    const users = [
      { id: 1, name: "Alice" },
      { id: 2, name: "Bob" },
    ];

    const runtime = await client.createRuntime({
      customFunctions: {
        dbQuery: {
          fn: async (...args) => {
            const sql = args[0] as string;
            if (sql.includes("WHERE id = 1")) {
              return users[0];
            }
            return users;
          },
          type: 'async',
        },
      },
    });

    try {
      // Custom functions work in serve handler context
      await runtime.eval(`
        serve({
          fetch: async (request) => {
            const user = await dbQuery("SELECT * FROM users WHERE id = 1");
            const allUsers = await dbQuery("SELECT * FROM users");
            return new Response(JSON.stringify({ user, allUsers }), {
              headers: { "Content-Type": "application/json" }
            });
          }
        });
      `);

      const response = await runtime.fetch.dispatchRequest(
        new Request("http://localhost/test")
      );
      const result = await response.json();

      assert.deepStrictEqual(result, {
        user: { id: 1, name: "Alice" },
        allUsers: users,
      });
    } finally {
      await runtime.dispose();
    }
  });

  it("should combine module loader and console callbacks", async () => {
    const logs: string[] = [];

    const runtime = await client.createRuntime({
      console: {
        onEntry: (entry) => {
          if (entry.type === "output" && entry.level === "log") {
            logs.push(entry.stdout);
          }
        },
      },
      moduleLoader: async (moduleName: string, importer) => {
        if (moduleName === "@/logger") {
          return {
            code: `
            export function logMessage(msg) {
              console.log("[MODULE]", msg);
            }
          `,
            resolveDir: importer.resolveDir,
          };
        }
        throw new Error(`Unknown module: ${moduleName}`);
      },
    });

    try {
      await runtime.eval(`
        import { logMessage } from "@/logger";
        logMessage("Started");
        console.log("Direct log");
      `); // module: true is now default
      // No delay needed - eval waits for callbacks to complete
      assert.ok(
        logs.some((l) => l.includes("[MODULE]") && l.includes("Started"))
      );
      assert.ok(logs.some((l) => l.includes("Direct log")));
    } finally {
      await runtime.dispose();
    }
  });

  // ReadableStream Async Iteration Tests
  // These tests reproduce an issue where ReadableStream async iteration doesn't yield
  // values when the stream wraps an AsyncIterator from the host.
  describe("ReadableStream async iteration", () => {
    it("should iterate over ReadableStream with for-await-of", async () => {
      const logs: string[] = [];

      const runtime = await client.createRuntime({
        console: {
          onEntry: (entry) => {
            if (entry.type === "output" && entry.level === "log") {
              logs.push(entry.stdout);
            }
          },
        },
      });

      try {
        await runtime.eval(`
          serve({
            fetch: async (request) => {
              // Create a simple ReadableStream
              const stream = new ReadableStream({
                start(controller) {
                  controller.enqueue("chunk1");
                  controller.enqueue("chunk2");
                  controller.enqueue("chunk3");
                  controller.close();
                }
              });

              // Iterate using for-await-of
              const chunks = [];
              for await (const chunk of stream) {
                chunks.push(chunk);
              }

              return new Response(JSON.stringify(chunks), {
                headers: { "Content-Type": "application/json" }
              });
            }
          });
        `);

        const response = await runtime.fetch.dispatchRequest(
          new Request("http://localhost/test")
        );
        const chunks = await response.json();

        assert.deepStrictEqual(chunks, ["chunk1", "chunk2", "chunk3"]);
      } finally {
        await runtime.dispose();
      }
    });

    it("should iterate over ReadableStream wrapping async generator", async () => {
      const runtime = await client.createRuntime();

      try {
        await runtime.eval(`
          serve({
            fetch: async (request) => {
              // Simulate an async generator (like what the AI SDK does internally)
              async function* asyncGenerator() {
                yield "hello";
                yield " ";
                yield "world";
              }

              // Create a ReadableStream that wraps the async generator
              const stream = new ReadableStream({
                async start(controller) {
                  for await (const chunk of asyncGenerator()) {
                    controller.enqueue(chunk);
                  }
                  controller.close();
                }
              });

              // Iterate over the wrapped stream
              const chunks = [];
              for await (const chunk of stream) {
                chunks.push(chunk);
              }

              return new Response(JSON.stringify(chunks), {
                headers: { "Content-Type": "application/json" }
              });
            }
          });
        `);

        const response = await runtime.fetch.dispatchRequest(
          new Request("http://localhost/test")
        );
        const chunks = await response.json();

        assert.deepStrictEqual(chunks, ["hello", " ", "world"]);
      } finally {
        await runtime.dispose();
      }
    });

    it("should iterate over ReadableStream wrapping host AsyncIterator", async () => {
      // This reproduces the AI SDK pattern where:
      // 1. Host provides an AsyncIterator via custom function
      // 2. Isolate creates a ReadableStream that consumes this iterator
      // 3. User code tries to iterate over the wrapped stream

      let chunkIndex = 0;
      const testChunks = [
        { type: "text", value: "Hello" },
        { type: "text", value: " " },
        { type: "text", value: "World" },
        { type: "done" },
      ];

      const runtime = await client.createRuntime({
        customFunctions: {
          getStreamIterator: {
            type: "asyncIterator" as const,
            fn: async function* () {
              for (const chunk of testChunks) {
                yield chunk;
              }
            },
          },
        },
      });

      try {
        await runtime.eval(`
          serve({
            fetch: async (request) => {
              // Create a ReadableStream that wraps the host's AsyncIterator
              // This is exactly what the AI SDK provider does
              const stream = new ReadableStream({
                async start(controller) {
                  const iterator = getStreamIterator();
                  for await (const chunk of iterator) {
                    if (chunk.type === "done") {
                      controller.close();
                    } else {
                      controller.enqueue(chunk.value);
                    }
                  }
                }
              });

              // Now try to iterate over this wrapped stream
              const chunks = [];
              for await (const chunk of stream) {
                chunks.push(chunk);
              }

              return new Response(JSON.stringify(chunks), {
                headers: { "Content-Type": "application/json" }
              });
            }
          });
        `);

        const response = await runtime.fetch.dispatchRequest(
          new Request("http://localhost/test")
        );
        const chunks = await response.json();

        assert.deepStrictEqual(chunks, ["Hello", " ", "World"]);
      } finally {
        await runtime.dispose();
      }
    });

    it("should read from wrapped stream using getReader()", async () => {
      // Alternative iteration pattern using reader.read()

      const testChunks = ["chunk1", "chunk2", "chunk3"];

      const runtime = await client.createRuntime({
        customFunctions: {
          getAsyncChunks: {
            type: "asyncIterator" as const,
            fn: async function* () {
              for (const chunk of testChunks) {
                yield chunk;
              }
            },
          },
        },
      });

      try {
        await runtime.eval(`
          serve({
            fetch: async (request) => {
              // Create wrapped stream
              const stream = new ReadableStream({
                async start(controller) {
                  for await (const chunk of getAsyncChunks()) {
                    controller.enqueue(chunk);
                  }
                  controller.close();
                }
              });

              // Read using getReader() instead of for-await
              const reader = stream.getReader();
              const chunks = [];

              while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                chunks.push(value);
              }

              return new Response(JSON.stringify(chunks), {
                headers: { "Content-Type": "application/json" }
              });
            }
          });
        `);

        const response = await runtime.fetch.dispatchRequest(
          new Request("http://localhost/test")
        );
        const chunks = await response.json();

        assert.deepStrictEqual(chunks, ["chunk1", "chunk2", "chunk3"]);
      } finally {
        await runtime.dispose();
      }
    });

    it("should handle TransformStream wrapping ReadableStream", async () => {
      // This simulates what the AI SDK does internally:
      // 1. Provider returns a ReadableStream
      // 2. AI SDK creates a TransformStream to transform chunks
      // 3. Pipes the provider stream through the TransformStream
      // 4. Returns the readable side of the TransformStream

      const runtime = await client.createRuntime({
        customFunctions: {
          getSourceChunks: {
            type: "asyncIterator" as const,
            fn: async function* () {
              yield { type: "delta", text: "Hello" };
              yield { type: "delta", text: " " };
              yield { type: "delta", text: "World" };
              yield { type: "finish" };
            },
          },
        },
      });

      try {
        await runtime.eval(`
          serve({
            fetch: async (request) => {
              // Create source stream (like AI SDK provider's doStream)
              const sourceStream = new ReadableStream({
                async start(controller) {
                  for await (const chunk of getSourceChunks()) {
                    controller.enqueue(chunk);
                    if (chunk.type === "finish") {
                      controller.close();
                    }
                  }
                }
              });

              // Create a TransformStream (like AI SDK's internal transformation)
              const transformStream = new TransformStream({
                transform(chunk, controller) {
                  if (chunk.type === "delta") {
                    controller.enqueue(chunk.text);
                  }
                  // Ignore finish chunks in output
                }
              });

              // Pipe source through transform
              const transformedStream = sourceStream.pipeThrough(transformStream);

              // Try to iterate over the transformed stream
              const chunks = [];
              for await (const chunk of transformedStream) {
                chunks.push(chunk);
              }

              return new Response(JSON.stringify(chunks), {
                headers: { "Content-Type": "application/json" }
              });
            }
          });
        `);

        const response = await runtime.fetch.dispatchRequest(
          new Request("http://localhost/test")
        );
        const chunks = await response.json();

        assert.deepStrictEqual(chunks, ["Hello", " ", "World"]);
      } finally {
        await runtime.dispose();
      }
    });

    it("should handle identity TransformStream (no transform function)", async () => {
      // This tests the AI SDK's createAsyncIterableStream pattern:
      // source.pipeThrough(new TransformStream<T, T>())
      // An identity TransformStream with no transform function should pass chunks through unchanged

      const runtime = await client.createRuntime({
        customFunctions: {
          getChunks: {
            type: "asyncIterator" as const,
            fn: async function* () {
              yield "chunk1";
              yield "chunk2";
              yield "chunk3";
            },
          },
        },
      });

      try {
        await runtime.eval(`
          serve({
            fetch: async (request) => {
              // Create source stream
              const sourceStream = new ReadableStream({
                async start(controller) {
                  for await (const chunk of getChunks()) {
                    controller.enqueue(chunk);
                  }
                  controller.close();
                }
              });

              // Pipe through IDENTITY TransformStream (no transform function)
              // This is what createAsyncIterableStream does
              const identityStream = sourceStream.pipeThrough(new TransformStream());

              // Iterate and collect chunks
              const chunks = [];
              for await (const chunk of identityStream) {
                chunks.push(chunk);
              }

              return new Response(JSON.stringify(chunks), {
                headers: { "Content-Type": "application/json" }
              });
            }
          });
        `);

        const response = await runtime.fetch.dispatchRequest(
          new Request("http://localhost/test")
        );
        const chunks = await response.json();

        // Should pass through all chunks unchanged
        assert.deepStrictEqual(chunks, ["chunk1", "chunk2", "chunk3"]);
      } finally {
        await runtime.dispose();
      }
    });

    it("should handle nested stream wrapping (AI SDK pattern)", async () => {
      // This is the full AI SDK pattern:
      // 1. Host AsyncIterator → ReadableStream (provider level)
      // 2. That stream → TransformStream (SDK level)
      // 3. Iterate over final stream (user level)

      const runtime = await client.createRuntime({
        customFunctions: {
          hostStreamIterator: {
            type: "asyncIterator" as const,
            fn: async function* () {
              yield { type: "start" };
              yield { type: "text-delta", delta: "Hi" };
              yield { type: "text-delta", delta: "!" };
              yield { type: "finish", reason: "stop" };
            },
          },
        },
      });

      try {
        await runtime.eval(`
          serve({
            fetch: async (request) => {
              // Layer 1: Wrap host iterator in ReadableStream (like ai-sdk-provider)
              const providerStream = new ReadableStream({
                async start(controller) {
                  for await (const chunk of hostStreamIterator()) {
                    controller.enqueue(chunk);
                    if (chunk.type === "finish") {
                      controller.close();
                    }
                  }
                }
              });

              // Layer 2: Transform stream (like AI SDK's textStream)
              const textTransform = new TransformStream({
                transform(chunk, controller) {
                  if (chunk.type === "text-delta") {
                    controller.enqueue(chunk.delta);
                  }
                }
              });

              const textStream = providerStream.pipeThrough(textTransform);

              // Layer 3: User iterates over textStream
              let text = "";
              for await (const chunk of textStream) {
                text += chunk;
              }

              return new Response(JSON.stringify({ text }), {
                headers: { "Content-Type": "application/json" }
              });
            }
          });
        `);

        const response = await runtime.fetch.dispatchRequest(
          new Request("http://localhost/test")
        );
        const result = await response.json();

        assert.deepStrictEqual(result, { text: "Hi!" });
      } finally {
        await runtime.dispose();
      }
    });

    it("should handle tee'd streams (multiple consumers)", async () => {
      // AI SDK provides multiple stream properties (textStream, fullStream, etc.)
      // which may internally tee the source stream

      const runtime = await client.createRuntime({
        customFunctions: {
          getChunks: {
            type: "asyncIterator" as const,
            fn: async function* () {
              yield "A";
              yield "B";
              yield "C";
            },
          },
        },
      });

      try {
        await runtime.eval(`
          serve({
            fetch: async (request) => {
              // Create source stream
              const source = new ReadableStream({
                async start(controller) {
                  for await (const chunk of getChunks()) {
                    controller.enqueue(chunk);
                  }
                  controller.close();
                }
              });

              // Tee the stream
              const [stream1, stream2] = source.tee();

              // Consume both streams
              const chunks1 = [];
              const chunks2 = [];

              // Read stream1
              for await (const chunk of stream1) {
                chunks1.push(chunk);
              }

              // Read stream2
              for await (const chunk of stream2) {
                chunks2.push(chunk);
              }

              return new Response(JSON.stringify({ chunks1, chunks2 }), {
                headers: { "Content-Type": "application/json" }
              });
            }
          });
        `);

        const response = await runtime.fetch.dispatchRequest(
          new Request("http://localhost/test")
        );
        const result = await response.json();

        assert.deepStrictEqual(result.chunks1, ["A", "B", "C"]);
        assert.deepStrictEqual(result.chunks2, ["A", "B", "C"]);
      } finally {
        await runtime.dispose();
      }
    });

    it("should handle lazy stream with background consumption", async () => {
      // AI SDK pattern: streamText() returns immediately, provider stream
      // starts consuming in background, user accesses textStream later

      const runtime = await client.createRuntime({
        customFunctions: {
          getSlowChunks: {
            type: "asyncIterator" as const,
            fn: async function* () {
              yield { type: "delta", text: "Hello" };
              // Simulate delay between chunks
              await new Promise(r => setTimeout(r, 10));
              yield { type: "delta", text: " World" };
              yield { type: "done" };
            },
          },
        },
      });

      try {
        await runtime.eval(`
          serve({
            fetch: async (request) => {
              // Simulate AI SDK's streamText result object
              function createStreamResult() {
                let resolveText;
                const textPromise = new Promise(r => { resolveText = r; });
                let fullText = "";

                // Source stream from provider
                const providerStream = new ReadableStream({
                  async start(controller) {
                    for await (const chunk of getSlowChunks()) {
                      controller.enqueue(chunk);
                      if (chunk.type === "delta") {
                        fullText += chunk.text;
                      }
                      if (chunk.type === "done") {
                        controller.close();
                        resolveText(fullText);
                      }
                    }
                  }
                });

                // Transform to text stream (lazy - created on access)
                let _textStream;
                const getTextStream = () => {
                  if (!_textStream) {
                    _textStream = providerStream.pipeThrough(new TransformStream({
                      transform(chunk, controller) {
                        if (chunk.type === "delta") {
                          controller.enqueue(chunk.text);
                        }
                      }
                    }));
                  }
                  return _textStream;
                };

                return {
                  get textStream() { return getTextStream(); },
                  get text() { return textPromise; },
                };
              }

              const result = createStreamResult();

              // Access textStream and iterate
              const chunks = [];
              for await (const chunk of result.textStream) {
                chunks.push(chunk);
              }

              return new Response(JSON.stringify({ chunks, text: await result.text }), {
                headers: { "Content-Type": "application/json" }
              });
            }
          });
        `);

        const response = await runtime.fetch.dispatchRequest(
          new Request("http://localhost/test")
        );
        const result = await response.json();

        assert.deepStrictEqual(result.chunks, ["Hello", " World"]);
        assert.strictEqual(result.text, "Hello World");
      } finally {
        await runtime.dispose();
      }
    });

    it("should handle concurrent stream consumption with Promise.all", async () => {
      // Test consuming stream while also awaiting the text promise

      const runtime = await client.createRuntime({
        customFunctions: {
          streamChunks: {
            type: "asyncIterator" as const,
            fn: async function* () {
              yield "X";
              yield "Y";
              yield "Z";
            },
          },
        },
      });

      try {
        await runtime.eval(`
          serve({
            fetch: async (request) => {
              let fullText = "";
              let resolveText;
              const textPromise = new Promise(r => { resolveText = r; });

              const source = new ReadableStream({
                async start(controller) {
                  for await (const chunk of streamChunks()) {
                    controller.enqueue(chunk);
                    fullText += chunk;
                  }
                  controller.close();
                  resolveText(fullText);
                }
              });

              // Consume stream and await text concurrently
              const streamChunksResult = [];
              const streamPromise = (async () => {
                for await (const chunk of source) {
                  streamChunksResult.push(chunk);
                }
                return streamChunksResult;
              })();

              const [chunks, text] = await Promise.all([streamPromise, textPromise]);

              return new Response(JSON.stringify({ chunks, text }), {
                headers: { "Content-Type": "application/json" }
              });
            }
          });
        `);

        const response = await runtime.fetch.dispatchRequest(
          new Request("http://localhost/test")
        );
        const result = await response.json();

        assert.deepStrictEqual(result.chunks, ["X", "Y", "Z"]);
        assert.strictEqual(result.text, "XYZ");
      } finally {
        await runtime.dispose();
      }
    });

    it("should handle stream where start() returns before iteration begins", async () => {
      // This tests the case where the ReadableStream constructor returns
      // before the async start() callback completes - the consumer starts
      // iterating while data is still being enqueued

      const runtime = await client.createRuntime({
        customFunctions: {
          delayedChunks: {
            type: "asyncIterator" as const,
            fn: async function* () {
              await new Promise(r => setTimeout(r, 50));
              yield "delayed1";
              await new Promise(r => setTimeout(r, 50));
              yield "delayed2";
            },
          },
        },
      });

      try {
        await runtime.eval(`
          serve({
            fetch: async (request) => {
              const stream = new ReadableStream({
                async start(controller) {
                  // This runs asynchronously after constructor returns
                  for await (const chunk of delayedChunks()) {
                    controller.enqueue(chunk);
                  }
                  controller.close();
                }
              });

              // Stream is returned immediately, iteration starts while
              // start() is still running
              const chunks = [];
              for await (const chunk of stream) {
                chunks.push(chunk);
              }

              return new Response(JSON.stringify(chunks), {
                headers: { "Content-Type": "application/json" }
              });
            }
          });
        `);

        const response = await runtime.fetch.dispatchRequest(
          new Request("http://localhost/test")
        );
        const chunks = await response.json();

        assert.deepStrictEqual(chunks, ["delayed1", "delayed2"]);
      } finally {
        await runtime.dispose();
      }
    });

    it("should handle AI SDK streamText() exact pattern", async () => {
      // This test replicates the EXACT pattern used by AI SDK's streamText():
      // 1. Provider's doStream() creates a ReadableStream wrapping host AsyncIterator
      // 2. AI SDK creates a result object with lazy textStream property
      // 3. User iterates over result.textStream
      // 4. result.text promise resolves when stream completes

      const runtime = await client.createRuntime({
        customFunctions: {
          __aiSdkStream: {
            type: "asyncIterator" as const,
            fn: async function* () {
              yield { type: "text-delta", textDelta: "Hello" };
              yield { type: "text-delta", textDelta: " " };
              yield { type: "text-delta", textDelta: "World" };
              yield { type: "finish", finishReason: "stop", usage: { promptTokens: 10, completionTokens: 5 } };
            },
          },
        },
      });

      try {
        await runtime.eval(`
          serve({
            fetch: async (request) => {
              // === PROVIDER LAYER (ai-sdk-provider.ts) ===
              // This is what streamAsync() does in the provider
              function createProviderStream(options) {
                return new ReadableStream({
                  async start(controller) {
                    controller.enqueue({ type: "stream-start", warnings: [] });
                    let textStarted = false;

                    for await (const chunk of __aiSdkStream(options)) {
                      if (chunk.type === "text-delta") {
                        if (!textStarted) {
                          controller.enqueue({ type: "text-start", id: "msg1" });
                          textStarted = true;
                        }
                        controller.enqueue({
                          type: "text-delta",
                          id: "msg1",
                          delta: chunk.textDelta,
                        });
                      } else if (chunk.type === "finish") {
                        if (textStarted) {
                          controller.enqueue({ type: "text-end", id: "msg1" });
                        }
                        controller.enqueue({
                          type: "finish",
                          finishReason: chunk.finishReason,
                          usage: chunk.usage,
                        });
                        controller.close();
                      }
                    }
                  },
                });
              }

              // === AI SDK LAYER (streamText internals) ===
              // This simulates what AI SDK does with the provider stream
              function streamText(options) {
                const providerStream = createProviderStream(options);

                // AI SDK creates internal state
                let fullText = "";
                let usage = null;
                let resolveText;
                let resolveUsage;
                const textPromise = new Promise(r => { resolveText = r; });
                const usagePromise = new Promise(r => { resolveUsage = r; });

                // AI SDK tees the stream for multiple consumers
                const [internalStream, userStream] = providerStream.tee();

                // AI SDK consumes one branch internally
                (async () => {
                  for await (const chunk of internalStream) {
                    if (chunk.type === "text-delta") {
                      fullText += chunk.delta;
                    } else if (chunk.type === "finish") {
                      usage = chunk.usage;
                      resolveText(fullText);
                      resolveUsage(usage);
                    }
                  }
                })();

                // AI SDK creates textStream by transforming user stream
                let _textStream;
                const getTextStream = () => {
                  if (!_textStream) {
                    _textStream = userStream.pipeThrough(new TransformStream({
                      transform(chunk, controller) {
                        if (chunk.type === "text-delta") {
                          controller.enqueue(chunk.delta);
                        }
                      }
                    }));
                  }
                  return _textStream;
                };

                return {
                  get textStream() { return getTextStream(); },
                  get text() { return textPromise; },
                  get usage() { return usagePromise; },
                };
              }

              // === USER LAYER (chat-stream.ts) ===
              const result = streamText({});

              // User iterates over textStream
              const chunks = [];
              for await (const chunk of result.textStream) {
                chunks.push(chunk);
              }

              // Wait for final values
              const text = await result.text;
              const usage = await result.usage;

              return new Response(JSON.stringify({ chunks, text, usage }), {
                headers: { "Content-Type": "application/json" }
              });
            }
          });
        `);

        const response = await runtime.fetch.dispatchRequest(
          new Request("http://localhost/test")
        );
        const result = await response.json();

        assert.deepStrictEqual(result.chunks, ["Hello", " ", "World"]);
        assert.strictEqual(result.text, "Hello World");
        assert.deepStrictEqual(result.usage, { promptTokens: 10, completionTokens: 5 });
      } finally {
        await runtime.dispose();
      }
    });

    it("should handle reader.cancel() on locked stream", async () => {
      // Test that reader.cancel() works even when stream is locked
      // (the stream's cancel() should reject when locked, but reader's cancel() should work)

      const runtime = await client.createRuntime();

      try {
        await runtime.eval(`
          serve({
            fetch: async (request) => {
              // Create a simple stream with finite data
              const stream = new ReadableStream({
                start(controller) {
                  controller.enqueue("chunk1");
                  controller.enqueue("chunk2");
                  controller.enqueue("chunk3");
                  // Don't close - leave it open so cancel has something to do
                }
              });

              const reader = stream.getReader();

              // Read one chunk
              const { value: firstChunk } = await reader.read();

              // Try to cancel via reader - this should NOT throw
              // "Cannot cancel a stream that has a reader"
              let cancelError = null;
              try {
                await reader.cancel('done reading');
              } catch (e) {
                cancelError = e.message;
              }

              // Also test that stream.cancel() DOES throw when locked
              const stream2 = new ReadableStream({
                start(controller) {
                  controller.enqueue("data");
                }
              });
              const reader2 = stream2.getReader();
              let streamCancelError = null;
              try {
                await stream2.cancel('test');
              } catch (e) {
                streamCancelError = e.message;
              }
              reader2.releaseLock();

              return new Response(JSON.stringify({
                firstChunk,
                readerCancelWorked: cancelError === null,
                readerCancelError: cancelError,
                streamCancelRejected: streamCancelError !== null,
                streamCancelError: streamCancelError
              }), {
                headers: { "Content-Type": "application/json" }
              });
            }
          });
        `);

        const response = await runtime.fetch.dispatchRequest(
          new Request("http://localhost/test")
        );
        const result = await response.json();

        // reader.cancel() should work (no error)
        assert.strictEqual(result.firstChunk, "chunk1");
        assert.strictEqual(result.readerCancelWorked, true);
        assert.strictEqual(result.readerCancelError, null);
        // stream.cancel() should reject when locked
        assert.strictEqual(result.streamCancelRejected, true);
        assert.ok(result.streamCancelError.includes("Cannot cancel a stream that has a reader"));
      } finally {
        await runtime.dispose();
      }
    });

    it("should handle tee + pipeThrough with concurrent iteration", async () => {
      // Test the specific pattern: tee a stream, pipe one branch through transform,
      // iterate over both concurrently (one internal, one user-facing)

      const runtime = await client.createRuntime({
        customFunctions: {
          getStreamParts: {
            type: "asyncIterator" as const,
            fn: async function* () {
              yield { type: "start" };
              yield { type: "data", value: 1 };
              yield { type: "data", value: 2 };
              yield { type: "data", value: 3 };
              yield { type: "end" };
            },
          },
        },
      });

      try {
        await runtime.eval(`
          serve({
            fetch: async (request) => {
              // Create source stream
              const source = new ReadableStream({
                async start(controller) {
                  for await (const chunk of getStreamParts()) {
                    controller.enqueue(chunk);
                    if (chunk.type === "end") {
                      controller.close();
                    }
                  }
                }
              });

              // Tee the stream
              const [stream1, stream2] = source.tee();

              // Transform stream2 to only get values
              const transformedStream = stream2.pipeThrough(new TransformStream({
                transform(chunk, controller) {
                  if (chunk.type === "data") {
                    controller.enqueue(chunk.value);
                  }
                }
              }));

              // Start consuming stream1 in background (internal consumption)
              let internalComplete = false;
              const internalChunks = [];
              const internalPromise = (async () => {
                for await (const chunk of stream1) {
                  internalChunks.push(chunk);
                }
                internalComplete = true;
              })();

              // Iterate over transformed stream (user consumption)
              const userChunks = [];
              for await (const chunk of transformedStream) {
                userChunks.push(chunk);
              }

              // Wait for internal consumption
              await internalPromise;

              return new Response(JSON.stringify({
                userChunks,
                internalChunks,
                internalComplete
              }), {
                headers: { "Content-Type": "application/json" }
              });
            }
          });
        `);

        const response = await runtime.fetch.dispatchRequest(
          new Request("http://localhost/test")
        );
        const result = await response.json();

        assert.deepStrictEqual(result.userChunks, [1, 2, 3]);
        assert.strictEqual(result.internalChunks.length, 5); // start, data, data, data, end
        assert.strictEqual(result.internalComplete, true);
      } finally {
        await runtime.dispose();
      }
    });
  });
});
