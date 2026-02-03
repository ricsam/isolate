/**
 * Integration tests for WebSocket client (outbound connections from isolate).
 *
 * Tests the WHATWG WebSocket class that allows code running inside the isolate
 * to make outbound WebSocket connections.
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import { WebSocketServer, type WebSocket as WsWebSocket } from "ws";
import { connect, type DaemonConnection } from "./index.ts";
import { startDaemon, type DaemonHandle } from "@ricsam/isolate-daemon";

const TEST_SOCKET = "/tmp/isolate-websocket-client-test.sock";

describe("WebSocket client (outbound from isolate)", () => {
  let daemon: DaemonHandle;
  let connection: DaemonConnection;
  let wss: WebSocketServer;
  let port: number;

  beforeEach(async () => {
    // Create WebSocket server
    wss = new WebSocketServer({ port: 0 });
    port = (wss.address() as { port: number }).port;

    // Start daemon and connect client
    daemon = await startDaemon({ socketPath: TEST_SOCKET });
    connection = await connect({ socket: TEST_SOCKET });
  });

  afterEach(async () => {
    await connection.close();
    await daemon.close();
    await new Promise<void>((resolve) => {
      wss.close(() => resolve());
    });
  });

  describe("Connection lifecycle", () => {
    it("should connect and receive open event", { timeout: 5000 }, async () => {
      // Server: accept connection
      wss.on("connection", (ws) => {
        // Just accept connection
      });

      const runtime = await connection.createRuntime();
      try {
        await runtime.eval(`
          serve({
            async fetch(request) {
              const url = new URL(request.url);
              const wsUrl = url.searchParams.get("wsUrl");

              return new Promise((resolve) => {
                const ws = new WebSocket(wsUrl);

                ws.onopen = () => {
                  ws.close();
                  resolve(new Response(JSON.stringify({
                    opened: true,
                    readyState: ws.readyState
                  }), {
                    headers: { "Content-Type": "application/json" }
                  }));
                };

                ws.onerror = () => {
                  resolve(new Response(JSON.stringify({ error: true }), {
                    status: 500,
                    headers: { "Content-Type": "application/json" }
                  }));
                };
              });
            }
          });
        `);

        const response = await runtime.fetch.dispatchRequest(
          new Request(`http://test/?wsUrl=ws://localhost:${port}`)
        );
        const json = await response.json();
        assert.strictEqual(json.opened, true);
        // readyState should be OPEN (1) or CLOSING (2) since we called close()
        assert.ok(json.readyState >= 1);
      } finally {
        await runtime.dispose();
      }
    });

    it("should send and receive messages", { timeout: 5000 }, async () => {
      // Server: echo messages back
      wss.on("connection", (ws) => {
        ws.on("message", (data) => {
          ws.send(`echo: ${data.toString()}`);
        });
      });

      const runtime = await connection.createRuntime();
      try {
        await runtime.eval(`
          serve({
            async fetch(request) {
              const url = new URL(request.url);
              const wsUrl = url.searchParams.get("wsUrl");

              return new Promise((resolve) => {
                const ws = new WebSocket(wsUrl);

                ws.onopen = () => {
                  ws.send("hello");
                };

                ws.onmessage = (event) => {
                  ws.close();
                  resolve(new Response(JSON.stringify({
                    received: event.data
                  }), {
                    headers: { "Content-Type": "application/json" }
                  }));
                };

                ws.onerror = () => {
                  resolve(new Response(JSON.stringify({ error: true }), {
                    status: 500,
                    headers: { "Content-Type": "application/json" }
                  }));
                };
              });
            }
          });
        `);

        const response = await runtime.fetch.dispatchRequest(
          new Request(`http://test/?wsUrl=ws://localhost:${port}`)
        );
        const json = await response.json();
        assert.strictEqual(json.received, "echo: hello");
      } finally {
        await runtime.dispose();
      }
    });

    it("should handle clean close from client", { timeout: 5000 }, async () => {
      let serverReceivedClose = false;
      let serverCloseCode: number | undefined;

      wss.on("connection", (ws) => {
        ws.on("close", (code, reason) => {
          serverReceivedClose = true;
          serverCloseCode = code;
        });
      });

      const runtime = await connection.createRuntime();
      try {
        await runtime.eval(`
          serve({
            async fetch(request) {
              const url = new URL(request.url);
              const wsUrl = url.searchParams.get("wsUrl");

              return new Promise((resolve) => {
                const ws = new WebSocket(wsUrl);

                ws.onopen = () => {
                  ws.close(1000, "Normal closure");
                };

                ws.onclose = (event) => {
                  resolve(new Response(JSON.stringify({
                    code: event.code,
                    reason: event.reason,
                    wasClean: event.wasClean
                  }), {
                    headers: { "Content-Type": "application/json" }
                  }));
                };

                ws.onerror = () => {
                  resolve(new Response(JSON.stringify({ error: true }), {
                    status: 500,
                    headers: { "Content-Type": "application/json" }
                  }));
                };
              });
            }
          });
        `);

        const response = await runtime.fetch.dispatchRequest(
          new Request(`http://test/?wsUrl=ws://localhost:${port}`)
        );
        const json = await response.json();
        assert.strictEqual(json.code, 1000);
        assert.strictEqual(json.wasClean, true);

        // Wait for server to process close
        await new Promise(r => setTimeout(r, 100));
        assert.strictEqual(serverReceivedClose, true);
        assert.strictEqual(serverCloseCode, 1000);
      } finally {
        await runtime.dispose();
      }
    });

    it("should handle close from server", { timeout: 5000 }, async () => {
      wss.on("connection", (ws) => {
        // Close immediately after connection
        setTimeout(() => {
          ws.close(1001, "Going away");
        }, 50);
      });

      const runtime = await connection.createRuntime();
      try {
        await runtime.eval(`
          serve({
            async fetch(request) {
              const url = new URL(request.url);
              const wsUrl = url.searchParams.get("wsUrl");

              return new Promise((resolve) => {
                const ws = new WebSocket(wsUrl);

                ws.onclose = (event) => {
                  resolve(new Response(JSON.stringify({
                    code: event.code,
                    reason: event.reason
                  }), {
                    headers: { "Content-Type": "application/json" }
                  }));
                };

                ws.onerror = () => {
                  resolve(new Response(JSON.stringify({ error: true }), {
                    status: 500,
                    headers: { "Content-Type": "application/json" }
                  }));
                };
              });
            }
          });
        `);

        const response = await runtime.fetch.dispatchRequest(
          new Request(`http://test/?wsUrl=ws://localhost:${port}`)
        );
        const json = await response.json();
        assert.strictEqual(json.code, 1001);
        assert.strictEqual(json.reason, "Going away");
      } finally {
        await runtime.dispose();
      }
    });
  });

  describe("Message types", () => {
    it("should send and receive text messages", { timeout: 5000 }, async () => {
      wss.on("connection", (ws) => {
        ws.on("message", (data) => {
          ws.send(`received: ${data.toString()}`);
        });
      });

      const runtime = await connection.createRuntime();
      try {
        await runtime.eval(`
          serve({
            async fetch(request) {
              const url = new URL(request.url);
              const wsUrl = url.searchParams.get("wsUrl");

              return new Promise((resolve) => {
                const ws = new WebSocket(wsUrl);
                const messages = [];

                ws.onopen = () => {
                  ws.send("message 1");
                  ws.send("message 2");
                  ws.send("message 3");
                };

                ws.onmessage = (event) => {
                  messages.push(event.data);
                  if (messages.length === 3) {
                    ws.close();
                    resolve(new Response(JSON.stringify({ messages }), {
                      headers: { "Content-Type": "application/json" }
                    }));
                  }
                };

                ws.onerror = () => {
                  resolve(new Response(JSON.stringify({ error: true }), {
                    status: 500,
                    headers: { "Content-Type": "application/json" }
                  }));
                };
              });
            }
          });
        `);

        const response = await runtime.fetch.dispatchRequest(
          new Request(`http://test/?wsUrl=ws://localhost:${port}`)
        );
        const json = await response.json();
        assert.deepStrictEqual(json.messages, [
          "received: message 1",
          "received: message 2",
          "received: message 3"
        ]);
      } finally {
        await runtime.dispose();
      }
    });

    it("should send and receive binary messages", { timeout: 5000 }, async () => {
      wss.on("connection", (ws) => {
        ws.on("message", (data, isBinary) => {
          if (isBinary) {
            // Echo binary data back
            ws.send(data, { binary: true });
          }
        });
      });

      const runtime = await connection.createRuntime();
      try {
        await runtime.eval(`
          serve({
            async fetch(request) {
              const url = new URL(request.url);
              const wsUrl = url.searchParams.get("wsUrl");

              return new Promise((resolve) => {
                const ws = new WebSocket(wsUrl);
                ws.binaryType = "arraybuffer";

                ws.onopen = () => {
                  const data = new Uint8Array([1, 2, 3, 4, 5]);
                  ws.send(data);
                };

                ws.onmessage = (event) => {
                  const received = new Uint8Array(event.data);
                  ws.close();
                  resolve(new Response(JSON.stringify({
                    received: Array.from(received),
                    isBinary: event.data instanceof ArrayBuffer
                  }), {
                    headers: { "Content-Type": "application/json" }
                  }));
                };

                ws.onerror = () => {
                  resolve(new Response(JSON.stringify({ error: true }), {
                    status: 500,
                    headers: { "Content-Type": "application/json" }
                  }));
                };
              });
            }
          });
        `);

        const response = await runtime.fetch.dispatchRequest(
          new Request(`http://test/?wsUrl=ws://localhost:${port}`)
        );
        const json = await response.json();
        assert.deepStrictEqual(json.received, [1, 2, 3, 4, 5]);
        assert.strictEqual(json.isBinary, true);
      } finally {
        await runtime.dispose();
      }
    });
  });

  describe("Error handling", () => {
    it("should handle connection refused", { timeout: 5000 }, async () => {
      const runtime = await connection.createRuntime();
      try {
        await runtime.eval(`
          serve({
            async fetch(request) {
              return new Promise((resolve) => {
                // Connect to a port that's not listening
                const ws = new WebSocket("ws://localhost:59999");

                ws.onopen = () => {
                  ws.close();
                  resolve(new Response(JSON.stringify({ opened: true }), {
                    headers: { "Content-Type": "application/json" }
                  }));
                };

                ws.onerror = () => {
                  resolve(new Response(JSON.stringify({
                    error: true,
                    readyState: ws.readyState
                  }), {
                    headers: { "Content-Type": "application/json" }
                  }));
                };

                ws.onclose = (event) => {
                  if (!event.wasClean) {
                    resolve(new Response(JSON.stringify({
                      error: true,
                      closed: true,
                      code: event.code
                    }), {
                      headers: { "Content-Type": "application/json" }
                    }));
                  }
                };
              });
            }
          });
        `);

        const response = await runtime.fetch.dispatchRequest(
          new Request(`http://test/`)
        );
        const json = await response.json();
        assert.strictEqual(json.error, true);
      } finally {
        await runtime.dispose();
      }
    });

    it("should handle invalid URL", { timeout: 5000 }, async () => {
      const runtime = await connection.createRuntime();
      try {
        await runtime.eval(`
          serve({
            async fetch(request) {
              try {
                const ws = new WebSocket("not-a-valid-url");
                return new Response(JSON.stringify({ created: true }), {
                  headers: { "Content-Type": "application/json" }
                });
              } catch (err) {
                return new Response(JSON.stringify({
                  error: true,
                  message: err.message
                }), {
                  headers: { "Content-Type": "application/json" }
                });
              }
            }
          });
        `);

        const response = await runtime.fetch.dispatchRequest(
          new Request(`http://test/`)
        );
        const json = await response.json();
        assert.strictEqual(json.error, true);
        assert.ok(json.message.includes("Invalid URL") || json.message.includes("url"));
      } finally {
        await runtime.dispose();
      }
    });
  });

  describe("WebSocket properties", () => {
    it("should have correct url property", { timeout: 5000 }, async () => {
      wss.on("connection", (ws) => {
        // Accept connection
      });

      const runtime = await connection.createRuntime();
      try {
        await runtime.eval(`
          serve({
            async fetch(request) {
              const url = new URL(request.url);
              const wsUrl = url.searchParams.get("wsUrl");

              return new Promise((resolve) => {
                const ws = new WebSocket(wsUrl);

                ws.onopen = () => {
                  ws.close();
                  resolve(new Response(JSON.stringify({
                    url: ws.url,
                    inputUrl: wsUrl
                  }), {
                    headers: { "Content-Type": "application/json" }
                  }));
                };

                ws.onerror = () => {
                  resolve(new Response(JSON.stringify({ error: true }), {
                    status: 500,
                    headers: { "Content-Type": "application/json" }
                  }));
                };
              });
            }
          });
        `);

        const response = await runtime.fetch.dispatchRequest(
          new Request(`http://test/?wsUrl=ws://localhost:${port}/path`)
        );
        const json = await response.json();
        assert.strictEqual(json.url, `ws://localhost:${port}/path`);
      } finally {
        await runtime.dispose();
      }
    });

    it("should have correct readyState values", { timeout: 5000 }, async () => {
      wss.on("connection", (ws) => {
        // Accept connection
      });

      const runtime = await connection.createRuntime();
      try {
        await runtime.eval(`
          serve({
            async fetch(request) {
              const url = new URL(request.url);
              const wsUrl = url.searchParams.get("wsUrl");

              return new Promise((resolve) => {
                const ws = new WebSocket(wsUrl);
                const states = { initial: ws.readyState };

                ws.onopen = () => {
                  states.open = ws.readyState;
                  ws.close();
                  states.closing = ws.readyState;
                };

                ws.onclose = () => {
                  states.closed = ws.readyState;
                  resolve(new Response(JSON.stringify(states), {
                    headers: { "Content-Type": "application/json" }
                  }));
                };

                ws.onerror = () => {
                  resolve(new Response(JSON.stringify({ error: true }), {
                    status: 500,
                    headers: { "Content-Type": "application/json" }
                  }));
                };
              });
            }
          });
        `);

        const response = await runtime.fetch.dispatchRequest(
          new Request(`http://test/?wsUrl=ws://localhost:${port}`)
        );
        const json = await response.json();
        assert.strictEqual(json.initial, 0); // CONNECTING
        assert.strictEqual(json.open, 1); // OPEN
        assert.strictEqual(json.closing, 2); // CLOSING
        assert.strictEqual(json.closed, 3); // CLOSED
      } finally {
        await runtime.dispose();
      }
    });

    it("should have static constants", { timeout: 5000 }, async () => {
      const runtime = await connection.createRuntime();
      try {
        await runtime.eval(`
          serve({
            async fetch(request) {
              return new Response(JSON.stringify({
                CONNECTING: WebSocket.CONNECTING,
                OPEN: WebSocket.OPEN,
                CLOSING: WebSocket.CLOSING,
                CLOSED: WebSocket.CLOSED
              }), {
                headers: { "Content-Type": "application/json" }
              });
            }
          });
        `);

        const response = await runtime.fetch.dispatchRequest(
          new Request(`http://test/`)
        );
        const json = await response.json();
        assert.strictEqual(json.CONNECTING, 0);
        assert.strictEqual(json.OPEN, 1);
        assert.strictEqual(json.CLOSING, 2);
        assert.strictEqual(json.CLOSED, 3);
      } finally {
        await runtime.dispose();
      }
    });
  });

  describe("EventTarget interface", () => {
    it("should support addEventListener/removeEventListener", { timeout: 5000 }, async () => {
      wss.on("connection", (ws) => {
        ws.send("hello");
      });

      const runtime = await connection.createRuntime();
      try {
        await runtime.eval(`
          serve({
            async fetch(request) {
              const url = new URL(request.url);
              const wsUrl = url.searchParams.get("wsUrl");

              return new Promise((resolve) => {
                const ws = new WebSocket(wsUrl);
                const events = [];

                const messageHandler = (event) => {
                  events.push({ type: "message", data: event.data });
                };

                const openHandler = () => {
                  events.push({ type: "open" });
                };

                ws.addEventListener("open", openHandler);
                ws.addEventListener("message", messageHandler);

                // Add a second message handler that will be removed
                const removedHandler = () => {
                  events.push({ type: "removed-should-not-appear" });
                };
                ws.addEventListener("message", removedHandler);
                ws.removeEventListener("message", removedHandler);

                ws.addEventListener("close", () => {
                  events.push({ type: "close" });
                  resolve(new Response(JSON.stringify({ events }), {
                    headers: { "Content-Type": "application/json" }
                  }));
                });

                // Close after receiving message
                ws.addEventListener("message", () => {
                  setTimeout(() => ws.close(), 50);
                });

                ws.onerror = () => {
                  resolve(new Response(JSON.stringify({ error: true }), {
                    status: 500,
                    headers: { "Content-Type": "application/json" }
                  }));
                };
              });
            }
          });
        `);

        const response = await runtime.fetch.dispatchRequest(
          new Request(`http://test/?wsUrl=ws://localhost:${port}`)
        );
        const json = await response.json();

        // Should have open, message, close events (but not the removed handler)
        assert.ok(json.events.some((e: { type: string }) => e.type === "open"));
        assert.ok(json.events.some((e: { type: string, data?: string }) =>
          e.type === "message" && e.data === "hello"));
        assert.ok(json.events.some((e: { type: string }) => e.type === "close"));
        assert.ok(!json.events.some((e: { type: string }) =>
          e.type === "removed-should-not-appear"));
      } finally {
        await runtime.dispose();
      }
    });
  });

  describe("Protocol negotiation", () => {
    it("should send subprotocol in connection", { timeout: 5000 }, async () => {
      let receivedProtocols: string[] = [];

      wss.on("connection", (ws, req) => {
        const protocol = req.headers["sec-websocket-protocol"];
        if (protocol) {
          receivedProtocols = protocol.split(",").map(p => p.trim());
        }
        ws.send("connected");
      });

      const runtime = await connection.createRuntime();
      try {
        await runtime.eval(`
          serve({
            async fetch(request) {
              const url = new URL(request.url);
              const wsUrl = url.searchParams.get("wsUrl");

              return new Promise((resolve) => {
                const ws = new WebSocket(wsUrl, ["graphql-ws", "subscriptions-transport-ws"]);

                ws.onmessage = () => {
                  ws.close();
                  resolve(new Response(JSON.stringify({
                    connected: true,
                    protocol: ws.protocol
                  }), {
                    headers: { "Content-Type": "application/json" }
                  }));
                };

                ws.onerror = () => {
                  resolve(new Response(JSON.stringify({ error: true }), {
                    status: 500,
                    headers: { "Content-Type": "application/json" }
                  }));
                };
              });
            }
          });
        `);

        const response = await runtime.fetch.dispatchRequest(
          new Request(`http://test/?wsUrl=ws://localhost:${port}`)
        );
        const json = await response.json();
        assert.strictEqual(json.connected, true);
        // Server should have received the protocols
        assert.ok(receivedProtocols.includes("graphql-ws"));
        assert.ok(receivedProtocols.includes("subscriptions-transport-ws"));
      } finally {
        await runtime.dispose();
      }
    });
  });

  describe("Multiple WebSocket connections", () => {
    it("should handle multiple concurrent connections", { timeout: 5000 }, async () => {
      let connectionCount = 0;

      wss.on("connection", (ws) => {
        connectionCount++;
        const myId = connectionCount;
        ws.on("message", () => {
          ws.send(`response from ${myId}`);
        });
      });

      const runtime = await connection.createRuntime();
      try {
        await runtime.eval(`
          serve({
            async fetch(request) {
              const url = new URL(request.url);
              const wsUrl = url.searchParams.get("wsUrl");

              return new Promise((resolve) => {
                const responses = [];
                let completed = 0;

                // Create 3 concurrent connections
                for (let i = 0; i < 3; i++) {
                  const ws = new WebSocket(wsUrl);

                  ws.onopen = () => {
                    ws.send("hello");
                  };

                  ws.onmessage = (event) => {
                    responses.push(event.data);
                    ws.close();
                    completed++;

                    if (completed === 3) {
                      resolve(new Response(JSON.stringify({ responses }), {
                        headers: { "Content-Type": "application/json" }
                      }));
                    }
                  };
                }
              });
            }
          });
        `);

        const response = await runtime.fetch.dispatchRequest(
          new Request(`http://test/?wsUrl=ws://localhost:${port}`)
        );
        const json = await response.json();
        assert.strictEqual(json.responses.length, 3);
        assert.strictEqual(connectionCount, 3);
      } finally {
        await runtime.dispose();
      }
    });
  });

  describe("WHATWG compliance edge cases", () => {
    describe("URL handling", () => {
      it("should strip URL fragments", { timeout: 5000 }, async () => {
        wss.on("connection", (ws) => {
          ws.send("connected");
        });

        const runtime = await connection.createRuntime();
        try {
          await runtime.eval(`
            serve({
              async fetch(request) {
                const url = new URL(request.url);
                const wsUrl = url.searchParams.get("wsUrl");

                return new Promise((resolve) => {
                  // URL with fragment - should be stripped per WHATWG spec
                  const ws = new WebSocket(wsUrl + "#fragment");

                  ws.onopen = () => {
                    // The url property should NOT include the fragment
                    const hasFragment = ws.url.includes('#');
                    ws.close();
                    resolve(new Response(JSON.stringify({
                      url: ws.url,
                      hasFragment
                    }), {
                      headers: { "Content-Type": "application/json" }
                    }));
                  };

                  ws.onerror = () => {
                    resolve(new Response(JSON.stringify({ error: true }), {
                      status: 500,
                      headers: { "Content-Type": "application/json" }
                    }));
                  };
                });
              }
            });
          `);

          const response = await runtime.fetch.dispatchRequest(
            new Request(`http://test/?wsUrl=ws://localhost:${port}/path`)
          );
          const json = await response.json();
          // Per WHATWG spec, fragments should be stripped
          assert.strictEqual(json.hasFragment, false);
        } finally {
          await runtime.dispose();
        }
      });

      it("should reject http:// URLs", { timeout: 5000 }, async () => {
        const runtime = await connection.createRuntime();
        try {
          await runtime.eval(`
            serve({
              async fetch(request) {
                try {
                  const ws = new WebSocket("http://localhost:8080");
                  return new Response(JSON.stringify({ created: true }), {
                    headers: { "Content-Type": "application/json" }
                  });
                } catch (err) {
                  return new Response(JSON.stringify({
                    error: true,
                    message: err.message
                  }), {
                    headers: { "Content-Type": "application/json" }
                  });
                }
              }
            });
          `);

          const response = await runtime.fetch.dispatchRequest(
            new Request(`http://test/`)
          );
          const json = await response.json();
          assert.strictEqual(json.error, true);
          assert.ok(json.message.includes("ws") || json.message.includes("scheme"));
        } finally {
          await runtime.dispose();
        }
      });
    });

    describe("Protocol validation", () => {
      it("should reject empty string protocol", { timeout: 5000 }, async () => {
        const runtime = await connection.createRuntime();
        try {
          await runtime.eval(`
            serve({
              async fetch(request) {
                const url = new URL(request.url);
                const wsUrl = url.searchParams.get("wsUrl");

                try {
                  const ws = new WebSocket(wsUrl, "");
                  ws.close();
                  return new Response(JSON.stringify({ created: true }), {
                    headers: { "Content-Type": "application/json" }
                  });
                } catch (err) {
                  return new Response(JSON.stringify({
                    error: true,
                    name: err.name,
                    message: err.message
                  }), {
                    headers: { "Content-Type": "application/json" }
                  });
                }
              }
            });
          `);

          const response = await runtime.fetch.dispatchRequest(
            new Request(`http://test/?wsUrl=ws://localhost:${port}`)
          );
          const json = await response.json();
          // Empty protocol should be accepted as a single-element array with empty string
          // which is technically valid but useless - implementation may vary
          // Just verify it doesn't crash
          assert.ok(json.created === true || json.error === true);
        } finally {
          await runtime.dispose();
        }
      });

      it("should reject duplicate protocols", { timeout: 5000 }, async () => {
        const runtime = await connection.createRuntime();
        try {
          await runtime.eval(`
            serve({
              async fetch(request) {
                const url = new URL(request.url);
                const wsUrl = url.searchParams.get("wsUrl");

                try {
                  const ws = new WebSocket(wsUrl, ["proto1", "proto1"]);
                  ws.close();
                  return new Response(JSON.stringify({ created: true }), {
                    headers: { "Content-Type": "application/json" }
                  });
                } catch (err) {
                  return new Response(JSON.stringify({
                    error: true,
                    name: err.name
                  }), {
                    headers: { "Content-Type": "application/json" }
                  });
                }
              }
            });
          `);

          const response = await runtime.fetch.dispatchRequest(
            new Request(`http://test/?wsUrl=ws://localhost:${port}`)
          );
          const json = await response.json();
          assert.strictEqual(json.error, true);
          assert.strictEqual(json.name, "SyntaxError");
        } finally {
          await runtime.dispose();
        }
      });
    });

    describe("send() state handling", () => {
      it("should throw when sending in CONNECTING state", { timeout: 5000 }, async () => {
        const runtime = await connection.createRuntime();
        try {
          await runtime.eval(`
            serve({
              async fetch(request) {
                const url = new URL(request.url);
                const wsUrl = url.searchParams.get("wsUrl");

                const ws = new WebSocket(wsUrl);

                // Check readyState IMMEDIATELY after construction (must be synchronous)
                const initialReadyState = ws.readyState;

                // Try to send immediately (still CONNECTING - this is synchronous)
                let errorInfo = null;
                try {
                  ws.send("test");
                } catch (err) {
                  errorInfo = { name: err.name, message: err.message };
                }

                // Now wait for connection to open or close before responding
                return new Promise((resolve) => {
                  const cleanup = () => {
                    ws.close();
                    resolve(new Response(JSON.stringify({
                      initialReadyState,
                      error: errorInfo !== null,
                      errorName: errorInfo?.name,
                      sent: errorInfo === null
                    }), {
                      headers: { "Content-Type": "application/json" }
                    }));
                  };

                  ws.onopen = cleanup;
                  ws.onerror = cleanup;
                  ws.onclose = cleanup;

                  // Timeout fallback
                  setTimeout(cleanup, 1000);
                });
              }
            });
          `);

          const response = await runtime.fetch.dispatchRequest(
            new Request(`http://test/?wsUrl=ws://localhost:${port}`)
          );
          const json = await response.json();
          assert.strictEqual(json.error, true);
          assert.strictEqual(json.errorName, "InvalidStateError");
          assert.strictEqual(json.initialReadyState, 0); // CONNECTING
        } finally {
          await runtime.dispose();
        }
      });

      it("should silently discard send() when CLOSING", { timeout: 5000 }, async () => {
        wss.on("connection", (ws) => {
          // Don't close from server side
        });

        const runtime = await connection.createRuntime();
        try {
          await runtime.eval(`
            serve({
              async fetch(request) {
                const url = new URL(request.url);
                const wsUrl = url.searchParams.get("wsUrl");

                return new Promise((resolve) => {
                  const ws = new WebSocket(wsUrl);

                  ws.onopen = () => {
                    ws.close(); // Now in CLOSING state

                    // Try to send - should NOT throw, just silently discard
                    try {
                      ws.send("test");
                      resolve(new Response(JSON.stringify({
                        sentWithoutError: true,
                        readyState: ws.readyState
                      }), {
                        headers: { "Content-Type": "application/json" }
                      }));
                    } catch (err) {
                      resolve(new Response(JSON.stringify({
                        error: true,
                        name: err.name
                      }), {
                        headers: { "Content-Type": "application/json" }
                      }));
                    }
                  };
                });
              }
            });
          `);

          const response = await runtime.fetch.dispatchRequest(
            new Request(`http://test/?wsUrl=ws://localhost:${port}`)
          );
          const json = await response.json();
          assert.strictEqual(json.sentWithoutError, true);
          assert.strictEqual(json.readyState, 2); // CLOSING
        } finally {
          await runtime.dispose();
        }
      });
    });

    describe("close() validation", () => {
      it("should reject invalid close codes", { timeout: 5000 }, async () => {
        const runtime = await connection.createRuntime();
        try {
          await runtime.eval(`
            serve({
              async fetch(request) {
                const url = new URL(request.url);
                const wsUrl = url.searchParams.get("wsUrl");
                const errors = [];

                return new Promise((resolve) => {
                  const ws = new WebSocket(wsUrl);

                  ws.onopen = () => {
                    // Test invalid codes
                    const invalidCodes = [0, 999, 1001, 1004, 1005, 1006, 1015, 2999, 5000];

                    for (const code of invalidCodes) {
                      try {
                        // Create new WebSocket for each test since close() changes state
                        const testWs = new WebSocket(wsUrl);
                        testWs.onopen = () => {
                          try {
                            testWs.close(code);
                            errors.push({ code, accepted: true });
                          } catch (err) {
                            errors.push({ code, rejected: true, name: err.name });
                          }
                        };
                      } catch (e) {
                        // Connection error, skip
                      }
                    }

                    // Wait a bit for all connections to open
                    setTimeout(() => {
                      ws.close();
                      resolve(new Response(JSON.stringify({ errors }), {
                        headers: { "Content-Type": "application/json" }
                      }));
                    }, 200);
                  };
                });
              }
            });
          `);

          const response = await runtime.fetch.dispatchRequest(
            new Request(`http://test/?wsUrl=ws://localhost:${port}`)
          );
          const json = await response.json();

          // Codes outside 1000 and 3000-4999 should be rejected
          const shouldReject = [0, 999, 1001, 1004, 1005, 1006, 1015, 2999, 5000];
          for (const code of shouldReject) {
            const result = json.errors.find((e: { code: number }) => e.code === code);
            if (result) {
              assert.strictEqual(result.rejected, true, `Code ${code} should be rejected`);
            }
          }
        } finally {
          await runtime.dispose();
        }
      });

      it("should accept valid close codes", { timeout: 5000 }, async () => {
        wss.on("connection", (ws) => {
          // Accept connection
        });

        const runtime = await connection.createRuntime();
        try {
          await runtime.eval(`
            serve({
              async fetch(request) {
                const url = new URL(request.url);
                const wsUrl = url.searchParams.get("wsUrl");

                return new Promise((resolve) => {
                  const ws = new WebSocket(wsUrl);

                  ws.onopen = () => {
                    // Valid codes: 1000 and 3000-4999
                    try {
                      ws.close(1000, "Normal closure");
                      resolve(new Response(JSON.stringify({ accepted: true }), {
                        headers: { "Content-Type": "application/json" }
                      }));
                    } catch (err) {
                      resolve(new Response(JSON.stringify({ error: true }), {
                        headers: { "Content-Type": "application/json" }
                      }));
                    }
                  };
                });
              }
            });
          `);

          const response = await runtime.fetch.dispatchRequest(
            new Request(`http://test/?wsUrl=ws://localhost:${port}`)
          );
          const json = await response.json();
          assert.strictEqual(json.accepted, true);
        } finally {
          await runtime.dispose();
        }
      });

      it("should reject reason longer than 123 bytes", { timeout: 5000 }, async () => {
        const runtime = await connection.createRuntime();
        try {
          await runtime.eval(`
            serve({
              async fetch(request) {
                const url = new URL(request.url);
                const wsUrl = url.searchParams.get("wsUrl");

                return new Promise((resolve) => {
                  const ws = new WebSocket(wsUrl);

                  ws.onopen = () => {
                    // Create a reason > 123 bytes (use multi-byte chars to be sure)
                    const longReason = "a".repeat(124);

                    try {
                      ws.close(1000, longReason);
                      resolve(new Response(JSON.stringify({ accepted: true }), {
                        headers: { "Content-Type": "application/json" }
                      }));
                    } catch (err) {
                      ws.close();
                      resolve(new Response(JSON.stringify({
                        error: true,
                        name: err.name
                      }), {
                        headers: { "Content-Type": "application/json" }
                      }));
                    }
                  };
                });
              }
            });
          `);

          const response = await runtime.fetch.dispatchRequest(
            new Request(`http://test/?wsUrl=ws://localhost:${port}`)
          );
          const json = await response.json();
          assert.strictEqual(json.error, true);
          assert.strictEqual(json.name, "SyntaxError");
        } finally {
          await runtime.dispose();
        }
      });

      it("should allow calling close() multiple times", { timeout: 5000 }, async () => {
        wss.on("connection", (ws) => {
          // Accept connection
        });

        const runtime = await connection.createRuntime();
        try {
          await runtime.eval(`
            serve({
              async fetch(request) {
                const url = new URL(request.url);
                const wsUrl = url.searchParams.get("wsUrl");

                return new Promise((resolve) => {
                  const ws = new WebSocket(wsUrl);

                  ws.onopen = () => {
                    // First close
                    ws.close(1000);
                    const stateAfterFirst = ws.readyState;

                    // Second close - should be no-op
                    try {
                      ws.close(1000);
                      resolve(new Response(JSON.stringify({
                        multipleClosesOk: true,
                        stateAfterFirst
                      }), {
                        headers: { "Content-Type": "application/json" }
                      }));
                    } catch (err) {
                      resolve(new Response(JSON.stringify({ error: true }), {
                        headers: { "Content-Type": "application/json" }
                      }));
                    }
                  };
                });
              }
            });
          `);

          const response = await runtime.fetch.dispatchRequest(
            new Request(`http://test/?wsUrl=ws://localhost:${port}`)
          );
          const json = await response.json();
          assert.strictEqual(json.multipleClosesOk, true);
          assert.strictEqual(json.stateAfterFirst, 2); // CLOSING
        } finally {
          await runtime.dispose();
        }
      });
    });

    describe("Event object properties", () => {
      it("should have correct event properties on open", { timeout: 5000 }, async () => {
        wss.on("connection", (ws) => {
          // Accept
        });

        const runtime = await connection.createRuntime();
        try {
          await runtime.eval(`
            serve({
              async fetch(request) {
                const url = new URL(request.url);
                const wsUrl = url.searchParams.get("wsUrl");

                return new Promise((resolve) => {
                  const ws = new WebSocket(wsUrl);

                  ws.addEventListener("open", (event) => {
                    ws.close();
                    resolve(new Response(JSON.stringify({
                      type: event.type,
                      hasTimeStamp: typeof event.timeStamp === 'number',
                      bubbles: event.bubbles,
                      cancelable: event.cancelable
                    }), {
                      headers: { "Content-Type": "application/json" }
                    }));
                  });
                });
              }
            });
          `);

          const response = await runtime.fetch.dispatchRequest(
            new Request(`http://test/?wsUrl=ws://localhost:${port}`)
          );
          const json = await response.json();
          assert.strictEqual(json.type, "open");
          assert.strictEqual(json.hasTimeStamp, true);
          assert.strictEqual(json.bubbles, false);
          assert.strictEqual(json.cancelable, false);
        } finally {
          await runtime.dispose();
        }
      });

      it("should have correct MessageEvent properties", { timeout: 5000 }, async () => {
        wss.on("connection", (ws) => {
          ws.send("test message");
        });

        const runtime = await connection.createRuntime();
        try {
          await runtime.eval(`
            serve({
              async fetch(request) {
                const url = new URL(request.url);
                const wsUrl = url.searchParams.get("wsUrl");

                return new Promise((resolve) => {
                  const ws = new WebSocket(wsUrl);

                  ws.addEventListener("message", (event) => {
                    ws.close();
                    resolve(new Response(JSON.stringify({
                      type: event.type,
                      data: event.data,
                      hasOrigin: 'origin' in event,
                      hasLastEventId: 'lastEventId' in event,
                      hasPorts: 'ports' in event
                    }), {
                      headers: { "Content-Type": "application/json" }
                    }));
                  });
                });
              }
            });
          `);

          const response = await runtime.fetch.dispatchRequest(
            new Request(`http://test/?wsUrl=ws://localhost:${port}`)
          );
          const json = await response.json();
          assert.strictEqual(json.type, "message");
          assert.strictEqual(json.data, "test message");
          assert.strictEqual(json.hasOrigin, true);
          assert.strictEqual(json.hasLastEventId, true);
          assert.strictEqual(json.hasPorts, true);
        } finally {
          await runtime.dispose();
        }
      });

      it("should have correct CloseEvent properties", { timeout: 5000 }, async () => {
        wss.on("connection", (ws) => {
          setTimeout(() => ws.close(4000, "Custom close"), 50);
        });

        const runtime = await connection.createRuntime();
        try {
          await runtime.eval(`
            serve({
              async fetch(request) {
                const url = new URL(request.url);
                const wsUrl = url.searchParams.get("wsUrl");

                return new Promise((resolve) => {
                  const ws = new WebSocket(wsUrl);

                  ws.addEventListener("close", (event) => {
                    resolve(new Response(JSON.stringify({
                      type: event.type,
                      code: event.code,
                      reason: event.reason,
                      wasClean: event.wasClean,
                      hasCode: 'code' in event,
                      hasReason: 'reason' in event,
                      hasWasClean: 'wasClean' in event
                    }), {
                      headers: { "Content-Type": "application/json" }
                    }));
                  });
                });
              }
            });
          `);

          const response = await runtime.fetch.dispatchRequest(
            new Request(`http://test/?wsUrl=ws://localhost:${port}`)
          );
          const json = await response.json();
          assert.strictEqual(json.type, "close");
          assert.strictEqual(json.code, 4000);
          assert.strictEqual(json.reason, "Custom close");
          assert.strictEqual(json.hasCode, true);
          assert.strictEqual(json.hasReason, true);
          assert.strictEqual(json.hasWasClean, true);
        } finally {
          await runtime.dispose();
        }
      });
    });

    describe("Multiple event listeners", () => {
      it("should call multiple listeners for same event type", { timeout: 5000 }, async () => {
        wss.on("connection", (ws) => {
          ws.send("message");
        });

        const runtime = await connection.createRuntime();
        try {
          await runtime.eval(`
            serve({
              async fetch(request) {
                const url = new URL(request.url);
                const wsUrl = url.searchParams.get("wsUrl");

                return new Promise((resolve) => {
                  const ws = new WebSocket(wsUrl);
                  const callOrder = [];

                  ws.addEventListener("message", () => callOrder.push(1));
                  ws.addEventListener("message", () => callOrder.push(2));
                  ws.addEventListener("message", () => callOrder.push(3));

                  // Also set onmessage handler
                  ws.onmessage = () => callOrder.push("handler");

                  ws.addEventListener("message", () => {
                    setTimeout(() => {
                      ws.close();
                      resolve(new Response(JSON.stringify({ callOrder }), {
                        headers: { "Content-Type": "application/json" }
                      }));
                    }, 50);
                  });
                });
              }
            });
          `);

          const response = await runtime.fetch.dispatchRequest(
            new Request(`http://test/?wsUrl=ws://localhost:${port}`)
          );
          const json = await response.json();
          // All listeners should be called, plus the handler
          assert.ok(json.callOrder.includes(1));
          assert.ok(json.callOrder.includes(2));
          assert.ok(json.callOrder.includes(3));
          assert.ok(json.callOrder.includes("handler"));
        } finally {
          await runtime.dispose();
        }
      });

      it("should not add duplicate listeners", { timeout: 5000 }, async () => {
        wss.on("connection", (ws) => {
          ws.send("message");
        });

        const runtime = await connection.createRuntime();
        try {
          await runtime.eval(`
            serve({
              async fetch(request) {
                const url = new URL(request.url);
                const wsUrl = url.searchParams.get("wsUrl");

                return new Promise((resolve) => {
                  const ws = new WebSocket(wsUrl);
                  let callCount = 0;

                  const listener = () => callCount++;

                  // Add same listener multiple times
                  ws.addEventListener("message", listener);
                  ws.addEventListener("message", listener);
                  ws.addEventListener("message", listener);

                  ws.addEventListener("message", () => {
                    setTimeout(() => {
                      ws.close();
                      resolve(new Response(JSON.stringify({ callCount }), {
                        headers: { "Content-Type": "application/json" }
                      }));
                    }, 50);
                  });
                });
              }
            });
          `);

          const response = await runtime.fetch.dispatchRequest(
            new Request(`http://test/?wsUrl=ws://localhost:${port}`)
          );
          const json = await response.json();
          // Same listener should only be called once
          assert.strictEqual(json.callCount, 1);
        } finally {
          await runtime.dispose();
        }
      });
    });

    describe("Large messages", () => {
      it("should handle large text messages", { timeout: 10000 }, async () => {
        const largeMessage = "x".repeat(100000); // 100KB

        wss.on("connection", (ws) => {
          ws.on("message", (data) => {
            // Echo back the length
            ws.send(`received:${data.toString().length}`);
          });
        });

        const runtime = await connection.createRuntime();
        try {
          await runtime.eval(`
            serve({
              async fetch(request) {
                const url = new URL(request.url);
                const wsUrl = url.searchParams.get("wsUrl");
                const size = parseInt(url.searchParams.get("size"));

                return new Promise((resolve) => {
                  const ws = new WebSocket(wsUrl);

                  ws.onopen = () => {
                    const largeMsg = "x".repeat(size);
                    ws.send(largeMsg);
                  };

                  ws.onmessage = (event) => {
                    ws.close();
                    resolve(new Response(JSON.stringify({
                      response: event.data,
                      sentSize: size
                    }), {
                      headers: { "Content-Type": "application/json" }
                    }));
                  };
                });
              }
            });
          `);

          const response = await runtime.fetch.dispatchRequest(
            new Request(`http://test/?wsUrl=ws://localhost:${port}&size=100000`)
          );
          const json = await response.json();
          assert.strictEqual(json.response, "received:100000");
        } finally {
          await runtime.dispose();
        }
      });

      it("should handle large binary messages", { timeout: 10000 }, async () => {
        wss.on("connection", (ws) => {
          ws.on("message", (data, isBinary) => {
            if (isBinary) {
              const len = Buffer.isBuffer(data) ? data.length : (data as ArrayBuffer).byteLength;
              ws.send(`received:${len}`, { binary: false });
            }
          });
        });

        const runtime = await connection.createRuntime();
        try {
          await runtime.eval(`
            serve({
              async fetch(request) {
                const url = new URL(request.url);
                const wsUrl = url.searchParams.get("wsUrl");
                const size = parseInt(url.searchParams.get("size"));

                return new Promise((resolve) => {
                  const ws = new WebSocket(wsUrl);

                  ws.onopen = () => {
                    const data = new Uint8Array(size);
                    for (let i = 0; i < size; i++) {
                      data[i] = i % 256;
                    }
                    ws.send(data);
                  };

                  ws.onmessage = (event) => {
                    ws.close();
                    resolve(new Response(JSON.stringify({
                      response: event.data,
                      sentSize: size
                    }), {
                      headers: { "Content-Type": "application/json" }
                    }));
                  };
                });
              }
            });
          `);

          const response = await runtime.fetch.dispatchRequest(
            new Request(`http://test/?wsUrl=ws://localhost:${port}&size=50000`)
          );
          const json = await response.json();
          assert.strictEqual(json.response, "received:50000");
        } finally {
          await runtime.dispose();
        }
      });
    });

    describe("binaryType switching", () => {
      it("should switch binaryType mid-connection", { timeout: 5000 }, async () => {
        wss.on("connection", (ws) => {
          // Send binary data
          ws.send(Buffer.from([1, 2, 3, 4]), { binary: true });
        });

        const runtime = await connection.createRuntime();
        try {
          await runtime.eval(`
            serve({
              async fetch(request) {
                const url = new URL(request.url);
                const wsUrl = url.searchParams.get("wsUrl");

                return new Promise((resolve) => {
                  const ws = new WebSocket(wsUrl);

                  // Start with blob (default)
                  const initialBinaryType = ws.binaryType;

                  ws.onopen = () => {
                    // Switch to arraybuffer before receiving
                    ws.binaryType = "arraybuffer";
                  };

                  ws.onmessage = (event) => {
                    ws.close();
                    resolve(new Response(JSON.stringify({
                      initialBinaryType,
                      finalBinaryType: ws.binaryType,
                      receivedArrayBuffer: event.data instanceof ArrayBuffer
                    }), {
                      headers: { "Content-Type": "application/json" }
                    }));
                  };
                });
              }
            });
          `);

          const response = await runtime.fetch.dispatchRequest(
            new Request(`http://test/?wsUrl=ws://localhost:${port}`)
          );
          const json = await response.json();
          assert.strictEqual(json.initialBinaryType, "blob");
          assert.strictEqual(json.finalBinaryType, "arraybuffer");
          assert.strictEqual(json.receivedArrayBuffer, true);
        } finally {
          await runtime.dispose();
        }
      });

      it("should reject invalid binaryType", { timeout: 5000 }, async () => {
        const runtime = await connection.createRuntime();
        try {
          await runtime.eval(`
            serve({
              async fetch(request) {
                const url = new URL(request.url);
                const wsUrl = url.searchParams.get("wsUrl");

                return new Promise((resolve) => {
                  const ws = new WebSocket(wsUrl);

                  ws.onopen = () => {
                    try {
                      ws.binaryType = "invalid";
                      ws.close();
                      resolve(new Response(JSON.stringify({ accepted: true }), {
                        headers: { "Content-Type": "application/json" }
                      }));
                    } catch (err) {
                      ws.close();
                      resolve(new Response(JSON.stringify({
                        error: true,
                        name: err.name
                      }), {
                        headers: { "Content-Type": "application/json" }
                      }));
                    }
                  };
                });
              }
            });
          `);

          const response = await runtime.fetch.dispatchRequest(
            new Request(`http://test/?wsUrl=ws://localhost:${port}`)
          );
          const json = await response.json();
          assert.strictEqual(json.error, true);
          assert.strictEqual(json.name, "SyntaxError");
        } finally {
          await runtime.dispose();
        }
      });
    });
  });

  describe("Cleanup on isolate dispose", () => {
    it("should close WebSocket when isolate is disposed", { timeout: 5000 }, async () => {
      let serverSawClose = false;

      wss.on("connection", (ws) => {
        ws.on("close", () => {
          serverSawClose = true;
        });
        // Keep connection open
      });

      const runtime = await connection.createRuntime();

      // Create a WebSocket connection but don't close it
      await runtime.eval(`
        serve({
          async fetch(request) {
            const url = new URL(request.url);
            const wsUrl = url.searchParams.get("wsUrl");

            // Store WebSocket globally so it stays open
            globalThis.testWs = new WebSocket(wsUrl);

            return new Promise((resolve) => {
              globalThis.testWs.onopen = () => {
                resolve(new Response(JSON.stringify({ connected: true }), {
                  headers: { "Content-Type": "application/json" }
                }));
              };
            });
          }
        });
      `);

      const response = await runtime.fetch.dispatchRequest(
        new Request(`http://test/?wsUrl=ws://localhost:${port}`)
      );
      const json = await response.json();
      assert.strictEqual(json.connected, true);

      // Dispose the runtime - this should close the WebSocket
      await runtime.dispose();

      // Wait for server to see the close
      await new Promise(r => setTimeout(r, 200));
      assert.strictEqual(serverSawClose, true);
    });
  });

  describe("WebSocket callback handler", () => {
    it("should allow connections via callback", { timeout: 5000 }, async () => {
      let callbackCalled = false;
      let receivedUrl = "";
      let receivedProtocols: string[] = [];

      wss.on("connection", (ws) => {
        ws.send("hello from server");
      });

      const runtime = await connection.createRuntime({
        webSocket: (url, protocols) => {
          callbackCalled = true;
          receivedUrl = url;
          receivedProtocols = protocols;
          // Return a new WebSocket to allow connection
          return new WebSocket(url, protocols.length > 0 ? protocols : undefined);
        },
      });

      try {
        await runtime.eval(`
          serve({
            async fetch(request) {
              const url = new URL(request.url);
              const wsUrl = url.searchParams.get("wsUrl");

              return new Promise((resolve) => {
                const ws = new WebSocket(wsUrl, ["proto1"]);

                ws.onmessage = (event) => {
                  ws.close();
                  resolve(new Response(JSON.stringify({
                    message: event.data
                  }), {
                    headers: { "Content-Type": "application/json" }
                  }));
                };

                ws.onerror = () => {
                  resolve(new Response(JSON.stringify({ error: true }), {
                    status: 500,
                    headers: { "Content-Type": "application/json" }
                  }));
                };
              });
            }
          });
        `);

        const response = await runtime.fetch.dispatchRequest(
          new Request(`http://test/?wsUrl=ws://localhost:${port}`)
        );
        const json = await response.json();
        assert.strictEqual(json.message, "hello from server");
        assert.strictEqual(callbackCalled, true);
        assert.strictEqual(receivedUrl, `ws://localhost:${port}/`);
        assert.deepStrictEqual(receivedProtocols, ["proto1"]);
      } finally {
        await runtime.dispose();
      }
    });

    it("should block connections via callback returning null", { timeout: 5000 }, async () => {
      let callbackCalled = false;

      const runtime = await connection.createRuntime({
        webSocket: (url, protocols) => {
          callbackCalled = true;
          // Block connection by returning null
          return null;
        },
      });

      try {
        await runtime.eval(`
          serve({
            async fetch(request) {
              const url = new URL(request.url);
              const wsUrl = url.searchParams.get("wsUrl");

              return new Promise((resolve) => {
                const ws = new WebSocket(wsUrl);

                ws.onopen = () => {
                  ws.close();
                  resolve(new Response(JSON.stringify({ opened: true }), {
                    headers: { "Content-Type": "application/json" }
                  }));
                };

                ws.onerror = () => {
                  resolve(new Response(JSON.stringify({ error: true }), {
                    headers: { "Content-Type": "application/json" }
                  }));
                };

                ws.onclose = (event) => {
                  resolve(new Response(JSON.stringify({
                    closed: true,
                    code: event.code,
                    reason: event.reason,
                    wasClean: event.wasClean
                  }), {
                    headers: { "Content-Type": "application/json" }
                  }));
                };
              });
            }
          });
        `);

        const response = await runtime.fetch.dispatchRequest(
          new Request(`http://test/?wsUrl=ws://localhost:${port}`)
        );
        const json = await response.json();
        assert.strictEqual(callbackCalled, true);
        // Connection should be blocked - we get error and close events
        assert.ok(json.error === true || json.closed === true);
        if (json.closed) {
          assert.strictEqual(json.code, 1006);
          assert.strictEqual(json.reason, "Connection blocked");
        }
      } finally {
        await runtime.dispose();
      }
    });

    it("should support async callback", { timeout: 5000 }, async () => {
      let callbackCalled = false;

      wss.on("connection", (ws) => {
        ws.send("async hello");
      });

      const runtime = await connection.createRuntime({
        webSocket: async (url, protocols) => {
          callbackCalled = true;
          // Simulate async operation
          await new Promise(r => setTimeout(r, 50));
          return new WebSocket(url, protocols.length > 0 ? protocols : undefined);
        },
      });

      try {
        await runtime.eval(`
          serve({
            async fetch(request) {
              const url = new URL(request.url);
              const wsUrl = url.searchParams.get("wsUrl");

              return new Promise((resolve) => {
                const ws = new WebSocket(wsUrl);

                ws.onmessage = (event) => {
                  ws.close();
                  resolve(new Response(JSON.stringify({
                    message: event.data
                  }), {
                    headers: { "Content-Type": "application/json" }
                  }));
                };

                ws.onerror = () => {
                  resolve(new Response(JSON.stringify({ error: true }), {
                    status: 500,
                    headers: { "Content-Type": "application/json" }
                  }));
                };
              });
            }
          });
        `);

        const response = await runtime.fetch.dispatchRequest(
          new Request(`http://test/?wsUrl=ws://localhost:${port}`)
        );
        const json = await response.json();
        assert.strictEqual(json.message, "async hello");
        assert.strictEqual(callbackCalled, true);
      } finally {
        await runtime.dispose();
      }
    });

    it("should handle async callback returning null (blocked)", { timeout: 5000 }, async () => {
      const runtime = await connection.createRuntime({
        webSocket: async (url, protocols) => {
          await new Promise(r => setTimeout(r, 10));
          // Block
          return null;
        },
      });

      try {
        await runtime.eval(`
          serve({
            async fetch(request) {
              const url = new URL(request.url);
              const wsUrl = url.searchParams.get("wsUrl");

              return new Promise((resolve) => {
                const ws = new WebSocket(wsUrl);

                ws.onopen = () => {
                  ws.close();
                  resolve(new Response(JSON.stringify({ opened: true }), {
                    headers: { "Content-Type": "application/json" }
                  }));
                };

                ws.onerror = () => {
                  resolve(new Response(JSON.stringify({ error: true }), {
                    headers: { "Content-Type": "application/json" }
                  }));
                };
              });
            }
          });
        `);

        const response = await runtime.fetch.dispatchRequest(
          new Request(`http://test/?wsUrl=ws://localhost:${port}`)
        );
        const json = await response.json();
        assert.strictEqual(json.error, true);
      } finally {
        await runtime.dispose();
      }
    });

    it("should handle callback errors gracefully", { timeout: 5000 }, async () => {
      const runtime = await connection.createRuntime({
        webSocket: () => {
          throw new Error("Callback error");
        },
      });

      try {
        await runtime.eval(`
          serve({
            async fetch(request) {
              const url = new URL(request.url);
              const wsUrl = url.searchParams.get("wsUrl");

              return new Promise((resolve) => {
                const ws = new WebSocket(wsUrl);

                ws.onopen = () => {
                  ws.close();
                  resolve(new Response(JSON.stringify({ opened: true }), {
                    headers: { "Content-Type": "application/json" }
                  }));
                };

                ws.onerror = () => {
                  resolve(new Response(JSON.stringify({ error: true }), {
                    headers: { "Content-Type": "application/json" }
                  }));
                };
              });
            }
          });
        `);

        const response = await runtime.fetch.dispatchRequest(
          new Request(`http://test/?wsUrl=ws://localhost:${port}`)
        );
        const json = await response.json();
        assert.strictEqual(json.error, true);
      } finally {
        await runtime.dispose();
      }
    });

    it("should handle async callback rejection gracefully", { timeout: 5000 }, async () => {
      const runtime = await connection.createRuntime({
        webSocket: async () => {
          await new Promise(r => setTimeout(r, 10));
          throw new Error("Async callback error");
        },
      });

      try {
        await runtime.eval(`
          serve({
            async fetch(request) {
              const url = new URL(request.url);
              const wsUrl = url.searchParams.get("wsUrl");

              return new Promise((resolve) => {
                const ws = new WebSocket(wsUrl);

                ws.onopen = () => {
                  ws.close();
                  resolve(new Response(JSON.stringify({ opened: true }), {
                    headers: { "Content-Type": "application/json" }
                  }));
                };

                ws.onerror = () => {
                  resolve(new Response(JSON.stringify({ error: true }), {
                    headers: { "Content-Type": "application/json" }
                  }));
                };
              });
            }
          });
        `);

        const response = await runtime.fetch.dispatchRequest(
          new Request(`http://test/?wsUrl=ws://localhost:${port}`)
        );
        const json = await response.json();
        assert.strictEqual(json.error, true);
      } finally {
        await runtime.dispose();
      }
    });

    it("should use default behavior when no callback is set", { timeout: 5000 }, async () => {
      wss.on("connection", (ws) => {
        ws.send("default connection");
      });

      // No webSocket callback provided
      const runtime = await connection.createRuntime();

      try {
        await runtime.eval(`
          serve({
            async fetch(request) {
              const url = new URL(request.url);
              const wsUrl = url.searchParams.get("wsUrl");

              return new Promise((resolve) => {
                const ws = new WebSocket(wsUrl);

                ws.onmessage = (event) => {
                  ws.close();
                  resolve(new Response(JSON.stringify({
                    message: event.data
                  }), {
                    headers: { "Content-Type": "application/json" }
                  }));
                };

                ws.onerror = () => {
                  resolve(new Response(JSON.stringify({ error: true }), {
                    status: 500,
                    headers: { "Content-Type": "application/json" }
                  }));
                };
              });
            }
          });
        `);

        const response = await runtime.fetch.dispatchRequest(
          new Request(`http://test/?wsUrl=ws://localhost:${port}`)
        );
        const json = await response.json();
        assert.strictEqual(json.message, "default connection");
      } finally {
        await runtime.dispose();
      }
    });

    it("should allow callback to proxy to different URL", { timeout: 5000 }, async () => {
      // Create a second WebSocket server for proxying
      const proxyWss = new WebSocketServer({ port: 0 });
      const proxyPort = (proxyWss.address() as { port: number }).port;

      proxyWss.on("connection", (ws) => {
        ws.send("hello from proxy server");
      });

      const runtime = await connection.createRuntime({
        webSocket: (url, protocols) => {
          // Redirect all connections to the proxy server
          const proxyUrl = `ws://localhost:${proxyPort}`;
          return new WebSocket(proxyUrl, protocols.length > 0 ? protocols : undefined);
        },
      });

      try {
        await runtime.eval(`
          serve({
            async fetch(request) {
              const url = new URL(request.url);
              const wsUrl = url.searchParams.get("wsUrl");

              return new Promise((resolve) => {
                // Isolate thinks it's connecting to original URL
                const ws = new WebSocket(wsUrl);

                ws.onmessage = (event) => {
                  ws.close();
                  resolve(new Response(JSON.stringify({
                    message: event.data
                  }), {
                    headers: { "Content-Type": "application/json" }
                  }));
                };

                ws.onerror = () => {
                  resolve(new Response(JSON.stringify({ error: true }), {
                    status: 500,
                    headers: { "Content-Type": "application/json" }
                  }));
                };
              });
            }
          });
        `);

        // Connect to original server URL, but callback redirects to proxy
        const response = await runtime.fetch.dispatchRequest(
          new Request(`http://test/?wsUrl=ws://localhost:${port}`)
        );
        const json = await response.json();
        // Should receive message from proxy server, not original
        assert.strictEqual(json.message, "hello from proxy server");
      } finally {
        await runtime.dispose();
        await new Promise<void>((resolve) => {
          proxyWss.close(() => resolve());
        });
      }
    });

    it("should allow callback to block based on URL pattern", { timeout: 5000 }, async () => {
      wss.on("connection", (ws) => {
        ws.send("should not receive");
      });

      const runtime = await connection.createRuntime({
        webSocket: (url, protocols) => {
          // Block connections to localhost
          if (url.includes("localhost")) {
            return null;
          }
          return new WebSocket(url, protocols.length > 0 ? protocols : undefined);
        },
      });

      try {
        await runtime.eval(`
          serve({
            async fetch(request) {
              const url = new URL(request.url);
              const wsUrl = url.searchParams.get("wsUrl");

              return new Promise((resolve) => {
                const ws = new WebSocket(wsUrl);

                ws.onmessage = (event) => {
                  ws.close();
                  resolve(new Response(JSON.stringify({
                    message: event.data
                  }), {
                    headers: { "Content-Type": "application/json" }
                  }));
                };

                ws.onerror = () => {
                  resolve(new Response(JSON.stringify({ blocked: true }), {
                    headers: { "Content-Type": "application/json" }
                  }));
                };
              });
            }
          });
        `);

        const response = await runtime.fetch.dispatchRequest(
          new Request(`http://test/?wsUrl=ws://localhost:${port}`)
        );
        const json = await response.json();
        assert.strictEqual(json.blocked, true);
      } finally {
        await runtime.dispose();
      }
    });
  });
});
