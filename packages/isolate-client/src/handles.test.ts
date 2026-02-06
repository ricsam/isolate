/**
 * Handle-based API integration tests for runtime.fetch, runtime.timers,
 * runtime.console, streaming support, WebSocket, and async iterator custom functions.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import { connect } from "./connection.ts";
import { startDaemon, type DaemonHandle } from "@ricsam/isolate-daemon";
import type { DaemonConnection } from "./types.ts";

const TEST_SOCKET = "/tmp/isolate-test-handles.sock";

describe("handle-based API", () => {
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

  describe("streaming support", () => {
    it("should stream large request bodies (>1MB)", async () => {
      const runtime = await client.createRuntime();
      try {
        await runtime.eval(`
          serve({
            async fetch(request) {
              const body = await request.arrayBuffer();
              return Response.json({
                size: body.byteLength,
                // Return first and last few bytes to verify integrity
                first: Array.from(new Uint8Array(body.slice(0, 4))),
                last: Array.from(new Uint8Array(body.slice(-4)))
              });
            }
          });
        `);

        // Create a 2MB body (above STREAM_THRESHOLD of 1MB)
        const bodySize = 2 * 1024 * 1024;
        const body = new Uint8Array(bodySize);
        // Fill with pattern: index mod 256
        for (let i = 0; i < bodySize; i++) {
          body[i] = i % 256;
        }

        const response = await runtime.fetch.dispatchRequest(
          new Request("http://localhost/upload", {
            method: "POST",
            body: body,
            headers: { "Content-Length": String(bodySize) },
          })
        );

        assert.strictEqual(response.status, 200);
        const result = await response.json();
        assert.strictEqual(result.size, bodySize);
        assert.deepStrictEqual(result.first, [0, 1, 2, 3]);
        // Last 4 bytes of 2MB: (2*1024*1024 - 4) % 256 = 252, 253, 254, 255
        assert.deepStrictEqual(result.last, [252, 253, 254, 255]);
      } finally {
        await runtime.dispose();
      }
    });

    it("should stream large response bodies (>1MB)", async () => {
      const runtime = await client.createRuntime();
      try {
        await runtime.eval(`
          serve({
            fetch(request) {
              // Create a 2MB response body
              const size = 2 * 1024 * 1024;
              const body = new Uint8Array(size);
              for (let i = 0; i < size; i++) {
                body[i] = i % 256;
              }
              return new Response(body, {
                headers: { "Content-Type": "application/octet-stream" }
              });
            }
          });
        `);

        const response = await runtime.fetch.dispatchRequest(
          new Request("http://localhost/download")
        );

        assert.strictEqual(response.status, 200);
        const body = new Uint8Array(await response.arrayBuffer());

        const expectedSize = 2 * 1024 * 1024;
        assert.strictEqual(body.length, expectedSize);

        // Verify pattern integrity
        assert.strictEqual(body[0], 0);
        assert.strictEqual(body[1], 1);
        assert.strictEqual(body[255], 255);
        assert.strictEqual(body[256], 0); // wraps around
        assert.strictEqual(body[body.length - 1], 255);
        assert.strictEqual(body[body.length - 2], 254);
      } finally {
        await runtime.dispose();
      }
    });

    it("should handle small bodies without streaming", async () => {
      const runtime = await client.createRuntime();
      try {
        await runtime.eval(`
          serve({
            async fetch(request) {
              const body = await request.text();
              return new Response("Echo: " + body);
            }
          });
        `);

        // Small body (under 1MB threshold)
        const smallBody = "Hello, World!";
        const response = await runtime.fetch.dispatchRequest(
          new Request("http://localhost/echo", {
            method: "POST",
            body: smallBody,
          })
        );

        assert.strictEqual(response.status, 200);
        const result = await response.text();
        assert.strictEqual(result, "Echo: Hello, World!");
      } finally {
        await runtime.dispose();
      }
    });

    it("should stream large response via reader in real-time", async () => {
      // NOTE: The daemon only streams responses > 1MB. For smaller streaming responses,
      // the daemon buffers them before sending, so real-time behavior only applies to large bodies.
      const runtime = await client.createRuntime();
      try {
        // Create a streaming response that exceeds 1MB to trigger daemon-side streaming
        await runtime.eval(`
          serve({
            fetch() {
              // Each chunk is ~200KB, send 6 chunks = ~1.2MB total (above 1MB threshold)
              const chunkSize = 200 * 1024;
              let count = 0;
              const maxChunks = 6;

              const stream = new ReadableStream({
                pull(controller) {
                  if (count >= maxChunks) {
                    controller.close();
                    return;
                  }
                  // Create a chunk with a recognizable pattern
                  const data = new Uint8Array(chunkSize);
                  data.fill(count + 65); // Fill with 'A', 'B', 'C', etc.
                  controller.enqueue(data);
                  count++;
                }
              });
              return new Response(stream, {
                headers: { "Content-Type": "application/octet-stream" }
              });
            }
          });
        `);

        const response = await runtime.fetch.dispatchRequest(
          new Request("http://localhost/stream")
        );

        assert.strictEqual(response.status, 200);
        assert.ok(response.body, "Response should have a body");

        const reader = response.body.getReader();
        let totalBytes = 0;
        let readCount = 0;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          totalBytes += value.length;
          readCount++;
        }

        // Verify we got all the data (~1.2MB)
        const expectedSize = 200 * 1024 * 6;
        assert.strictEqual(totalBytes, expectedSize);

        // With streaming, we should get multiple reads (not all data in one read)
        // The exact number depends on chunk sizes but should be > 1
        assert.ok(
          readCount > 1,
          `Should have multiple reads for large streaming response, but got ${readCount}`
        );
      } finally {
        await runtime.dispose();
      }
    });

    it("should stream small response body correctly via reader", async () => {
      // NOTE: Small streaming responses (< 1MB) are buffered by the daemon before sending,
      // so they won't show real-time streaming behavior, but they should still work correctly.
      const runtime = await client.createRuntime();
      try {
        await runtime.eval(`
          serve({
            fetch() {
              let count = 0;
              const stream = new ReadableStream({
                pull(controller) {
                  if (count >= 3) {
                    controller.close();
                    return;
                  }
                  controller.enqueue(new TextEncoder().encode("chunk" + count + "\\n"));
                  count++;
                }
              });
              return new Response(stream, {
                headers: { "Content-Type": "text/plain" }
              });
            }
          });
        `);

        const response = await runtime.fetch.dispatchRequest(
          new Request("http://localhost/stream")
        );

        assert.strictEqual(response.status, 200);
        assert.ok(response.body, "Response should have a body");

        const reader = response.body.getReader();
        let fullContent = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          fullContent += new TextDecoder().decode(value);
        }

        assert.strictEqual(fullContent, "chunk0\nchunk1\nchunk2\n");
      } finally {
        await runtime.dispose();
      }
    });

    it("should handle empty streaming response body", async () => {
      const runtime = await client.createRuntime();
      try {
        await runtime.eval(`
          serve({
            fetch() {
              const stream = new ReadableStream({
                start(controller) {
                  // Immediately close without any chunks
                  controller.close();
                }
              });
              return new Response(stream);
            }
          });
        `);

        const response = await runtime.fetch.dispatchRequest(
          new Request("http://localhost/empty")
        );

        assert.strictEqual(response.status, 200);
        const text = await response.text();
        assert.strictEqual(text, "");
      } finally {
        await runtime.dispose();
      }
    });

    it("should allow reading response body with response.text() after streaming", async () => {
      const runtime = await client.createRuntime();
      try {
        await runtime.eval(`
          serve({
            fetch() {
              const stream = new ReadableStream({
                async start(controller) {
                  controller.enqueue(new TextEncoder().encode("Hello "));
                  await new Promise(resolve => setTimeout(resolve, 20));
                  controller.enqueue(new TextEncoder().encode("World!"));
                  controller.close();
                }
              });
              return new Response(stream, {
                headers: { "Content-Type": "text/plain" }
              });
            }
          });
        `);

        const response = await runtime.fetch.dispatchRequest(
          new Request("http://localhost/text")
        );

        // response.text() should work and concatenate all streamed chunks
        const text = await response.text();
        assert.strictEqual(text, "Hello World!");
      } finally {
        await runtime.dispose();
      }
    });

    it("should allow reading response body with response.json() after streaming", async () => {
      const runtime = await client.createRuntime();
      try {
        await runtime.eval(`
          serve({
            fetch() {
              const stream = new ReadableStream({
                async start(controller) {
                  controller.enqueue(new TextEncoder().encode('{"name":'));
                  await new Promise(resolve => setTimeout(resolve, 20));
                  controller.enqueue(new TextEncoder().encode('"test","value":42}'));
                  controller.close();
                }
              });
              return new Response(stream, {
                headers: { "Content-Type": "application/json" }
              });
            }
          });
        `);

        const response = await runtime.fetch.dispatchRequest(
          new Request("http://localhost/json")
        );

        const json = await response.json();
        assert.deepStrictEqual(json, { name: "test", value: 42 });
      } finally {
        await runtime.dispose();
      }
    });

    it("should preserve response headers in streaming response", async () => {
      const runtime = await client.createRuntime();
      try {
        await runtime.eval(`
          serve({
            fetch() {
              const stream = new ReadableStream({
                start(controller) {
                  controller.enqueue(new TextEncoder().encode("data"));
                  controller.close();
                }
              });
              return new Response(stream, {
                status: 201,
                statusText: "Created",
                headers: {
                  "Content-Type": "text/plain",
                  "X-Custom-Header": "custom-value"
                }
              });
            }
          });
        `);

        const response = await runtime.fetch.dispatchRequest(
          new Request("http://localhost/headers")
        );

        assert.strictEqual(response.status, 201);
        assert.strictEqual(response.statusText, "Created");
        assert.strictEqual(response.headers.get("Content-Type"), "text/plain");
        assert.strictEqual(response.headers.get("X-Custom-Header"), "custom-value");

        const text = await response.text();
        assert.strictEqual(text, "data");
      } finally {
        await runtime.dispose();
      }
    });
  });

  describe("WebSocket command push", () => {
    it("should auto-register RuntimeOptions.onWebSocketCommand callback", async () => {
      const receivedCommands: { type: string; connectionId: string; data?: unknown }[] = [];

      const runtime = await client.createRuntime({
        onWebSocketCommand: (cmd) => {
          receivedCommands.push({
            type: cmd.type,
            connectionId: cmd.connectionId,
            data: cmd.data,
          });
        },
      });

      try {
        await runtime.eval(`
          serve({
            fetch(request, server) {
              if (request.headers.get("Upgrade") === "websocket") {
                server.upgrade(request);
                return new Response(null, { status: 101 });
              }
              return new Response("Not a WebSocket request", { status: 400 });
            },
            websocket: {
              open(ws) {
                ws.send("hello from runtime option");
              }
            }
          });
        `);

        await runtime.fetch.dispatchRequest(
          new Request("http://localhost/ws", {
            headers: { "Upgrade": "websocket" },
          })
        );

        const upgradeRequest = await runtime.fetch.getUpgradeRequest();
        assert.ok(upgradeRequest, "Should have upgrade request");
        const connectionId = upgradeRequest!.connectionId;

        await runtime.fetch.dispatchWebSocketOpen(connectionId);
        await new Promise((resolve) => setTimeout(resolve, 50));

        const sendCommand = receivedCommands.find(
          (cmd) => cmd.type === "message" && cmd.connectionId === connectionId
        );
        assert.ok(sendCommand, "Should receive message command via runtime option callback");
        assert.strictEqual(sendCommand?.data, "hello from runtime option");
      } finally {
        await runtime.dispose();
      }
    });

    it("should receive ws.send() commands from isolate", async () => {
      const receivedCommands: { type: string; connectionId: string; data?: unknown }[] = [];

      const runtime = await client.createRuntime();
      try {
        // Register WebSocket command callback
        runtime.fetch.onWebSocketCommand((cmd) => {
          receivedCommands.push({
            type: cmd.type,
            connectionId: cmd.connectionId,
            data: cmd.data,
          });
        });

        // Set up serve handler with websocket handlers
        await runtime.eval(`
          serve({
            fetch(request, server) {
              const upgrade = request.headers.get("Upgrade");
              if (upgrade === "websocket") {
                server.upgrade(request);
                return new Response(null, { status: 101 });
              }
              return new Response("Not a WebSocket request", { status: 400 });
            },
            websocket: {
              open(ws) {
                // Send a message when connection opens
                ws.send("hello from isolate");
              },
              message(ws, message) {
                // Echo messages back
                ws.send("echo: " + message);
              }
            }
          });
        `);

        // Dispatch a WebSocket upgrade request
        await runtime.fetch.dispatchRequest(
          new Request("http://localhost/ws", {
            headers: { "Upgrade": "websocket" }
          })
        );

        // Get the upgrade request info
        const upgradeRequest = await runtime.fetch.getUpgradeRequest();
        assert.ok(upgradeRequest, "Should have upgrade request");
        const connectionId = upgradeRequest!.connectionId;

        // Open the WebSocket connection - this triggers websocket.open(ws)
        await runtime.fetch.dispatchWebSocketOpen(connectionId);

        // Give time for the message to propagate
        await new Promise(resolve => setTimeout(resolve, 50));

        // Check that we received the command from the open handler
        const sendCommand = receivedCommands.find(
          cmd => cmd.type === "message" && cmd.connectionId === connectionId
        );
        assert.ok(sendCommand, "Should receive message command from isolate");
        assert.strictEqual(sendCommand?.data, "hello from isolate");
      } finally {
        await runtime.dispose();
      }
    });

    it("should receive ws.close() commands from isolate", async () => {
      const receivedCommands: { type: string; connectionId: string; code?: number; reason?: string }[] = [];

      const runtime = await client.createRuntime();
      try {
        // Register WebSocket command callback
        runtime.fetch.onWebSocketCommand((cmd) => {
          receivedCommands.push({
            type: cmd.type,
            connectionId: cmd.connectionId,
            code: cmd.code,
            reason: cmd.reason,
          });
        });

        await runtime.eval(`
          serve({
            fetch(request, server) {
              const upgrade = request.headers.get("Upgrade");
              if (upgrade === "websocket") {
                server.upgrade(request);
                return new Response(null, { status: 101 });
              }
              return new Response("Not a WebSocket request", { status: 400 });
            },
            websocket: {
              open(ws) {
                // Close connection immediately after opening
                ws.close(1000, "Normal closure");
              }
            }
          });
        `);

        // Dispatch upgrade request
        await runtime.fetch.dispatchRequest(
          new Request("http://localhost/ws", {
            headers: { "Upgrade": "websocket" }
          })
        );

        const upgradeRequest = await runtime.fetch.getUpgradeRequest();
        assert.ok(upgradeRequest, "Should have upgrade request");
        const connectionId = upgradeRequest!.connectionId;

        // Open the WebSocket connection - triggers websocket.open(ws) which calls close
        await runtime.fetch.dispatchWebSocketOpen(connectionId);

        // Give time for the message to propagate
        await new Promise(resolve => setTimeout(resolve, 50));

        // Check that we received the close command
        const closeCommand = receivedCommands.find(
          cmd => cmd.type === "close" && cmd.connectionId === connectionId
        );
        assert.ok(closeCommand, "Should receive close command from isolate");
        assert.strictEqual(closeCommand?.code, 1000);
        assert.strictEqual(closeCommand?.reason, "Normal closure");
      } finally {
        await runtime.dispose();
      }
    });

    it("should echo messages via websocket.message handler", async () => {
      const receivedCommands: { type: string; connectionId: string; data?: unknown }[] = [];

      const runtime = await client.createRuntime();
      try {
        runtime.fetch.onWebSocketCommand((cmd) => {
          receivedCommands.push({
            type: cmd.type,
            connectionId: cmd.connectionId,
            data: cmd.data,
          });
        });

        // Note: open handler is NOT required - message handler works on its own
        await runtime.eval(`
          serve({
            fetch(request, server) {
              if (request.headers.get("Upgrade") === "websocket") {
                server.upgrade(request);
                return new Response(null, { status: 101 });
              }
              return new Response("Not WebSocket", { status: 400 });
            },
            websocket: {
              message(ws, message) {
                // Echo with prefix
                ws.send("echo: " + message);
              }
            }
          });
        `);

        // Setup WebSocket connection
        await runtime.fetch.dispatchRequest(
          new Request("http://localhost/ws", {
            headers: { "Upgrade": "websocket" }
          })
        );

        const upgradeRequest = await runtime.fetch.getUpgradeRequest();
        assert.ok(upgradeRequest);
        const connectionId = upgradeRequest!.connectionId;

        await runtime.fetch.dispatchWebSocketOpen(connectionId);

        // Send a message to the isolate
        await runtime.fetch.dispatchWebSocketMessage(connectionId, "test message");

        // Wait for async WS_COMMAND message to be processed
        await new Promise(resolve => setTimeout(resolve, 100));

        // Verify we received the echo
        const echoMsg = receivedCommands.find(
          cmd => cmd.type === "message" && cmd.data === "echo: test message"
        );
        assert.ok(echoMsg, "Should receive echoed message");
        assert.strictEqual(echoMsg?.connectionId, connectionId);
      } finally {
        await runtime.dispose();
      }
    });
  });

  describe("async iterator custom functions", () => {
    it("should yield values from async iterator through client/daemon", async () => {
      const runtime = await client.createRuntime({
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
          serve({
            fetch: async (request) => {
              const arr = [];
              for await (const n of countUp(3)) arr.push(n);
              return new Response(JSON.stringify(arr), {
                headers: { "Content-Type": "application/json" }
              });
            }
          });
        `);

        const response = await runtime.fetch.dispatchRequest(
          new Request("http://localhost/test")
        );
        const result = await response.json();

        assert.deepStrictEqual(result, [0, 1, 2]);
      } finally {
        await runtime.dispose();
      }
    });

    it("should cleanup async iterator on break through client/daemon", async () => {
      let cleaned = false;
      const runtime = await client.createRuntime({
        customFunctions: {
          infinite: {
            fn: async function* () {
              try {
                while (true) yield 1;
              } finally {
                cleaned = true;
              }
            },
            type: 'asyncIterator',
          },
        },
      });

      try {
        await runtime.eval(`
          serve({
            fetch: async (request) => {
              for await (const n of infinite()) break;
              return new Response("done");
            }
          });
        `);

        const response = await runtime.fetch.dispatchRequest(
          new Request("http://localhost/test")
        );
        assert.strictEqual(response.status, 200);
        assert.strictEqual(cleaned, true);
      } finally {
        await runtime.dispose();
      }
    });

    it("should propagate async iterator errors through client/daemon", async () => {
      const runtime = await client.createRuntime({
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
        await runtime.eval(`
          serve({
            fetch: async (request) => {
              try {
                for await (const n of failing()) {}
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
        assert.ok(errorMessage.includes("Stream failed"));
      } finally {
        await runtime.dispose();
      }
    });

    it("should work with async iterator in direct eval context", async () => {
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

        assert.strictEqual(logs[0], "[ 0, 1, 2 ]");
      } finally {
        await runtime.dispose();
      }
    });
  });
});
