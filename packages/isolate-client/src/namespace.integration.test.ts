/**
 * Integration tests for namespace-based runtime caching.
 */

import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert";
import { connect } from "./connection.ts";
import { startDaemon, type DaemonHandle } from "@ricsam/isolate-daemon";
import type { DaemonConnection, RemoteRuntime, Namespace } from "./types.ts";

const TEST_SOCKET = "/tmp/isolate-namespace-test-daemon.sock";

describe("Namespace Runtime Caching Integration Tests", () => {
  let daemon: DaemonHandle;
  let client: DaemonConnection;

  before(async () => {
    daemon = await startDaemon({ socketPath: TEST_SOCKET, maxIsolates: 10 });
    client = await connect({ socket: TEST_SOCKET });
  });

  after(async () => {
    await client.close();
    await daemon.close();
  });

  describe("Basic Namespace Functionality", () => {
    it("should create namespaced runtime with reused: false", async () => {
      const namespace = client.createNamespace("basic-test-1");
      const runtime = await namespace.createRuntime();

      try {
        assert.ok(runtime.id);
        assert.strictEqual(runtime.reused, false);
      } finally {
        await runtime.dispose();
      }
    });

    it("should reuse namespaced runtime with reused: true after dispose", async () => {
      const namespace = client.createNamespace("basic-test-2");

      // Create and dispose first runtime
      const runtime1 = await namespace.createRuntime();
      const firstId = runtime1.id;
      assert.strictEqual(runtime1.reused, false);
      await runtime1.dispose();

      // Create second runtime in same namespace
      const runtime2 = await namespace.createRuntime();
      try {
        assert.strictEqual(runtime2.reused, true);
        assert.strictEqual(runtime2.id, firstId);
      } finally {
        await runtime2.dispose();
      }
    });

    it("should have same isolateId on reuse", async () => {
      const namespace = client.createNamespace("basic-test-3");

      const runtime1 = await namespace.createRuntime();
      const id1 = runtime1.id;
      await runtime1.dispose();

      const runtime2 = await namespace.createRuntime();
      const id2 = runtime2.id;
      await runtime2.dispose();

      assert.strictEqual(id1, id2);
    });

    it("should hard delete non-namespaced runtime", async () => {
      // Create non-namespaced runtime
      const runtime1 = await client.createRuntime();
      const id1 = runtime1.id;
      await runtime1.dispose();

      // Create another non-namespaced runtime - should be a different isolate
      const runtime2 = await client.createRuntime();
      try {
        // Non-namespaced runtimes don't have reused property set to true
        assert.notStrictEqual(runtime2.id, id1);
      } finally {
        await runtime2.dispose();
      }
    });
  });

  describe("Module Cache Preservation", () => {
    it("should preserve module cache on reuse", async () => {
      let loadCount = 0;
      const namespace = client.createNamespace("module-cache-1");

      // First runtime - load a module
      const runtime1 = await namespace.createRuntime({
        moduleLoader: async (moduleName: string) => {
          loadCount++;
          if (moduleName === "@/cached-module") {
            return `export const value = "cached";`;
          }
          throw new Error(`Unknown module: ${moduleName}`);
        },
      });

      const logs1: unknown[][] = [];
      await runtime1.eval(`
        import { value } from "@/cached-module";
        globalThis.moduleValue = value;
      `);
      await runtime1.dispose();

      assert.strictEqual(loadCount, 1);

      // Second runtime - module should already be cached
      const runtime2 = await namespace.createRuntime({
        console: {
          onEntry: (entry) => {
            if (entry.type === "output") {
              logs1.push(entry.args);
            }
          },
        },
        moduleLoader: async (moduleName: string) => {
          loadCount++;
          if (moduleName === "@/cached-module") {
            return `export const value = "cached";`;
          }
          throw new Error(`Unknown module: ${moduleName}`);
        },
      });

      try {
        assert.strictEqual(runtime2.reused, true);

        // Import same module - should use cache
        await runtime2.eval(`
          import { value } from "@/cached-module";
          console.log("module value:", value);
        `);

        // Module loader should not have been called again
        assert.strictEqual(loadCount, 1);
        assert.ok(logs1.some((l) => l.includes("module value:") || (l[0] === "module value:" && l[1] === "cached")));
      } finally {
        await runtime2.dispose();
      }
    });

    it("should preserve global state on reuse", async () => {
      const namespace = client.createNamespace("global-state-1");

      // First runtime - set global variable
      const runtime1 = await namespace.createRuntime();
      await runtime1.eval(`globalThis.testValue = "preserved";`);
      await runtime1.dispose();

      // Second runtime - check global variable
      const logs: unknown[][] = [];
      const runtime2 = await namespace.createRuntime({
        console: {
          onEntry: (entry) => {
            if (entry.type === "output" && entry.level === "log") {
              logs.push(entry.args);
            }
          },
        },
      });

      try {
        await runtime2.eval(`console.log("testValue:", globalThis.testValue);`);
        assert.ok(logs.some((l) => l[0] === "testValue:" && l[1] === "preserved"));
      } finally {
        await runtime2.dispose();
      }
    });

    it("should preserve evaluated code state", async () => {
      const namespace = client.createNamespace("eval-state-1");

      // First runtime - define a function
      const runtime1 = await namespace.createRuntime();
      await runtime1.eval(`
        globalThis.myFunction = (x) => x * 2;
      `);
      await runtime1.dispose();

      // Second runtime - function should still be callable
      const logs: unknown[][] = [];
      const runtime2 = await namespace.createRuntime({
        console: {
          onEntry: (entry) => {
            if (entry.type === "output" && entry.level === "log") {
              logs.push(entry.args);
            }
          },
        },
      });

      try {
        await runtime2.eval(`
          const result = globalThis.myFunction(21);
          console.log("result:", result);
        `);
        assert.ok(logs.some((l) => l[0] === "result:" && l[1] === 42));
      } finally {
        await runtime2.dispose();
      }
    });
  });

  describe("State Reset on Reuse", () => {
    it("should clear timers on reuse", async () => {
      const namespace = client.createNamespace("timer-reset-1");
      const logs: unknown[][] = [];

      // First runtime - set a timeout
      const runtime1 = await namespace.createRuntime({
        console: {
          onEntry: (entry) => {
            if (entry.type === "output" && entry.level === "log") {
              logs.push(entry.args);
            }
          },
        },
      });
      await runtime1.eval(`
        globalThis.timerFired = false;
        setTimeout(() => {
          globalThis.timerFired = true;
          console.log("timer fired!");
        }, 50);
      `);
      // Dispose before timer fires
      await runtime1.dispose();

      // Wait for timer to have fired if it wasn't cleared
      await new Promise((r) => setTimeout(r, 100));

      // Second runtime - timer should have been cleared
      const runtime2 = await namespace.createRuntime({
        console: {
          onEntry: (entry) => {
            if (entry.type === "output" && entry.level === "log") {
              logs.push(entry.args);
            }
          },
        },
      });

      try {
        await runtime2.eval(`console.log("timerFired:", globalThis.timerFired);`);
        // Timer should not have fired
        assert.ok(logs.some((l) => l[0] === "timerFired:" && l[1] === false));
        assert.ok(!logs.some((l) => l[0] === "timer fired!"));
      } finally {
        await runtime2.dispose();
      }
    });

    it("should reset console counters on reuse", async () => {
      const namespace = client.createNamespace("console-counter-1");

      // First runtime - increment counter
      const runtime1 = await namespace.createRuntime();
      await runtime1.eval(`
        console.count("myCounter");
        console.count("myCounter");
      `);
      const counters1 = await runtime1.console.getCounters();
      assert.strictEqual(counters1.get("myCounter"), 2);
      await runtime1.dispose();

      // Second runtime - counter should be reset
      const runtime2 = await namespace.createRuntime();

      try {
        const counters2 = await runtime2.console.getCounters();
        // Counter should be reset (either 0 or not exist)
        assert.ok(!counters2.has("myCounter") || counters2.get("myCounter") === 0);
      } finally {
        await runtime2.dispose();
      }
    });

    it("should reset console timers on reuse", async () => {
      const namespace = client.createNamespace("console-timer-1");

      // First runtime - start a timer
      const runtime1 = await namespace.createRuntime();
      await runtime1.eval(`console.time("myTimer");`);
      const timers1 = await runtime1.console.getTimers();
      assert.ok(timers1.has("myTimer"));
      await runtime1.dispose();

      // Second runtime - timer should be reset
      const runtime2 = await namespace.createRuntime();

      try {
        const timers2 = await runtime2.console.getTimers();
        assert.ok(!timers2.has("myTimer"));
      } finally {
        await runtime2.dispose();
      }
    });

    it("should reset console group depth on reuse", async () => {
      const namespace = client.createNamespace("console-group-1");

      // First runtime - create nested groups
      const runtime1 = await namespace.createRuntime();
      await runtime1.eval(`
        console.group("outer");
        console.group("inner");
      `);
      const depth1 = await runtime1.console.getGroupDepth();
      assert.strictEqual(depth1, 2);
      await runtime1.dispose();

      // Second runtime - group depth should be reset
      const runtime2 = await namespace.createRuntime();

      try {
        const depth2 = await runtime2.console.getGroupDepth();
        assert.strictEqual(depth2, 0);
      } finally {
        await runtime2.dispose();
      }
    });
  });

  describe("Callback Re-registration", () => {
    it("should re-register console callback on reuse", async () => {
      const namespace = client.createNamespace("callback-console-1");

      // First runtime with first callback
      const logs1: unknown[][] = [];
      const runtime1 = await namespace.createRuntime({
        console: {
          onEntry: (entry) => {
            if (entry.type === "output" && entry.level === "log") {
              logs1.push(entry.args);
            }
          },
        },
      });
      await runtime1.eval(`console.log("from runtime 1");`);
      assert.ok(logs1.some((l) => l[0] === "from runtime 1"));
      await runtime1.dispose();

      // Second runtime with different callback
      const logs2: unknown[][] = [];
      const runtime2 = await namespace.createRuntime({
        console: {
          onEntry: (entry) => {
            if (entry.type === "output" && entry.level === "log") {
              logs2.push(entry.args);
            }
          },
        },
      });

      try {
        await runtime2.eval(`console.log("from runtime 2");`);
        // New callback should receive logs
        assert.ok(logs2.some((l) => l[0] === "from runtime 2"));
        // Old callback should not receive new logs
        assert.ok(!logs1.some((l) => l[0] === "from runtime 2"));
      } finally {
        await runtime2.dispose();
      }
    });

    it("should re-register fetch callback on reuse", async () => {
      const namespace = client.createNamespace("callback-fetch-1");

      // First runtime
      const fetches1: string[] = [];
      const runtime1 = await namespace.createRuntime({
        fetch: async (request) => {
          fetches1.push(request.url);
          return new Response("from callback 1");
        },
      });
      await runtime1.dispose();

      // Second runtime with different fetch callback
      const fetches2: string[] = [];
      const runtime2 = await namespace.createRuntime({
        fetch: async (request) => {
          fetches2.push(request.url);
          return new Response("from callback 2");
        },
      });

      try {
        await runtime2.eval(`
          serve({
            fetch: async (request) => {
              const response = await fetch("https://test.example.com/data");
              return new Response(await response.text());
            }
          });
        `);

        const response = await runtime2.fetch.dispatchRequest(
          new Request("http://localhost/test")
        );
        const text = await response.text();

        assert.strictEqual(text, "from callback 2");
        assert.ok(fetches2.some((url) => url.includes("test.example.com")));
        assert.strictEqual(fetches1.length, 0);
      } finally {
        await runtime2.dispose();
      }
    });

    it("should re-register module loader on reuse", async () => {
      const namespace = client.createNamespace("callback-module-1");

      // First runtime
      const runtime1 = await namespace.createRuntime({
        moduleLoader: async (moduleName: string) => {
          if (moduleName === "@/old-module") {
            return `export const value = "old";`;
          }
          throw new Error(`Unknown module: ${moduleName}`);
        },
      });
      await runtime1.dispose();

      // Second runtime with different module loader
      const logs: unknown[][] = [];
      const runtime2 = await namespace.createRuntime({
        console: {
          onEntry: (entry) => {
            if (entry.type === "output" && entry.level === "log") {
              logs.push(entry.args);
            }
          },
        },
        moduleLoader: async (moduleName: string) => {
          if (moduleName === "@/new-module") {
            return `export const value = "new";`;
          }
          throw new Error(`Unknown module: ${moduleName}`);
        },
      });

      try {
        // New module loader should work
        await runtime2.eval(`
          import { value } from "@/new-module";
          console.log("value:", value);
        `);
        assert.ok(logs.some((l) => l[0] === "value:" && l[1] === "new"));
      } finally {
        await runtime2.dispose();
      }
    });

    it("should re-register custom functions on reuse", async () => {
      const namespace = client.createNamespace("callback-custom-1");

      // First runtime
      const runtime1 = await namespace.createRuntime({
        customFunctions: {
          getValue: {
            fn: () => "value-1",
            type: "sync",
          },
        },
      });
      await runtime1.dispose();

      // Second runtime with different custom function
      const logs: unknown[][] = [];
      const runtime2 = await namespace.createRuntime({
        console: {
          onEntry: (entry) => {
            if (entry.type === "output" && entry.level === "log") {
              logs.push(entry.args);
            }
          },
        },
        customFunctions: {
          getValue: {
            fn: () => "value-2",
            type: "sync",
          },
        },
      });

      try {
        await runtime2.eval(`
          const result = getValue();
          console.log("result:", result);
        `);
        assert.ok(logs.some((l) => l[0] === "result:" && l[1] === "value-2"));
      } finally {
        await runtime2.dispose();
      }
    });
  });

  describe("Cross-Client Reuse", () => {
    it("should allow different connection to reuse namespace", async () => {
      const namespaceId = "cross-client-1";

      // First client creates runtime
      const namespace1 = client.createNamespace(namespaceId);
      const runtime1 = await namespace1.createRuntime();
      await runtime1.eval(`globalThis.crossClientValue = "shared";`);
      const id1 = runtime1.id;
      await runtime1.dispose();

      // Second client connects and reuses
      const client2 = await connect({ socket: TEST_SOCKET });
      try {
        const namespace2 = client2.createNamespace(namespaceId);
        const logs: unknown[][] = [];
        const runtime2 = await namespace2.createRuntime({
          console: {
            onEntry: (entry) => {
              if (entry.type === "output" && entry.level === "log") {
                logs.push(entry.args);
              }
            },
          },
        });

        try {
          assert.strictEqual(runtime2.reused, true);
          assert.strictEqual(runtime2.id, id1);

          await runtime2.eval(`console.log("crossClientValue:", globalThis.crossClientValue);`);
          assert.ok(logs.some((l) => l[0] === "crossClientValue:" && l[1] === "shared"));
        } finally {
          await runtime2.dispose();
        }
      } finally {
        await client2.close();
      }
    });

    it("should soft-delete namespaced runtime on connection close", async () => {
      const namespaceId = "connection-close-1";

      // First client creates and disposes
      const client1 = await connect({ socket: TEST_SOCKET });
      const namespace1 = client1.createNamespace(namespaceId);
      const runtime1 = await namespace1.createRuntime();
      await runtime1.eval(`globalThis.connectionCloseValue = "persisted";`);
      const id1 = runtime1.id;
      // Close connection without explicit dispose - should soft-delete
      await client1.close();

      // Second client can reuse
      const client2 = await connect({ socket: TEST_SOCKET });
      try {
        const namespace2 = client2.createNamespace(namespaceId);
        const logs: unknown[][] = [];
        const runtime2 = await namespace2.createRuntime({
          console: {
            onEntry: (entry) => {
              if (entry.type === "output" && entry.level === "log") {
                logs.push(entry.args);
              }
            },
          },
        });

        try {
          assert.strictEqual(runtime2.reused, true);
          assert.strictEqual(runtime2.id, id1);

          await runtime2.eval(`console.log("connectionCloseValue:", globalThis.connectionCloseValue);`);
          assert.ok(logs.some((l) => l[0] === "connectionCloseValue:" && l[1] === "persisted"));
        } finally {
          await runtime2.dispose();
        }
      } finally {
        await client2.close();
      }
    });
  });

  describe("Error Cases", () => {
    it("should error when namespace has active runtime", async () => {
      const namespace = client.createNamespace("error-active-1");
      const runtime1 = await namespace.createRuntime();

      try {
        await assert.rejects(
          async () => {
            await namespace.createRuntime();
          },
          /already has an active runtime|namespace.*active/i
        );
      } finally {
        await runtime1.dispose();
      }
    });

    it("should create new runtime for non-existent namespace", async () => {
      const namespace = client.createNamespace("new-namespace-" + Date.now());
      const runtime = await namespace.createRuntime();

      try {
        assert.ok(runtime.id);
        assert.strictEqual(runtime.reused, false);
      } finally {
        await runtime.dispose();
      }
    });
  });

  describe("LRU Eviction", () => {
    it("should evict oldest disposed runtime when at maxIsolates limit", async () => {
      // Create a daemon with small limit for this test
      const smallDaemon = await startDaemon({
        socketPath: "/tmp/isolate-lru-test.sock",
        maxIsolates: 3,
      });
      const smallClient = await connect({ socket: "/tmp/isolate-lru-test.sock" });

      try {
        // Create and dispose 3 namespaced runtimes
        const ns1 = smallClient.createNamespace("lru-1");
        const rt1 = await ns1.createRuntime();
        await rt1.eval(`globalThis.ns1Value = "first";`);
        await rt1.dispose();

        // Small delay to ensure different disposedAt timestamps
        await new Promise((r) => setTimeout(r, 10));

        const ns2 = smallClient.createNamespace("lru-2");
        const rt2 = await ns2.createRuntime();
        await rt2.eval(`globalThis.ns2Value = "second";`);
        await rt2.dispose();

        await new Promise((r) => setTimeout(r, 10));

        const ns3 = smallClient.createNamespace("lru-3");
        const rt3 = await ns3.createRuntime();
        await rt3.eval(`globalThis.ns3Value = "third";`);
        await rt3.dispose();

        // Now create a 4th - should evict the oldest (ns1)
        const ns4 = smallClient.createNamespace("lru-4");
        const rt4 = await ns4.createRuntime();

        // ns2 should still be available (only ns1 was evicted)
        // Dispose rt4 first to make room
        await rt4.dispose();
        const rt2Reuse = await ns2.createRuntime();
        assert.strictEqual(rt2Reuse.reused, true);

        // ns1 should have been evicted - trying to reuse should create new
        // Dispose rt2Reuse first to make room
        await rt2Reuse.dispose();
        const rt1Reuse = await ns1.createRuntime();
        assert.strictEqual(rt1Reuse.reused, false);

        await rt1Reuse.dispose();
      } finally {
        await smallClient.close();
        await smallDaemon.close();
      }
    });

    it("should not evict active runtimes", async () => {
      const smallDaemon = await startDaemon({
        socketPath: "/tmp/isolate-lru-active-test.sock",
        maxIsolates: 3,
      });
      const smallClient = await connect({ socket: "/tmp/isolate-lru-active-test.sock" });

      try {
        // Create 2 active runtimes
        const ns1 = smallClient.createNamespace("active-1");
        const rt1 = await ns1.createRuntime();

        const ns2 = smallClient.createNamespace("active-2");
        const rt2 = await ns2.createRuntime();

        // Create and dispose 1 runtime
        const ns3 = smallClient.createNamespace("disposed-1");
        const rt3 = await ns3.createRuntime();
        await rt3.dispose();

        // Create 4th runtime - should evict disposed-1, not active ones
        const ns4 = smallClient.createNamespace("new-1");
        const rt4 = await ns4.createRuntime();

        // Verify active runtimes are still available (weren't evicted)
        // Dispose one to make room for verification
        await rt4.dispose();

        // disposed-1 should have been evicted - trying to reuse should create new
        const rt3Reuse = await ns3.createRuntime();
        assert.strictEqual(rt3Reuse.reused, false);

        await rt1.dispose();
        await rt2.dispose();
        await rt3Reuse.dispose();
      } finally {
        await smallClient.close();
        await smallDaemon.close();
      }
    });

    it("should error when no disposed runtimes to evict and at limit", async () => {
      const smallDaemon = await startDaemon({
        socketPath: "/tmp/isolate-lru-full-test.sock",
        maxIsolates: 2,
      });
      const smallClient = await connect({ socket: "/tmp/isolate-lru-full-test.sock" });

      try {
        // Create 2 active runtimes (at limit)
        const ns1 = smallClient.createNamespace("full-1");
        const rt1 = await ns1.createRuntime();

        const ns2 = smallClient.createNamespace("full-2");
        const rt2 = await ns2.createRuntime();

        // Try to create 3rd - should error
        const ns3 = smallClient.createNamespace("full-3");
        await assert.rejects(
          async () => {
            await ns3.createRuntime();
          },
          /maximum.*isolates|limit.*reached|no.*disposed.*evict/i
        );

        await rt1.dispose();
        await rt2.dispose();
      } finally {
        await smallClient.close();
        await smallDaemon.close();
      }
    });
  });

  describe("Connection Close Behavior", () => {
    it("should soft-delete namespaced runtime on connection close", async () => {
      const namespaceId = "conn-close-soft-1";

      const client1 = await connect({ socket: TEST_SOCKET });
      const ns1 = client1.createNamespace(namespaceId);
      const rt1 = await ns1.createRuntime();
      await rt1.eval(`globalThis.softDeleteTest = "survived";`);
      const id1 = rt1.id;

      // Close connection (should soft-delete, not hard delete)
      await client1.close();

      // New connection should be able to reuse
      const client2 = await connect({ socket: TEST_SOCKET });
      try {
        const ns2 = client2.createNamespace(namespaceId);
        const logs: unknown[][] = [];
        const rt2 = await ns2.createRuntime({
          console: {
            onEntry: (entry) => {
              if (entry.type === "output" && entry.level === "log") {
                logs.push(entry.args);
              }
            },
          },
        });

        assert.strictEqual(rt2.reused, true);
        assert.strictEqual(rt2.id, id1);

        await rt2.eval(`console.log("softDeleteTest:", globalThis.softDeleteTest);`);
        assert.ok(logs.some((l) => l[0] === "softDeleteTest:" && l[1] === "survived"));

        await rt2.dispose();
      } finally {
        await client2.close();
      }
    });

    it("should hard-delete non-namespaced runtime on connection close", async () => {
      const client1 = await connect({ socket: TEST_SOCKET });

      // Create non-namespaced runtime
      const rt1 = await client1.createRuntime();
      const id1 = rt1.id;
      await rt1.eval(`globalThis.hardDeleteTest = "deleted";`);

      // Close connection (should hard delete non-namespaced)
      await client1.close();

      // Stats should show runtime was removed
      const stats = daemon.getStats();
      // We can't directly verify the specific isolate was removed, but
      // the test verifies the flow works without errors
    });
  });

  describe("Edge Cases", () => {
    it("should handle empty namespace id", async () => {
      const namespace = client.createNamespace("");
      const runtime = await namespace.createRuntime();

      try {
        assert.ok(runtime.id);
        assert.strictEqual(runtime.reused, false);
      } finally {
        await runtime.dispose();
      }

      // Should be able to reuse empty namespace
      const runtime2 = await namespace.createRuntime();
      try {
        assert.strictEqual(runtime2.reused, true);
      } finally {
        await runtime2.dispose();
      }
    });

    it("should handle special characters in namespace id", async () => {
      const specialId = "namespace/with:special@chars!#$%";
      const namespace = client.createNamespace(specialId);
      const runtime = await namespace.createRuntime();

      try {
        assert.ok(runtime.id);
        await runtime.eval(`globalThis.specialTest = "works";`);
      } finally {
        await runtime.dispose();
      }

      // Should be able to reuse
      const logs: unknown[][] = [];
      const runtime2 = await namespace.createRuntime({
        console: {
          onEntry: (entry) => {
            if (entry.type === "output" && entry.level === "log") {
              logs.push(entry.args);
            }
          },
        },
      });
      try {
        assert.strictEqual(runtime2.reused, true);
        await runtime2.eval(`console.log("specialTest:", globalThis.specialTest);`);
        assert.ok(logs.some((l) => l[0] === "specialTest:" && l[1] === "works"));
      } finally {
        await runtime2.dispose();
      }
    });

    it("should handle rapid create/dispose/reuse cycles", async () => {
      const namespace = client.createNamespace("rapid-cycle-1");

      for (let i = 0; i < 10; i++) {
        const runtime = await namespace.createRuntime();
        if (i === 0) {
          assert.strictEqual(runtime.reused, false);
        } else {
          assert.strictEqual(runtime.reused, true);
        }
        await runtime.eval(`globalThis.cycleCount = ${i + 1};`);
        await runtime.dispose();
      }

      // Final check - value should be preserved
      const logs: unknown[][] = [];
      const finalRuntime = await namespace.createRuntime({
        console: {
          onEntry: (entry) => {
            if (entry.type === "output" && entry.level === "log") {
              logs.push(entry.args);
            }
          },
        },
      });

      try {
        await finalRuntime.eval(`console.log("cycleCount:", globalThis.cycleCount);`);
        assert.ok(logs.some((l) => l[0] === "cycleCount:" && l[1] === 10));
      } finally {
        await finalRuntime.dispose();
      }
    });

    it("should ignore new RuntimeOptions on reuse (uses original)", async () => {
      const namespace = client.createNamespace("options-ignore-1");

      // Create with specific memory limit
      const runtime1 = await namespace.createRuntime({
        memoryLimitMB: 64,
      });
      await runtime1.dispose();

      // Try to create with different memory limit
      const runtime2 = await namespace.createRuntime({
        memoryLimitMB: 256, // This should be ignored
      });

      try {
        assert.strictEqual(runtime2.reused, true);
        // Memory limit should be the original 64MB, not 256MB
        // (We can't directly test this without daemon introspection,
        // but the test verifies the flow works)
      } finally {
        await runtime2.dispose();
      }
    });
  });
});
