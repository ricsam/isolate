import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import ivm from "isolated-vm";
import { setupFetch, clearAllInstanceState, type FetchHandle, type WebSocketCommand } from "./index.ts";

describe("WebSocket", () => {
  let isolate: ivm.Isolate;
  let context: ivm.Context;
  let fetchHandle: FetchHandle;

  beforeEach(async () => {
    isolate = new ivm.Isolate();
    context = await isolate.createContext();
    clearAllInstanceState();
    fetchHandle = await setupFetch(context);
  });

  afterEach(() => {
    fetchHandle.dispose();
    context.release();
    isolate.dispose();
  });

  test("server.upgrade() returns true and sets pendingUpgrade with connectionId", async () => {
    context.evalSync(`
      serve({
        fetch(request, server) {
          const upgraded = server.upgrade(request, { data: { userId: "123" } });
          return new Response(upgraded ? "upgrading" : "failed", { status: upgraded ? 101 : 400 });
        }
      });
    `);

    const response = await fetchHandle.dispatchRequest(
      new Request("http://localhost/ws")
    );
    // Note: Status 101 is not valid for native Response, so we expose it via _originalStatus
    // @ts-expect-error - accessing custom property
    assert.strictEqual(response._originalStatus, 101);

    const upgrade = fetchHandle.getUpgradeRequest();
    assert.strictEqual(upgrade?.requested, true);
    assert.strictEqual(typeof upgrade?.connectionId, "string");
    assert.ok(upgrade?.connectionId);
  });

  test("server.upgrade() without data option", async () => {
    context.evalSync(`
      serve({
        fetch(request, server) {
          const upgraded = server.upgrade(request);
          return new Response(null, { status: upgraded ? 101 : 400 });
        }
      });
    `);

    const response = await fetchHandle.dispatchRequest(
      new Request("http://localhost/ws")
    );
    // @ts-expect-error - accessing custom property
    assert.strictEqual(response._originalStatus, 101);

    const upgrade = fetchHandle.getUpgradeRequest();
    assert.strictEqual(upgrade?.requested, true);
    assert.strictEqual(typeof upgrade?.connectionId, "string");
  });

  test("dispatchWebSocketOpen calls websocket.open handler", async () => {
    context.evalSync(`
      globalThis.openedConnections = [];
      serve({
        fetch(request, server) {
          server.upgrade(request, { data: { test: true } });
          return new Response(null, { status: 101 });
        },
        websocket: {
          open(ws) {
            globalThis.openedConnections.push(ws.data);
          }
        }
      });
    `);

    await fetchHandle.dispatchRequest(new Request("http://localhost/ws"));
    const upgrade = fetchHandle.getUpgradeRequest();
    fetchHandle.dispatchWebSocketOpen(upgrade!.connectionId);

    const result = context.evalSync(`JSON.stringify(globalThis.openedConnections)`);
    const connections = JSON.parse(result as string);
    assert.strictEqual(connections.length, 1);
    assert.deepStrictEqual(connections[0], { test: true });
  });

  test("dispatchWebSocketMessage delivers messages to handler", async () => {
    context.evalSync(`
      globalThis.receivedMessages = [];
      serve({
        fetch(request, server) {
          server.upgrade(request);
          return new Response(null, { status: 101 });
        },
        websocket: {
          open(ws) {
            // Need open handler for connection to be established
          },
          message(ws, message) {
            globalThis.receivedMessages.push(message);
          }
        }
      });
    `);

    await fetchHandle.dispatchRequest(new Request("http://localhost/ws"));
    const upgrade = fetchHandle.getUpgradeRequest();
    fetchHandle.dispatchWebSocketOpen(upgrade!.connectionId);
    fetchHandle.dispatchWebSocketMessage(upgrade!.connectionId, "Hello WebSocket!");

    const result = context.evalSync(`JSON.stringify(globalThis.receivedMessages)`);
    const messages = JSON.parse(result as string);
    assert.deepStrictEqual(messages, ["Hello WebSocket!"]);
  });

  test("dispatchWebSocketClose notifies handler with code and reason", async () => {
    context.evalSync(`
      globalThis.closeInfo = null;
      serve({
        fetch(request, server) {
          server.upgrade(request);
          return new Response(null, { status: 101 });
        },
        websocket: {
          open(ws) {
            // Need open handler for connection to be established
          },
          close(ws, code, reason) {
            globalThis.closeInfo = { code, reason };
          }
        }
      });
    `);

    await fetchHandle.dispatchRequest(new Request("http://localhost/ws"));
    const upgrade = fetchHandle.getUpgradeRequest();
    fetchHandle.dispatchWebSocketOpen(upgrade!.connectionId);
    fetchHandle.dispatchWebSocketClose(upgrade!.connectionId, 1000, "Normal closure");

    const result = context.evalSync(`JSON.stringify(globalThis.closeInfo)`);
    const closeInfo = JSON.parse(result as string);
    assert.deepStrictEqual(closeInfo, { code: 1000, reason: "Normal closure" });
  });

  test("dispatchWebSocketError delivers error to handler", async () => {
    context.evalSync(`
      globalThis.errorInfo = null;
      serve({
        fetch(request, server) {
          server.upgrade(request);
          return new Response(null, { status: 101 });
        },
        websocket: {
          open(ws) {
            // Need open handler for connection to be established
          },
          error(ws, error) {
            globalThis.errorInfo = { name: error.name, message: error.message };
          }
        }
      });
    `);

    await fetchHandle.dispatchRequest(new Request("http://localhost/ws"));
    const upgrade = fetchHandle.getUpgradeRequest();
    fetchHandle.dispatchWebSocketOpen(upgrade!.connectionId);
    fetchHandle.dispatchWebSocketError(upgrade!.connectionId, new Error("Connection lost"));

    const result = context.evalSync(`JSON.stringify(globalThis.errorInfo)`);
    const errorInfo = JSON.parse(result as string);
    assert.deepStrictEqual(errorInfo, { name: "Error", message: "Connection lost" });
  });

  test("ws.send() triggers onWebSocketCommand callback", async () => {
    context.evalSync(`
      serve({
        fetch(request, server) {
          server.upgrade(request);
          return new Response(null, { status: 101 });
        },
        websocket: {
          open(ws) {
            ws.send("Welcome!");
          }
        }
      });
    `);

    const commands: WebSocketCommand[] = [];
    fetchHandle.onWebSocketCommand((cmd) => {
      commands.push(cmd);
    });

    await fetchHandle.dispatchRequest(new Request("http://localhost/ws"));
    const upgrade = fetchHandle.getUpgradeRequest();
    fetchHandle.dispatchWebSocketOpen(upgrade!.connectionId);

    assert.strictEqual(commands.length, 1);
    assert.strictEqual(commands[0].type, "message");
    assert.strictEqual(commands[0].connectionId, upgrade!.connectionId);
    assert.strictEqual(commands[0].data, "Welcome!");
  });

  test("ws.close() triggers onWebSocketCommand with close message", async () => {
    context.evalSync(`
      serve({
        fetch(request, server) {
          server.upgrade(request);
          return new Response(null, { status: 101 });
        },
        websocket: {
          open(ws) {
            ws.close(1000, "Goodbye");
          }
        }
      });
    `);

    const commands: WebSocketCommand[] = [];
    fetchHandle.onWebSocketCommand((cmd) => {
      commands.push(cmd);
    });

    await fetchHandle.dispatchRequest(new Request("http://localhost/ws"));
    const upgrade = fetchHandle.getUpgradeRequest();
    fetchHandle.dispatchWebSocketOpen(upgrade!.connectionId);

    assert.strictEqual(commands.length, 1);
    assert.strictEqual(commands[0].type, "close");
    assert.strictEqual(commands[0].connectionId, upgrade!.connectionId);
    assert.strictEqual(commands[0].code, 1000);
    assert.strictEqual(commands[0].reason, "Goodbye");
  });

  test("WebSocket echo server roundtrip", async () => {
    context.evalSync(`
      serve({
        fetch(request, server) {
          server.upgrade(request);
          return new Response(null, { status: 101 });
        },
        websocket: {
          open(ws) {
            // Need open handler for connection to be established
          },
          message(ws, message) {
            ws.send("Echo: " + message);
          }
        }
      });
    `);

    const messages: string[] = [];
    fetchHandle.onWebSocketCommand((cmd) => {
      if (cmd.type === "message") {
        messages.push(cmd.data as string);
      }
    });

    await fetchHandle.dispatchRequest(new Request("http://localhost/ws"));
    const upgrade = fetchHandle.getUpgradeRequest();
    fetchHandle.dispatchWebSocketOpen(upgrade!.connectionId);
    fetchHandle.dispatchWebSocketMessage(upgrade!.connectionId, "Hello");

    assert.deepStrictEqual(messages, ["Echo: Hello"]);
  });

  test("message to unknown connection is ignored", async () => {
    context.evalSync(`
      globalThis.receivedMessages = [];
      serve({
        fetch(request, server) {
          server.upgrade(request);
          return new Response(null, { status: 101 });
        },
        websocket: {
          open(ws) {},
          message(ws, message) {
            globalThis.receivedMessages.push(message);
          }
        }
      });
    `);

    await fetchHandle.dispatchRequest(new Request("http://localhost/ws"));
    const upgrade = fetchHandle.getUpgradeRequest();
    fetchHandle.dispatchWebSocketOpen(upgrade!.connectionId);

    // Send to unknown connection - should not throw
    fetchHandle.dispatchWebSocketMessage("unknown-conn", "Hello");

    const result = context.evalSync(`JSON.stringify(globalThis.receivedMessages)`);
    const messages = JSON.parse(result as string);
    assert.deepStrictEqual(messages, []);
  });

  test("ws.readyState is 1 (OPEN) when connected", async () => {
    context.evalSync(`
      globalThis.readyState = null;
      serve({
        fetch(request, server) {
          server.upgrade(request);
          return new Response(null, { status: 101 });
        },
        websocket: {
          open(ws) {
            globalThis.readyState = ws.readyState;
          }
        }
      });
    `);

    await fetchHandle.dispatchRequest(new Request("http://localhost/ws"));
    const upgrade = fetchHandle.getUpgradeRequest();
    fetchHandle.dispatchWebSocketOpen(upgrade!.connectionId);

    const result = context.evalSync(`globalThis.readyState`);
    assert.strictEqual(result, 1);
  });

  test("multiple connections are tracked independently", async () => {
    context.evalSync(`
      globalThis.messages = {};
      serve({
        fetch(request, server) {
          const match = request.url.match(/id=([^&]+)/);
          const id = match ? match[1] : "unknown";
          server.upgrade(request, { data: { id } });
          return new Response(null, { status: 101 });
        },
        websocket: {
          open(ws) {
            // Need open handler for connection to be established
          },
          message(ws, message) {
            if (!globalThis.messages[ws.data.id]) {
              globalThis.messages[ws.data.id] = [];
            }
            globalThis.messages[ws.data.id].push(message);
          }
        }
      });
    `);

    // Open two connections
    await fetchHandle.dispatchRequest(new Request("http://localhost/ws?id=conn1"));
    const upgrade1 = fetchHandle.getUpgradeRequest();
    fetchHandle.dispatchWebSocketOpen(upgrade1!.connectionId);

    await fetchHandle.dispatchRequest(new Request("http://localhost/ws?id=conn2"));
    const upgrade2 = fetchHandle.getUpgradeRequest();
    fetchHandle.dispatchWebSocketOpen(upgrade2!.connectionId);

    // Send messages to each
    fetchHandle.dispatchWebSocketMessage(upgrade1!.connectionId, "Message to conn1");
    fetchHandle.dispatchWebSocketMessage(upgrade2!.connectionId, "Message to conn2");

    const result = context.evalSync(`JSON.stringify(globalThis.messages)`);
    const messages = JSON.parse(result as string);
    assert.deepStrictEqual(messages, {
      conn1: ["Message to conn1"],
      conn2: ["Message to conn2"],
    });
  });

  test("connection is removed after close", async () => {
    context.evalSync(`
      globalThis.messageCount = 0;
      serve({
        fetch(request, server) {
          server.upgrade(request);
          return new Response(null, { status: 101 });
        },
        websocket: {
          open(ws) {
            // Need open handler for connection to be established
          },
          message(ws, message) {
            globalThis.messageCount++;
          }
        }
      });
    `);

    await fetchHandle.dispatchRequest(new Request("http://localhost/ws"));
    const upgrade = fetchHandle.getUpgradeRequest();
    fetchHandle.dispatchWebSocketOpen(upgrade!.connectionId);
    fetchHandle.dispatchWebSocketMessage(upgrade!.connectionId, "Before close");
    fetchHandle.dispatchWebSocketClose(upgrade!.connectionId, 1000, "Normal");

    // Message after close should be ignored
    fetchHandle.dispatchWebSocketMessage(upgrade!.connectionId, "After close");

    const result = context.evalSync(`globalThis.messageCount`);
    assert.strictEqual(result, 1);
  });

  test("hasActiveConnections returns correct state", async () => {
    assert.strictEqual(fetchHandle.hasActiveConnections(), false);

    context.evalSync(`
      serve({
        fetch(request, server) {
          server.upgrade(request);
          return new Response(null, { status: 101 });
        },
        websocket: {
          open(ws) {}
        }
      });
    `);

    await fetchHandle.dispatchRequest(new Request("http://localhost/ws"));
    const upgrade = fetchHandle.getUpgradeRequest();
    fetchHandle.dispatchWebSocketOpen(upgrade!.connectionId);

    assert.strictEqual(fetchHandle.hasActiveConnections(), true);

    fetchHandle.dispatchWebSocketClose(upgrade!.connectionId, 1000, "Normal");

    assert.strictEqual(fetchHandle.hasActiveConnections(), false);
  });

  describe("close handler data access", () => {
    test("close handler can access ws.data set during upgrade", async () => {
      context.evalSync(`
        globalThis.closeHandlerData = null;
        serve({
          fetch(request, server) {
            server.upgrade(request, { data: { userId: "user123", sessionId: "sess456" } });
            return new Response(null, { status: 101 });
          },
          websocket: {
            open(ws) {
              // Connection established
            },
            close(ws, code, reason) {
              globalThis.closeHandlerData = ws.data;
            }
          }
        });
      `);

      await fetchHandle.dispatchRequest(new Request("http://localhost/ws"));
      const upgrade = fetchHandle.getUpgradeRequest();
      fetchHandle.dispatchWebSocketOpen(upgrade!.connectionId);
      fetchHandle.dispatchWebSocketClose(upgrade!.connectionId, 1000, "Normal");

      const result = context.evalSync(`JSON.stringify(globalThis.closeHandlerData)`);
      const data = JSON.parse(result as string);
      assert.deepStrictEqual(data, { userId: "user123", sessionId: "sess456" });
    });

    test("close handler can access ws.data modified during message handling", async () => {
      context.evalSync(`
        globalThis.closeHandlerData = null;
        serve({
          fetch(request, server) {
            server.upgrade(request, { data: {} });
            return new Response(null, { status: 101 });
          },
          websocket: {
            open(ws) {
              // Initial data is empty
            },
            message(ws, message) {
              if (message === "join:Alice") {
                ws.data.username = "Alice";
                ws.data.joinedAt = Date.now();
              }
            },
            close(ws, code, reason) {
              globalThis.closeHandlerData = ws.data;
            }
          }
        });
      `);

      await fetchHandle.dispatchRequest(new Request("http://localhost/ws"));
      const upgrade = fetchHandle.getUpgradeRequest();
      fetchHandle.dispatchWebSocketOpen(upgrade!.connectionId);
      fetchHandle.dispatchWebSocketMessage(upgrade!.connectionId, "join:Alice");
      fetchHandle.dispatchWebSocketClose(upgrade!.connectionId, 1000, "Normal");

      const result = context.evalSync(`JSON.stringify(globalThis.closeHandlerData)`);
      const data = JSON.parse(result as string);
      assert.strictEqual(data.username, "Alice");
      assert.strictEqual(typeof data.joinedAt, "number");
    });

    test("close handler requires open handler for connection tracking", async () => {
      context.evalSync(`
        globalThis.closeCalled = false;
        serve({
          fetch(request, server) {
            server.upgrade(request, { data: { test: true } });
            return new Response(null, { status: 101 });
          },
          websocket: {
            open(ws) {
              // Must define open handler for connection tracking
            },
            close(ws, code, reason) {
              globalThis.closeCalled = true;
            }
          }
        });
      `);

      await fetchHandle.dispatchRequest(new Request("http://localhost/ws"));
      const upgrade = fetchHandle.getUpgradeRequest();
      fetchHandle.dispatchWebSocketOpen(upgrade!.connectionId);
      fetchHandle.dispatchWebSocketClose(upgrade!.connectionId, 1000, "Normal");

      const result = context.evalSync(`globalThis.closeCalled`);
      assert.strictEqual(result, true);
    });

    test("multiple connections close handlers receive correct data", async () => {
      context.evalSync(`
        globalThis.closedUsers = [];
        serve({
          fetch(request, server) {
            const match = request.url.match(/user=([^&]+)/);
            const username = match ? match[1] : "unknown";
            server.upgrade(request, { data: { username } });
            return new Response(null, { status: 101 });
          },
          websocket: {
            open(ws) {
              // Connection established
            },
            close(ws, code, reason) {
              globalThis.closedUsers.push(ws.data.username);
            }
          }
        });
      `);

      // Open three connections
      await fetchHandle.dispatchRequest(new Request("http://localhost/ws?user=Alice"));
      const upgrade1 = fetchHandle.getUpgradeRequest();
      fetchHandle.dispatchWebSocketOpen(upgrade1!.connectionId);

      await fetchHandle.dispatchRequest(new Request("http://localhost/ws?user=Bob"));
      const upgrade2 = fetchHandle.getUpgradeRequest();
      fetchHandle.dispatchWebSocketOpen(upgrade2!.connectionId);

      await fetchHandle.dispatchRequest(new Request("http://localhost/ws?user=Charlie"));
      const upgrade3 = fetchHandle.getUpgradeRequest();
      fetchHandle.dispatchWebSocketOpen(upgrade3!.connectionId);

      // Close them in different order
      fetchHandle.dispatchWebSocketClose(upgrade2!.connectionId, 1000, "Normal");
      fetchHandle.dispatchWebSocketClose(upgrade1!.connectionId, 1000, "Normal");
      fetchHandle.dispatchWebSocketClose(upgrade3!.connectionId, 1000, "Normal");

      const result = context.evalSync(`JSON.stringify(globalThis.closedUsers)`);
      const closedUsers = JSON.parse(result as string);
      assert.deepStrictEqual(closedUsers, ["Bob", "Alice", "Charlie"]);
    });

    test("close handler can broadcast to other connections", async () => {
      context.evalSync(`
        globalThis.connections = new Map();
        globalThis.broadcastMessages = [];
        serve({
          fetch(request, server) {
            const match = request.url.match(/user=([^&]+)/);
            const username = match ? match[1] : "unknown";
            server.upgrade(request, { data: { username } });
            return new Response(null, { status: 101 });
          },
          websocket: {
            open(ws) {
              globalThis.connections.set(ws.data.username, ws);
            },
            close(ws, code, reason) {
              const username = ws.data.username;
              globalThis.connections.delete(username);
              for (const [name, otherWs] of globalThis.connections) {
                otherWs.send("userLeft:" + username);
                globalThis.broadcastMessages.push({ to: name, about: username });
              }
            }
          }
        });
      `);

      const commands: WebSocketCommand[] = [];
      fetchHandle.onWebSocketCommand((cmd) => {
        commands.push(cmd);
      });

      // Open three connections
      await fetchHandle.dispatchRequest(new Request("http://localhost/ws?user=Alice"));
      const upgrade1 = fetchHandle.getUpgradeRequest();
      fetchHandle.dispatchWebSocketOpen(upgrade1!.connectionId);

      await fetchHandle.dispatchRequest(new Request("http://localhost/ws?user=Bob"));
      const upgrade2 = fetchHandle.getUpgradeRequest();
      fetchHandle.dispatchWebSocketOpen(upgrade2!.connectionId);

      await fetchHandle.dispatchRequest(new Request("http://localhost/ws?user=Charlie"));
      const upgrade3 = fetchHandle.getUpgradeRequest();
      fetchHandle.dispatchWebSocketOpen(upgrade3!.connectionId);

      // Bob disconnects - should broadcast to Alice and Charlie
      fetchHandle.dispatchWebSocketClose(upgrade2!.connectionId, 1000, "Normal");

      const result = context.evalSync(`JSON.stringify(globalThis.broadcastMessages)`);
      const broadcasts = JSON.parse(result as string);

      // Should have 2 broadcasts (to Alice and Charlie)
      assert.strictEqual(broadcasts.length, 2);
      assert.deepStrictEqual(broadcasts.map((b: { about: string }) => b.about), ["Bob", "Bob"]);
      assert.deepStrictEqual(broadcasts.map((b: { to: string }) => b.to).sort(), ["Alice", "Charlie"]);
    });
  });
});
