import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { createModuleResolver } from "../index.ts";
import { createTestHost, createTestId } from "../testing/integration-helpers.ts";
import type { IsolateHost } from "../types.ts";

describe("AppServer WebSocket integration", () => {
  let host: IsolateHost;
  let cleanup: (() => Promise<void>) | undefined;

  before(async () => {
    const testHost = await createTestHost("app-server-websocket");
    host = testHost.host;
    cleanup = testHost.cleanup;
  });

  after(async () => {
    await cleanup?.();
  });

  test("round-trips websocket open, message, and close through the public server API", async () => {
    const commands: Array<{
      type: "message" | "close";
      connectionId: string;
      data?: string | ArrayBuffer;
      code?: number;
      reason?: string;
    }> = [];

    const server = await host.createAppServer({
      key: createTestId("websocket-roundtrip"),
      entry: "/server.ts",
      bindings: {
        modules: createModuleResolver().virtual(
          "/server.ts",
          `
            let closeEvents = [];

            serve({
              fetch(request, server) {
                const pathname = new URL(request.url).pathname;

                if (pathname === "/status") {
                  return Response.json({ closeEvents });
                }

                if (request.headers.get("Upgrade") === "websocket") {
                  server.upgrade(request);
                  return new Response(null, { status: 101 });
                }

                return new Response("not found", { status: 404 });
              },
              websocket: {
                open(ws) {
                  ws.send("opened");
                },
                message(ws, message) {
                  ws.send("echo:" + message);
                },
                close(_ws, code, reason) {
                  closeEvents.push({ code, reason });
                },
              },
            });
          `,
        ),
      },
      webSockets: {
        onCommand(command) {
          commands.push(command);
        },
      },
    });

    try {
      const upgradeResult = await server.handle(
        new Request("http://localhost/ws", {
          headers: { Upgrade: "websocket" },
        }),
      );

      assert.equal(upgradeResult.type, "websocket");
      const connectionId = upgradeResult.upgradeData.connectionId;
      assert.ok(connectionId);

      await server.ws.open(connectionId);
      await delay(50);

      const openMessage = commands.find((command) => (
        command.type === "message" &&
        command.connectionId === connectionId &&
        command.data === "opened"
      ));
      assert.ok(openMessage, "expected isolate open handler to send a welcome message");

      await server.ws.message(connectionId, "ping");
      await delay(50);

      const echoMessage = commands.find((command) => (
        command.type === "message" &&
        command.connectionId === connectionId &&
        command.data === "echo:ping"
      ));
      assert.ok(echoMessage, "expected isolate message handler to echo host messages");

      await server.ws.close(connectionId, 1001, "host closing");
      await delay(50);

      const statusResult = await server.handle(new Request("http://localhost/status"));
      assert.equal(statusResult.type, "response");
      const status = await statusResult.response.json() as {
        closeEvents: Array<{ code: number; reason: string }>;
      };

      assert.deepEqual(status.closeEvents, [{ code: 1001, reason: "host closing" }]);
    } finally {
      await server.dispose({ hard: true, reason: "test cleanup" });
    }
  });
});
