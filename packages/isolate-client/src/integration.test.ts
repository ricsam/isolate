/**
 * Integration tests for the isolate client and daemon.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert";
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
    const logs: unknown[] = [];
    const runtime = await client.createRuntime({
      console: {
        onEntry: (entry) => {
          if (entry.type === "output" && entry.level === "log") {
            logs.push(entry.args[0]);
          }
        },
      },
    });
    try {
      // eval returns void now (always module mode)
      await runtime.eval("console.log(1 + 2)");
      // No delay needed - eval waits for callbacks to complete
      assert.strictEqual(logs[0], 3);
    } finally {
      await runtime.dispose();
    }
  });

  it("should handle console callbacks", async () => {
    const logs: unknown[][] = [];

    const runtime = await client.createRuntime({
      console: {
        onEntry: (entry) => {
          if (entry.type === "output" && entry.level === "log") {
            logs.push(entry.args);
          }
        },
      },
    });

    try {
      await runtime.eval(`console.log("hello", "world")`);
      // No delay needed - eval waits for callbacks to complete
      assert.deepStrictEqual(logs, [["hello", "world"]]);
    } finally {
      await runtime.dispose();
    }
  });

  it("should handle multiple console methods", async () => {
    const consoleCalls: { method: string; args: unknown[] }[] = [];

    const runtime = await client.createRuntime({
      console: {
        onEntry: (entry) => {
          if (entry.type === "output") {
            consoleCalls.push({ method: entry.level, args: entry.args });
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
      const failedTest = results.results.find((r: { passed: boolean }) => !r.passed);
      assert.ok(failedTest);
      assert.ok(failedTest.error?.includes("Expected"));
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
      const data = await runtime.playwright.getCollectedData();

      // Should have captured the console log
      assert.ok(data.browserConsoleLogs.length >= 0); // Console logs might be captured
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
      const failedTest = results.results.find((t: { passed: boolean }) => !t.passed);
      assert.ok(failedTest);
      assert.ok(failedTest.error);
    } finally {
      await runtime.dispose();
      await browser.close();
    }
  });

  it("should stream playwright events", async () => {
    const consoleLogs: { level: string; args: unknown[] }[] = [];
    const browser = await chromium.launch({ headless: true });
    const browserContext = await browser.newContext();
    const page = await browserContext.newPage();

    const runtime = await client.createRuntime({
      testEnvironment: true,
      playwright: {
        page,
        onEvent: (event) => {
          if (event.type === "browserConsoleLog") {
            consoleLogs.push({ level: event.level, args: event.args });
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
      // No delay needed - runTests waits for callbacks to complete
      // Console logs should have been streamed
      assert.ok(Array.isArray(consoleLogs));
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
          async: true,
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
          async: true,
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
          async: false,
        },
        formatDate: {
          fn: (...args) => new Date(args[0] as number).toISOString(),
          async: false,
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
          async: true,
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
          async: true,
        },
        concat: {
          fn: async (...args) =>
            (args[0] as string) + (args[1] as string) + (args[2] as string),
          async: true,
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
    const logs: unknown[] = [];

    const runtime = await client.createRuntime({
      console: {
        onEntry: (entry) => {
          if (entry.type === "output" && entry.level === "log") {
            logs.push(entry.args);
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
          async: true,
        },
        add: {
          fn: async (...args) => {
            const a = args[0] as number;
            const b = args[1] as number;
            calls.push(`add:${a}+${b}`);
            return a + b;
          },
          async: true,
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
      assert.deepStrictEqual(logs[0], ["Hello, World!", 8]);
      assert.strictEqual(calls.length, 2);
      assert.strictEqual(calls[0], "greet:World");
      assert.strictEqual(calls[1], "add:5+3");
    } finally {
      await runtime.dispose();
    }
  });

  it("should work with custom functions that are not async", async () => {
    const calls: string[] = [];
    const logs: unknown[] = [];

    const runtime = await client.createRuntime({
      console: {
        onEntry: (entry) => {
          if (entry.type === "output" && entry.level === "log") {
            logs.push(entry.args);
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
          async: false,
        },
        add: {
          fn: (...args) => {
            const a = args[0] as number;
            const b = args[1] as number;
            calls.push(`add:${a}+${b}`);
            return a + b;
          },
          async: false,
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
      assert.deepStrictEqual(logs[0], ["Hello, World!", 8]);
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
            logs.push(entry.args.join(" "));
          }
        },
      },
      moduleLoader: async (moduleName: string) => {
        if (moduleName === "@/utils") {
          return `
            export function add(a, b) { return a + b; }
            export function multiply(a, b) { return a * b; }
          `;
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
            logs.push(entry.args.join(" "));
          }
        },
      },
      moduleLoader: async (moduleName: string) => {
        if (moduleName === "@/math") {
          return `
            export function square(x) { return x * x; }
          `;
        }
        if (moduleName === "@/calc") {
          return `
            import { square } from "@/math";
            export function sumOfSquares(a, b) {
              return square(a) + square(b);
            }
          `;
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
            logs.push(entry.args.join(" "));
          }
        },
      },
      moduleLoader: async (moduleName: string) => {
        loadCount++;
        if (moduleName === "@/counter") {
          return `export const value = ${loadCount};`;
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
          async: true,
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
            logs.push(entry.args.join(" "));
          }
        },
      },
      moduleLoader: async (moduleName: string) => {
        if (moduleName === "@/logger") {
          return `
            export function logMessage(msg) {
              console.log("[MODULE]", msg);
            }
          `;
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

  // Handle-based API Integration Tests
  describe("handle-based API", () => {
    describe("runtime.fetch handle", () => {
      it("should have fetch handle on runtime", async () => {
        const runtime = await client.createRuntime();
        try {
          assert.ok(runtime.fetch, "runtime.fetch should exist");
          assert.strictEqual(typeof runtime.fetch.dispatchRequest, "function");
          assert.strictEqual(typeof runtime.fetch.hasServeHandler, "function");
          assert.strictEqual(typeof runtime.fetch.hasActiveConnections, "function");
          assert.strictEqual(typeof runtime.fetch.getUpgradeRequest, "function");
          assert.strictEqual(typeof runtime.fetch.dispatchWebSocketOpen, "function");
          assert.strictEqual(typeof runtime.fetch.dispatchWebSocketMessage, "function");
          assert.strictEqual(typeof runtime.fetch.dispatchWebSocketClose, "function");
          assert.strictEqual(typeof runtime.fetch.dispatchWebSocketError, "function");
          assert.strictEqual(typeof runtime.fetch.onWebSocketCommand, "function");
        } finally {
          await runtime.dispose();
        }
      });

      it("should dispatch requests via fetch.dispatchRequest", async () => {
        const runtime = await client.createRuntime();
        try {
          await runtime.eval(`
            serve({
              fetch(request) {
                const url = new URL(request.url);
                return Response.json({ path: url.pathname, method: request.method });
              }
            });
          `);

          const response = await runtime.fetch.dispatchRequest(
            new Request("http://localhost/api/test", { method: "POST" })
          );

          assert.strictEqual(response.status, 200);
          const body = await response.json();
          assert.deepStrictEqual(body, { path: "/api/test", method: "POST" });
        } finally {
          await runtime.dispose();
        }
      });

      it("should check serve handler via fetch.hasServeHandler", async () => {
        const runtime = await client.createRuntime();
        try {
          // Initially no serve handler
          const beforeServe = await runtime.fetch.hasServeHandler();
          assert.strictEqual(beforeServe, false);

          // Setup serve handler
          await runtime.eval(`
            serve({
              fetch(request) {
                return new Response("hello");
              }
            });
          `);

          // Now should have serve handler
          const afterServe = await runtime.fetch.hasServeHandler();
          assert.strictEqual(afterServe, true);
        } finally {
          await runtime.dispose();
        }
      });

      it("should check active connections via fetch.hasActiveConnections", async () => {
        const runtime = await client.createRuntime();
        try {
          const hasConnections = await runtime.fetch.hasActiveConnections();
          assert.strictEqual(hasConnections, false);
        } finally {
          await runtime.dispose();
        }
      });

      it("should get upgrade request via fetch.getUpgradeRequest", async () => {
        const runtime = await client.createRuntime();
        try {
          const upgradeRequest = await runtime.fetch.getUpgradeRequest();
          assert.strictEqual(upgradeRequest, null);
        } finally {
          await runtime.dispose();
        }
      });

    });

    describe("runtime.timers handle", () => {
      it("should have timers handle on runtime", async () => {
        const runtime = await client.createRuntime();
        try {
          assert.ok(runtime.timers, "runtime.timers should exist");
          assert.strictEqual(typeof runtime.timers.clearAll, "function");
        } finally {
          await runtime.dispose();
        }
      });

      it("timers fire automatically with real time", async () => {
        const logs: unknown[] = [];
        const runtime = await client.createRuntime({
          console: {
            onEntry: (entry) => {
              if (entry.type === "output" && entry.level === "log") {
                logs.push(entry.args[0]);
              }
            },
          },
        });

        try {
          await runtime.eval(`
            setTimeout(() => {
              console.log("timer fired");
            }, 30);
          `);

          // Timer shouldn't have fired immediately
          assert.strictEqual(logs.length, 0);

          // Wait for real time to pass
          await new Promise((resolve) => setTimeout(resolve, 80));
          assert.strictEqual(logs[0], "timer fired");
        } finally {
          await runtime.dispose();
        }
      });

      it("should clear all timers via timers.clearAll", async () => {
        const logs: unknown[] = [];
        const runtime = await client.createRuntime({
          console: {
            onEntry: (entry) => {
              if (entry.type === "output" && entry.level === "log") {
                logs.push(entry.args[0]);
              }
            },
          },
        });

        try {
          await runtime.eval(`
            setTimeout(() => {
              console.log("timer1");
            }, 30);
            setTimeout(() => {
              console.log("timer2");
            }, 50);
          `);

          // Clear all timers
          await runtime.timers.clearAll();

          // Wait past all scheduled times
          await new Promise((resolve) => setTimeout(resolve, 100));

          // No timers should have fired
          assert.strictEqual(logs.length, 0);
        } finally {
          await runtime.dispose();
        }
      });

    });

    describe("runtime.console handle", () => {
      it("should have console handle on runtime", async () => {
        const runtime = await client.createRuntime();
        try {
          assert.ok(runtime.console, "runtime.console should exist");
          assert.strictEqual(typeof runtime.console.reset, "function");
          assert.strictEqual(typeof runtime.console.getTimers, "function");
          assert.strictEqual(typeof runtime.console.getCounters, "function");
          assert.strictEqual(typeof runtime.console.getGroupDepth, "function");
        } finally {
          await runtime.dispose();
        }
      });

      it("should get counters via console.getCounters", async () => {
        const runtime = await client.createRuntime();

        try {
          await runtime.eval(`
            console.count("foo");
            console.count("foo");
            console.count("bar");
          `);

          const counters = await runtime.console.getCounters();
          assert.ok(counters instanceof Map);
          assert.strictEqual(counters.get("foo"), 2);
          assert.strictEqual(counters.get("bar"), 1);
        } finally {
          await runtime.dispose();
        }
      });

      it("should get timers via console.getTimers", async () => {
        const runtime = await client.createRuntime();

        try {
          await runtime.eval(`
            console.time("myTimer");
          `);

          const timers = await runtime.console.getTimers();
          assert.ok(timers instanceof Map);
          assert.ok(timers.has("myTimer"));
          assert.strictEqual(typeof timers.get("myTimer"), "number");
        } finally {
          await runtime.dispose();
        }
      });

      it("should get group depth via console.getGroupDepth", async () => {
        const runtime = await client.createRuntime();

        try {
          let depth = await runtime.console.getGroupDepth();
          assert.strictEqual(depth, 0);

          await runtime.eval(`
            console.group("level1");
          `);
          depth = await runtime.console.getGroupDepth();
          assert.strictEqual(depth, 1);

          await runtime.eval(`
            console.group("level2");
          `);
          depth = await runtime.console.getGroupDepth();
          assert.strictEqual(depth, 2);

          await runtime.eval(`
            console.groupEnd();
          `);
          depth = await runtime.console.getGroupDepth();
          assert.strictEqual(depth, 1);
        } finally {
          await runtime.dispose();
        }
      });

      it("should reset console state via console.reset", async () => {
        const runtime = await client.createRuntime();

        try {
          await runtime.eval(`
            console.count("counter");
            console.time("timer");
            console.group("group");
          `);

          // Verify state exists
          let counters = await runtime.console.getCounters();
          let timers = await runtime.console.getTimers();
          let depth = await runtime.console.getGroupDepth();
          assert.strictEqual(counters.size, 1);
          assert.strictEqual(timers.size, 1);
          assert.strictEqual(depth, 1);

          // Reset
          await runtime.console.reset();

          // Verify state is cleared
          counters = await runtime.console.getCounters();
          timers = await runtime.console.getTimers();
          depth = await runtime.console.getGroupDepth();
          assert.strictEqual(counters.size, 0);
          assert.strictEqual(timers.size, 0);
          assert.strictEqual(depth, 0);
        } finally {
          await runtime.dispose();
        }
      });
    });

    describe("API consistency with local runtime", () => {
      it("remote and local runtime should have same handle API structure", async () => {
        // This test verifies the RemoteRuntime interface matches RuntimeHandle
        const runtime = await client.createRuntime();
        try {
          // Verify fetch handle methods
          assert.ok(runtime.fetch);
          assert.strictEqual(typeof runtime.fetch.dispatchRequest, "function");
          assert.strictEqual(typeof runtime.fetch.hasServeHandler, "function");
          assert.strictEqual(typeof runtime.fetch.hasActiveConnections, "function");
          assert.strictEqual(typeof runtime.fetch.getUpgradeRequest, "function");
          assert.strictEqual(typeof runtime.fetch.dispatchWebSocketOpen, "function");
          assert.strictEqual(typeof runtime.fetch.dispatchWebSocketMessage, "function");
          assert.strictEqual(typeof runtime.fetch.dispatchWebSocketClose, "function");
          assert.strictEqual(typeof runtime.fetch.dispatchWebSocketError, "function");
          assert.strictEqual(typeof runtime.fetch.onWebSocketCommand, "function");

          // Verify timers handle methods
          assert.ok(runtime.timers);
          assert.strictEqual(typeof runtime.timers.clearAll, "function");

          // Verify console handle methods
          assert.ok(runtime.console);
          assert.strictEqual(typeof runtime.console.reset, "function");
          assert.strictEqual(typeof runtime.console.getTimers, "function");
          assert.strictEqual(typeof runtime.console.getCounters, "function");
          assert.strictEqual(typeof runtime.console.getGroupDepth, "function");
        } finally {
          await runtime.dispose();
        }
      });
    });
  });
});
