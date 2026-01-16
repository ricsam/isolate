import { test, describe } from "node:test";
import assert from "node:assert";
import {
  createRuntime,
  simpleConsoleHandler,
  type RuntimeHandle,
  type ConsoleEntry,
} from "./index.ts";

describe("@ricsam/isolate-runtime", () => {
  describe("createRuntime (new unified API)", () => {
    test("creates runtime with id", async () => {
      const runtime = await createRuntime();
      try {
        assert(runtime.id, "runtime should have an id");
        assert.match(
          runtime.id,
          /^[0-9a-f-]{36}$/,
          "id should be a valid UUID"
        );
        assert(typeof runtime.eval === "function", "eval should be a function");
        assert(
          typeof runtime.dispose === "function",
          "dispose should be a function"
        );
        assert.ok(runtime.fetch, "runtime.fetch should exist");
        assert.ok(runtime.timers, "runtime.timers should exist");
        assert.ok(runtime.console, "runtime.console should exist");
      } finally {
        await runtime.dispose();
      }
    });

    test("eval executes code as ES module", async () => {
      let logValue: string | null = null;
      const runtime = await createRuntime({
        console: {
          onEntry: (entry) => {
            if (entry.type === "output" && entry.level === "log") {
              logValue = entry.args[0] as string;
            }
          },
        },
      });

      try {
        await runtime.eval(`console.log("hello from module");`);
        assert.strictEqual(logValue, "hello from module");
      } finally {
        await runtime.dispose();
      }
    });

    test("eval supports top-level await", async () => {
      let logValue: string | null = null;
      const runtime = await createRuntime({
        console: {
          onEntry: (entry) => {
            if (entry.type === "output" && entry.level === "log") {
              logValue = entry.args[0] as string;
            }
          },
        },
      });

      try {
        await runtime.eval(`
          const result = await Promise.resolve("async result");
          console.log(result);
        `);
        assert.strictEqual(logValue, "async result");
      } finally {
        await runtime.dispose();
      }
    });

    test("eval returns void (modules don't return values)", async () => {
      const runtime = await createRuntime();
      try {
        const result = await runtime.eval(`1 + 1`);
        assert.strictEqual(result, undefined, "eval should return undefined");
      } finally {
        await runtime.dispose();
      }
    });

    test("dispose is async", async () => {
      const runtime = await createRuntime();
      const disposeResult = runtime.dispose();
      assert(
        disposeResult instanceof Promise,
        "dispose should return a Promise"
      );
      await disposeResult;
    });

    test("accepts memory limit option", async () => {
      const runtime = await createRuntime({
        memoryLimitMB: 128,
      });
      try {
        assert(runtime.id, "runtime should be created with memory limit");
      } finally {
        await runtime.dispose();
      }
    });
  });

  describe("moduleLoader", () => {
    test("module imports work with moduleLoader", async () => {
      let logValue: unknown = null;
      const runtime = await createRuntime({
        console: {
          onEntry: (entry) => {
            if (entry.type === "output" && entry.level === "log") {
              logValue = entry.args[0];
            }
          },
        },
        moduleLoader: async (moduleName) => {
          if (moduleName === "@/utils") {
            return `
              export function add(a, b) {
                return a + b;
              }
              export function multiply(a, b) {
                return a * b;
              }
            `;
          }
          throw new Error(`Unknown module: ${moduleName}`);
        },
      });

      try {
        await runtime.eval(`
          import { add, multiply } from "@/utils";
          console.log(add(2, 3));
        `);
        assert.strictEqual(logValue, 5);
      } finally {
        await runtime.dispose();
      }
    });

    test("nested module imports work", async () => {
      let logValue: unknown = null;
      const runtime = await createRuntime({
        console: {
          onEntry: (entry) => {
            if (entry.type === "output" && entry.level === "log") {
              logValue = entry.args[0];
            }
          },
        },
        moduleLoader: async (moduleName) => {
          if (moduleName === "@/math") {
            return `
              import { constant } from "@/constants";
              export function addWithConstant(x) {
                return x + constant;
              }
            `;
          }
          if (moduleName === "@/constants") {
            return `export const constant = 10;`;
          }
          throw new Error(`Unknown module: ${moduleName}`);
        },
      });

      try {
        await runtime.eval(`
          import { addWithConstant } from "@/math";
          console.log(addWithConstant(5));
        `);
        assert.strictEqual(logValue, 15);
      } finally {
        await runtime.dispose();
      }
    });

    test("module cache prevents duplicate loads", async () => {
      let loadCount = 0;
      const runtime = await createRuntime({
        moduleLoader: async (moduleName) => {
          if (moduleName === "@/counter") {
            loadCount++;
            return `export const count = ${loadCount};`;
          }
          throw new Error(`Unknown module: ${moduleName}`);
        },
      });

      try {
        // Import the same module twice
        await runtime.eval(`
          import { count as count1 } from "@/counter";
          globalThis.count1 = count1;
        `);
        await runtime.eval(`
          import { count as count2 } from "@/counter";
          globalThis.count2 = count2;
        `);

        // Module should only be loaded once due to caching
        assert.strictEqual(loadCount, 1, "module should only be loaded once");
      } finally {
        await runtime.dispose();
      }
    });
  });

  describe("customFunctions", () => {
    test("custom functions are callable from isolate", async () => {
      let logValue: unknown = null;
      const runtime = await createRuntime({
        console: {
          onEntry: (entry) => {
            if (entry.type === "output" && entry.level === "log") {
              logValue = entry.args[0];
            }
          },
        },
        customFunctions: {
          addNumbers: {
            fn: async (a: unknown, b: unknown) => {
              return (a as number) + (b as number);
            },
            type: 'async',
          },
        },
      });

      try {
        await runtime.eval(`
          const result = await addNumbers(10, 20);
          console.log(result);
        `);
        assert.strictEqual(logValue, 30);
      } finally {
        await runtime.dispose();
      }
    });

    test("custom functions can be sync", async () => {
      let logValue: unknown = null;
      const runtime = await createRuntime({
        console: {
          onEntry: (entry) => {
            if (entry.type === "output" && entry.level === "log") {
              logValue = entry.args[0];
            }
          },
        },
        customFunctions: {
          getConfig: {
            fn: () => ({ key: "value" }),
            type: 'sync',
          },
        },
      });

      try {
        await runtime.eval(`
          const config = getConfig();
          console.log(config.key);
        `);
        assert.strictEqual(logValue, "value");
      } finally {
        await runtime.dispose();
      }
    });

    test("custom function errors propagate", async () => {
      const runtime = await createRuntime({
        customFunctions: {
          throwError: {
            fn: async () => {
              throw new Error("Custom error message");
            },
            type: 'async',
          },
        },
      });

      try {
        await assert.rejects(
          async () => {
            await runtime.eval(`
              await throwError();
            `);
          },
          /Custom error message/,
          "error should propagate from custom function"
        );
      } finally {
        await runtime.dispose();
      }
    });

    test("async iterator yields values", async () => {
      let logValue: unknown = null;
      const runtime = await createRuntime({
        console: {
          onEntry: (entry) => {
            if (entry.type === "output" && entry.level === "log") {
              logValue = entry.args[0];
            }
          },
        },
        customFunctions: {
          countUp: {
            fn: async function* (max: unknown) {
              for (let i = 0; i < (max as number); i++) yield i;
            },
            type: 'asyncIterator',
          },
        },
      });

      try {
        await runtime.eval(`
          const arr = [];
          for await (const n of countUp(3)) arr.push(n);
          console.log(arr);
        `);
        assert.deepStrictEqual(logValue, [0, 1, 2]);
      } finally {
        await runtime.dispose();
      }
    });

    test("async iterator cleanup on break", async () => {
      let cleaned = false;
      const runtime = await createRuntime({
        customFunctions: {
          infinite: {
            fn: async function* () {
              try { while (true) yield 1; }
              finally { cleaned = true; }
            },
            type: 'asyncIterator',
          },
        },
      });

      try {
        await runtime.eval(`for await (const n of infinite()) break;`);
        assert.strictEqual(cleaned, true);
      } finally {
        await runtime.dispose();
      }
    });

    test("async iterator error propagation", async () => {
      const runtime = await createRuntime({
        customFunctions: {
          failing: {
            fn: async function* () {
              yield 1;
              throw new Error("Stream failed");
            },
            type: 'asyncIterator',
          },
        },
      });

      try {
        await assert.rejects(
          async () => {
            await runtime.eval(`
              for await (const n of failing()) {}
            `);
          },
          /Stream failed/
        );
      } finally {
        await runtime.dispose();
      }
    });
  });

  describe("console integration", () => {
    test("console.log is captured", async () => {
      const entries: ConsoleEntry[] = [];

      const runtime = await createRuntime({
        console: {
          onEntry: (entry) => entries.push(entry),
        },
      });

      try {
        await runtime.eval(`
          console.log("hello", "world");
          console.warn("warning message");
          console.error("error message");
        `);

        const outputEntries = entries.filter((e) => e.type === "output");
        assert.strictEqual(outputEntries.length, 3, "should have captured 3 logs");

        const logEntry = outputEntries[0] as { type: "output"; level: string; args: unknown[] };
        assert.strictEqual(logEntry.level, "log");
        assert.deepStrictEqual(logEntry.args, ["hello", "world"]);

        const warnEntry = outputEntries[1] as { type: "output"; level: string; args: unknown[] };
        assert.strictEqual(warnEntry.level, "warn");
        assert.deepStrictEqual(warnEntry.args, ["warning message"]);

        const errorEntry = outputEntries[2] as { type: "output"; level: string; args: unknown[] };
        assert.strictEqual(errorEntry.level, "error");
        assert.deepStrictEqual(errorEntry.args, ["error message"]);
      } finally {
        await runtime.dispose();
      }
    });

    test("simpleConsoleHandler routes to level callbacks", async () => {
      const logs: unknown[][] = [];
      const warns: unknown[][] = [];
      const errors: unknown[][] = [];

      const runtime = await createRuntime({
        console: simpleConsoleHandler({
          log: (...args) => logs.push(args),
          warn: (...args) => warns.push(args),
          error: (...args) => errors.push(args),
        }),
      });

      try {
        await runtime.eval(`
          console.log("log message", 1);
          console.warn("warn message", 2);
          console.error("error message", 3);
        `);

        assert.deepStrictEqual(logs, [["log message", 1]]);
        assert.deepStrictEqual(warns, [["warn message", 2]]);
        assert.deepStrictEqual(errors, [["error message", 3]]);
      } finally {
        await runtime.dispose();
      }
    });
  });

  describe("fetch integration", () => {
    test("fetch calls handler", async () => {
      let capturedUrl: string | null = null;
      let logValue: unknown = null;

      const runtime = await createRuntime({
        console: {
          onEntry: (entry) => {
            if (entry.type === "output" && entry.level === "log") {
              logValue = entry.args[0];
            }
          },
        },
        fetch: async (request) => {
          capturedUrl = request.url;
          return new Response(JSON.stringify({ message: "mocked" }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        },
      });

      try {
        await runtime.eval(`
          const response = await fetch("https://example.com/api");
          const data = await response.json();
          console.log(data.message);
        `);

        assert.strictEqual(logValue, "mocked");
        assert.strictEqual(capturedUrl, "https://example.com/api");
      } finally {
        await runtime.dispose();
      }
    });
  });

  describe("serve and dispatchRequest", () => {
    test("fetch.dispatchRequest works with serve handler", async () => {
      const runtime = await createRuntime();

      try {
        await runtime.eval(`
          serve({
            fetch(request) {
              const url = new URL(request.url);
              return Response.json({ path: url.pathname });
            }
          });
        `);

        const response = await runtime.fetch.dispatchRequest(
          new Request("http://localhost/api/test")
        );

        assert.strictEqual(response.status, 200);
        const body = await response.json();
        assert.deepStrictEqual(body, { path: "/api/test" });
      } finally {
        await runtime.dispose();
      }
    });

    test("fetch.dispatchRequest handles async serve handlers", async () => {
      let logValue: unknown = null;
      const runtime = await createRuntime({
        console: {
          onEntry: (entry) => {
            if (entry.type === "output" && entry.level === "log") {
              logValue = entry.args[0];
            }
          },
        },
      });

      try {
        await runtime.eval(`
          serve({
            async fetch(request) {
              console.log("handling request");
              await Promise.resolve();
              return new Response("async response");
            }
          });
        `);

        const response = await runtime.fetch.dispatchRequest(
          new Request("http://localhost/")
        );

        assert.strictEqual(logValue, "handling request");
        assert.strictEqual(await response.text(), "async response");
      } finally {
        await runtime.dispose();
      }
    });
  });

  describe("timers integration", () => {
    test("setTimeout fires automatically with real time", async () => {
      let logValue: unknown = null;
      const runtime = await createRuntime({
        console: {
          onEntry: (entry) => {
            if (entry.type === "output" && entry.level === "log") {
              logValue = entry.args[0];
            }
          },
        },
      });

      try {
        await runtime.eval(`
          globalThis.timerFired = false;
          setTimeout(() => {
            globalThis.timerFired = true;
            console.log("timer fired");
          }, 20);
        `);

        // Timer should not have fired immediately
        assert.strictEqual(logValue, null);

        // Wait for real time to pass
        await new Promise((r) => setTimeout(r, 50));
        assert.strictEqual(logValue, "timer fired");
      } finally {
        await runtime.dispose();
      }
    });
  });

  describe("GC disposal", () => {
    test("resources are cleaned up on dispose", async () => {
      const runtime = await createRuntime();

      // Create some resources
      await runtime.eval(`
        const blob = new Blob(["test"]);
        const url = new URL("https://example.com");
      `);

      // Dispose should not throw
      await runtime.dispose();

      // After dispose, attempting to use the runtime should fail
      await assert.rejects(
        async () => {
          await runtime.eval(`1 + 1`);
        },
        /released|disposed/i,
        "runtime should be disposed"
      );
    });
  });

  describe("handle-based API", () => {
    describe("runtime.fetch handle", () => {
      test("fetch handle exists on runtime", async () => {
        const runtime = await createRuntime();
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

      test("fetch.dispatchRequest works with serve handler", async () => {
        const runtime = await createRuntime();
        try {
          await runtime.eval(`
            serve({
              fetch(request) {
                const url = new URL(request.url);
                return Response.json({ path: url.pathname });
              }
            });
          `);

          const response = await runtime.fetch.dispatchRequest(
            new Request("http://localhost/api/test")
          );

          assert.strictEqual(response.status, 200);
          const body = await response.json();
          assert.deepStrictEqual(body, { path: "/api/test" });
        } finally {
          await runtime.dispose();
        }
      });

      test("fetch.hasServeHandler returns false when no serve() called", async () => {
        const runtime = await createRuntime();
        try {
          assert.strictEqual(runtime.fetch.hasServeHandler(), false);
        } finally {
          await runtime.dispose();
        }
      });

      test("fetch.hasServeHandler returns true after serve() called", async () => {
        const runtime = await createRuntime();
        try {
          await runtime.eval(`
            serve({
              fetch(request) {
                return new Response("hello");
              }
            });
          `);
          assert.strictEqual(runtime.fetch.hasServeHandler(), true);
        } finally {
          await runtime.dispose();
        }
      });

      test("fetch.hasActiveConnections returns false when no connections", async () => {
        const runtime = await createRuntime();
        try {
          assert.strictEqual(runtime.fetch.hasActiveConnections(), false);
        } finally {
          await runtime.dispose();
        }
      });

      test("fetch.getUpgradeRequest returns null when no upgrade pending", async () => {
        const runtime = await createRuntime();
        try {
          assert.strictEqual(runtime.fetch.getUpgradeRequest(), null);
        } finally {
          await runtime.dispose();
        }
      });
    });

    describe("runtime.timers handle", () => {
      test("timers handle exists on runtime", async () => {
        const runtime = await createRuntime();
        try {
          assert.ok(runtime.timers, "runtime.timers should exist");
          assert.strictEqual(typeof runtime.timers.clearAll, "function");
        } finally {
          await runtime.dispose();
        }
      });

      test("timers fire automatically with real time", async () => {
        let logValue: unknown = null;
        const runtime = await createRuntime({
          console: {
            onEntry: (entry) => {
              if (entry.type === "output" && entry.level === "log") {
                logValue = entry.args[0];
              }
            },
          },
        });

        try {
          await runtime.eval(`
            setTimeout(() => {
              console.log("timer fired");
            }, 20);
          `);

          // Timer should not have fired immediately
          assert.strictEqual(logValue, null);

          // Wait for real time to pass
          await new Promise((r) => setTimeout(r, 50));
          assert.strictEqual(logValue, "timer fired");
        } finally {
          await runtime.dispose();
        }
      });

      test("timers.clearAll clears all pending timers", async () => {
        let logValue: unknown = null;
        const runtime = await createRuntime({
          console: {
            onEntry: (entry) => {
              if (entry.type === "output" && entry.level === "log") {
                logValue = entry.args[0];
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
            }, 40);
            setInterval(() => {
              console.log("interval");
            }, 20);
          `);

          // Clear all timers
          runtime.timers.clearAll();

          // Wait past all scheduled times
          await new Promise((r) => setTimeout(r, 80));

          // No timers should have fired
          assert.strictEqual(logValue, null);
        } finally {
          await runtime.dispose();
        }
      });

    });

    describe("runtime.console handle", () => {
      test("console handle exists on runtime", async () => {
        const runtime = await createRuntime();
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

      test("console.getCounters returns counter state", async () => {
        const runtime = await createRuntime();

        try {
          await runtime.eval(`
            console.count("foo");
            console.count("foo");
            console.count("bar");
          `);

          const counters = runtime.console.getCounters();
          assert.ok(counters instanceof Map);
          assert.strictEqual(counters.get("foo"), 2);
          assert.strictEqual(counters.get("bar"), 1);
        } finally {
          await runtime.dispose();
        }
      });

      test("console.getTimers returns timer state", async () => {
        const runtime = await createRuntime();

        try {
          await runtime.eval(`
            console.time("myTimer");
          `);

          const timers = runtime.console.getTimers();
          assert.ok(timers instanceof Map);
          assert.ok(timers.has("myTimer"));
          assert.strictEqual(typeof timers.get("myTimer"), "number");
        } finally {
          await runtime.dispose();
        }
      });

      test("console.getGroupDepth returns group nesting depth", async () => {
        const runtime = await createRuntime();

        try {
          assert.strictEqual(runtime.console.getGroupDepth(), 0);

          await runtime.eval(`
            console.group("level1");
          `);
          assert.strictEqual(runtime.console.getGroupDepth(), 1);

          await runtime.eval(`
            console.group("level2");
          `);
          assert.strictEqual(runtime.console.getGroupDepth(), 2);

          await runtime.eval(`
            console.groupEnd();
          `);
          assert.strictEqual(runtime.console.getGroupDepth(), 1);
        } finally {
          await runtime.dispose();
        }
      });

      test("console.reset clears all console state", async () => {
        const runtime = await createRuntime();

        try {
          await runtime.eval(`
            console.count("counter");
            console.time("timer");
            console.group("group");
          `);

          // Verify state exists
          assert.strictEqual(runtime.console.getCounters().size, 1);
          assert.strictEqual(runtime.console.getTimers().size, 1);
          assert.strictEqual(runtime.console.getGroupDepth(), 1);

          // Reset
          runtime.console.reset();

          // Verify state is cleared
          assert.strictEqual(runtime.console.getCounters().size, 0);
          assert.strictEqual(runtime.console.getTimers().size, 0);
          assert.strictEqual(runtime.console.getGroupDepth(), 0);
        } finally {
          await runtime.dispose();
        }
      });
    });

  });

  describe("maxExecutionMs timeout", () => {
    test("throws timeout error on infinite loop", async () => {
      const runtime = await createRuntime();
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

    test("completes when code finishes within timeout", async () => {
      let logValue: unknown = null;
      const runtime = await createRuntime({
        console: {
          onEntry: (entry) => {
            if (entry.type === "output" && entry.level === "log") {
              logValue = entry.args[0];
            }
          },
        },
      });

      try {
        await runtime.eval(`console.log("fast code");`, { maxExecutionMs: 5000 });
        assert.strictEqual(logValue, "fast code");
      } finally {
        await runtime.dispose();
      }
    });

    test("supports filename in options object", async () => {
      const runtime = await createRuntime();
      try {
        await assert.rejects(
          async () => {
            await runtime.eval(`throw new Error("test")`, { filename: "test-file.js" });
          },
          (err: Error) => {
            assert.ok(err.stack?.includes("test-file.js"), "stack should contain filename");
            return true;
          }
        );
      } finally {
        await runtime.dispose();
      }
    });

    test("backward compatible with string filename argument", async () => {
      const runtime = await createRuntime();
      try {
        await assert.rejects(
          async () => {
            await runtime.eval(`throw new Error("test")`, "compat-file.js");
          },
          (err: Error) => {
            assert.ok(err.stack?.includes("compat-file.js"), "stack should contain filename");
            return true;
          }
        );
      } finally {
        await runtime.dispose();
      }
    });
  });

  describe("cwd option", () => {
    test("cwd option configures path.resolve working directory", async () => {
      let logValue: string | null = null;
      const runtime = await createRuntime({
        cwd: "/home/user/project",
        console: {
          onEntry: (entry) => {
            if (entry.type === "output" && entry.level === "log") {
              logValue = entry.args[0] as string;
            }
          },
        },
      });

      try {
        await runtime.eval(`
          const resolved = path.resolve("src/file.ts");
          console.log(resolved);
        `);
        assert.strictEqual(logValue, "/home/user/project/src/file.ts");
      } finally {
        await runtime.dispose();
      }
    });

    test("default cwd is /", async () => {
      let logValue: string | null = null;
      const runtime = await createRuntime({
        console: {
          onEntry: (entry) => {
            if (entry.type === "output" && entry.level === "log") {
              logValue = entry.args[0] as string;
            }
          },
        },
      });

      try {
        await runtime.eval(`
          const resolved = path.resolve("foo/bar");
          console.log(resolved);
        `);
        assert.strictEqual(logValue, "/foo/bar");
      } finally {
        await runtime.dispose();
      }
    });
  });
});
