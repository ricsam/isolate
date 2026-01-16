import { startDaemon, type DaemonHandle } from "@ricsam/isolate-daemon";
import { connect, type DaemonConnection, type RemoteRuntime } from "@ricsam/isolate-client";
import type { BenchmarkScenario } from "../types.ts";

const SOCKET_PATH = "/tmp/isolate-benchmark-daemon.sock";

export class IsolateClientScenario implements BenchmarkScenario {
  name = "Isolate Client + Daemon";

  private daemon: DaemonHandle | null = null;
  private client: DaemonConnection | null = null;
  private runtime: RemoteRuntime | null = null;

  async setup(): Promise<void> {
    // Start daemon
    this.daemon = await startDaemon({ socketPath: SOCKET_PATH });

    // Connect client
    this.client = await connect({ socket: SOCKET_PATH });

    // Create runtime
    this.runtime = await this.client.createRuntime({
      memoryLimitMB: 256,
    });

    await this.runtime.eval(`
      globalThis.storedPayload = null;

      serve({
        fetch(request, server) {
          const url = new URL(request.url);

          if (request.method === "POST" && url.pathname === "/upload") {
            return request.arrayBuffer().then((buffer) => {
              globalThis.storedPayload = new Uint8Array(buffer);
              return new Response(JSON.stringify({ received: buffer.byteLength }), {
                headers: { "Content-Type": "application/json" },
              });
            });
          }

          if (request.method === "GET" && url.pathname === "/download") {
            return new Response(globalThis.storedPayload);
          }

          if (url.pathname === "/ws") {
            server.upgrade(request);
            return new Response(null, { status: 101 });
          }

          return new Response("Not found", { status: 404 });
        },
        websocket: {
          open(ws) {},
          message(ws, message) {
            ws.send("pong:" + message);
          },
        },
      });
    `);
  }

  async teardown(): Promise<void> {
    if (this.runtime) {
      await this.runtime.dispose();
      this.runtime = null;
    }
    if (this.client) {
      await this.client.close();
      this.client = null;
    }
    if (this.daemon) {
      await this.daemon.close();
      this.daemon = null;
    }
  }

  async runFileTransfer(payload: Uint8Array): Promise<number> {
    const start = performance.now();

    // Upload using streaming
    let offset = 0;
    const chunkSize = 64 * 1024;
    const stream = new ReadableStream({
      pull(controller) {
        if (offset < payload.length) {
          const end = Math.min(offset + chunkSize, payload.length);
          controller.enqueue(payload.slice(offset, end));
          offset = end;
        } else {
          controller.close();
        }
      },
    });

    const uploadReq = new Request("http://localhost/upload", {
      method: "POST",
      body: stream,
      // @ts-expect-error Node.js requires duplex for streaming bodies
      duplex: "half",
    });
    const uploadRes = await this.runtime!.fetch.dispatchRequest(uploadReq);
    await uploadRes.json();

    // Download
    const downloadReq = new Request("http://localhost/download");
    const downloadRes = await this.runtime!.fetch.dispatchRequest(downloadReq);
    await downloadRes.arrayBuffer();

    return performance.now() - start;
  }

  async runWebSocketPingPong(count: number): Promise<number> {
    return new Promise((resolve, reject) => {
      const start = performance.now();
      let received = 0;
      let connectionId: string;

      const unsubscribe = this.runtime!.fetch.onWebSocketCommand((cmd) => {
        if (cmd.type === "message") {
          received++;
          if (received >= count) {
            this.runtime!.fetch.dispatchWebSocketClose(connectionId, 1000, "done")
              .then(() => {
                unsubscribe();
                resolve(performance.now() - start);
              })
              .catch(reject);
          } else {
            // Use setImmediate to prevent stack overflow with many messages
            setImmediate(() => {
              this.runtime!.fetch.dispatchWebSocketMessage(connectionId, `ping:${received}`);
            });
          }
        }
      });

      // Trigger WebSocket upgrade
      const req = new Request("http://localhost/ws");
      this.runtime!.fetch.dispatchRequest(req).then(async () => {
        const upgrade = await this.runtime!.fetch.getUpgradeRequest();
        connectionId = upgrade!.connectionId;
        await this.runtime!.fetch.dispatchWebSocketOpen(connectionId);
        await this.runtime!.fetch.dispatchWebSocketMessage(connectionId, "ping:0");
      }).catch(reject);
    });
  }
}
