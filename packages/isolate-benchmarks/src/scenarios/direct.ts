import { createServer, type Server } from "node:http";
import { createServerAdapter } from "@whatwg-node/server";
import { WebSocketServer, WebSocket } from "ws";
import type { BenchmarkScenario } from "../types.ts";

export class DirectScenario implements BenchmarkScenario {
  name = "Direct Node.js";

  private server: Server | null = null;
  private wss: WebSocketServer | null = null;
  private port = 0;
  private storedPayload: Uint8Array | null = null;

  async setup(): Promise<void> {
    const adapter = createServerAdapter((request: Request) => {
      const url = new URL(request.url);

      if (request.method === "POST" && url.pathname === "/upload") {
        return request.arrayBuffer().then((buffer) => {
          this.storedPayload = new Uint8Array(buffer);
          return new Response(JSON.stringify({ received: buffer.byteLength }), {
            headers: { "Content-Type": "application/json" },
          });
        });
      }

      if (request.method === "GET" && url.pathname === "/download") {
        return new Response(this.storedPayload);
      }

      return new Response("Not found", { status: 404 });
    });

    this.server = createServer(adapter);

    this.wss = new WebSocketServer({ server: this.server });
    this.wss.on("connection", (ws) => {
      ws.on("message", (data) => {
        ws.send("pong:" + data.toString());
      });
    });

    await new Promise<void>((resolve) => {
      this.server!.listen(0, () => {
        const addr = this.server!.address();
        if (addr && typeof addr === "object") {
          this.port = addr.port;
        }
        resolve();
      });
    });
  }

  async teardown(): Promise<void> {
    if (this.wss) {
      this.wss.close();
      this.wss = null;
    }
    if (this.server) {
      await new Promise<void>((resolve) => {
        this.server!.close(() => resolve());
      });
      this.server = null;
    }
    this.storedPayload = null;
  }

  async runFileTransfer(payload: Uint8Array): Promise<number> {
    const start = performance.now();

    // Upload
    const uploadRes = await fetch(`http://localhost:${this.port}/upload`, {
      method: "POST",
      body: payload,
    });
    await uploadRes.json();

    // Download
    const downloadRes = await fetch(`http://localhost:${this.port}/download`);
    await downloadRes.arrayBuffer();

    return performance.now() - start;
  }

  async runWebSocketPingPong(count: number): Promise<number> {
    return new Promise((resolve) => {
      const ws = new WebSocket(`ws://localhost:${this.port}`);
      let received = 0;
      let start = 0;

      ws.on("open", () => {
        start = performance.now();
        ws.send("ping:0");
      });

      ws.on("message", () => {
        received++;
        if (received >= count) {
          ws.close();
          resolve(performance.now() - start);
        } else {
          ws.send(`ping:${received}`);
        }
      });
    });
  }
}
