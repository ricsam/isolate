import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import { createServer, type Server } from "node:http";
import { connect, type DaemonConnection } from "./index.ts";
import { startDaemon, type DaemonHandle } from "@ricsam/isolate-daemon";

const TEST_SOCKET = "/tmp/isolate-fetch-response-test.sock";

describe("Fetch response (daemon/client)", () => {
  let daemon: DaemonHandle;
  let connection: DaemonConnection;
  let server: Server;
  let port: number;

  beforeEach(async () => {
    server = createServer((req, res) => {
      const url = new URL(req.url!, `http://localhost`);

      if (req.url === "/echo") {
        let body = "";
        req.on("data", (chunk: Buffer) => {
          body += chunk.toString();
        });
        req.on("end", () => {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ method: req.method, body: body || null }));
        });
        return;
      }

      if (url.pathname === "/status") {
        const code = parseInt(url.searchParams.get("code") || "200", 10);
        if (code === 204) {
          res.writeHead(204);
          res.end();
        } else {
          res.writeHead(code, { "Content-Type": "text/plain" });
          res.end(`status ${code}`);
        }
        return;
      }

      if (req.url === "/headers") {
        const custom = req.headers["x-custom-header"] || "";
        res.writeHead(200, {
          "Content-Type": "application/json",
          "X-Response-Header": "resp-value",
        });
        res.end(JSON.stringify({ received: custom }));
        return;
      }

      if (req.url === "/text-body") {
        res.writeHead(200, { "Content-Type": "text/plain" });
        res.end("plain text body");
        return;
      }

      if (req.url === "/json-body") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ key: "value" }));
        return;
      }

      if (req.url === "/binary-body") {
        const buf = Buffer.from([0x00, 0x01, 0x02, 0x03]);
        res.writeHead(200, { "Content-Type": "application/octet-stream" });
        res.end(buf);
        return;
      }

      if (req.url === "/error-json") {
        res.writeHead(422, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "validation failed" }));
        return;
      }

      if (req.url === "/error-text") {
        res.writeHead(503, { "Content-Type": "text/plain" });
        res.end("service unavailable");
        return;
      }

      res.writeHead(404);
      res.end();
    });

    await new Promise<void>((resolve) => {
      server.listen(0, () => {
        const addr = server.address();
        port = typeof addr === "object" && addr ? addr.port : 0;
        resolve();
      });
    });

    daemon = await startDaemon({ socketPath: TEST_SOCKET });
    connection = await connect({ socket: TEST_SOCKET });
  });

  afterEach(async () => {
    await connection.close();
    await daemon.close();
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });

  // --- HTTP Methods ---

  describe("HTTP methods", () => {
    for (const method of ["POST", "PUT", "DELETE", "PATCH"] as const) {
      it(`${method} request`, { timeout: 5000 }, async () => {
        const runtime = await connection.createRuntime({
          fetch: async (url, init) => fetch(url, init),
        });
        try {
          const hasBody = method !== "DELETE";
          await runtime.eval(`
            serve({
              async fetch(request) {
                const url = new URL(request.url);
                const target = url.searchParams.get("target");
                const res = await fetch(target, {
                  method: "${method}",
                  ${hasBody ? 'headers: { "Content-Type": "application/json" }, body: JSON.stringify({ data: 1 }),' : ""}
                });
                return new Response(await res.text(), {
                  headers: { "Content-Type": "application/json" },
                });
              }
            });
          `);

          const response = await runtime.fetch.dispatchRequest(
            new Request(`http://test/?target=http://localhost:${port}/echo`)
          );
          const json = await response.json();
          assert.strictEqual(json.method, method);
          if (hasBody) {
            assert.deepStrictEqual(JSON.parse(json.body), { data: 1 });
          }
        } finally {
          await runtime.dispose();
        }
      });
    }
  });

  // --- Status Codes ---

  describe("Response status codes", () => {
    for (const code of [201, 204, 400, 404, 500]) {
      it(`status ${code}`, { timeout: 5000 }, async () => {
        const runtime = await connection.createRuntime({
          fetch: async (url, init) => fetch(url, init),
        });
        try {
          await runtime.eval(`
            serve({
              async fetch(request) {
                const url = new URL(request.url);
                const target = url.searchParams.get("target");
                const res = await fetch(target);
                const body = ${code === 204 ? '""' : "await res.text()"};
                return new Response(JSON.stringify({ status: res.status, body }), {
                  headers: { "Content-Type": "application/json" },
                });
              }
            });
          `);

          const response = await runtime.fetch.dispatchRequest(
            new Request(
              `http://test/?target=http://localhost:${port}/status?code=${code}`
            )
          );
          const json = await response.json();
          assert.strictEqual(json.status, code);
          if (code === 204) {
            assert.strictEqual(json.body, "");
          } else {
            assert.strictEqual(json.body, `status ${code}`);
          }
        } finally {
          await runtime.dispose();
        }
      });
    }
  });

  // --- Headers ---

  describe("Headers", () => {
    it("custom request headers forwarded", { timeout: 5000 }, async () => {
      const runtime = await connection.createRuntime({
        fetch: async (url, init) => fetch(url, init),
      });
      try {
        await runtime.eval(`
          serve({
            async fetch(request) {
              const url = new URL(request.url);
              const target = url.searchParams.get("target");
              const res = await fetch(target, {
                headers: { "X-Custom-Header": "test-value" },
              });
              return new Response(await res.text(), {
                headers: { "Content-Type": "application/json" },
              });
            }
          });
        `);

        const response = await runtime.fetch.dispatchRequest(
          new Request(`http://test/?target=http://localhost:${port}/headers`)
        );
        const json = await response.json();
        assert.strictEqual(json.received, "test-value");
      } finally {
        await runtime.dispose();
      }
    });

    it("response headers readable", { timeout: 5000 }, async () => {
      const runtime = await connection.createRuntime({
        fetch: async (url, init) => fetch(url, init),
      });
      try {
        await runtime.eval(`
          serve({
            async fetch(request) {
              const url = new URL(request.url);
              const target = url.searchParams.get("target");
              const res = await fetch(target);
              const headerVal = res.headers.get("x-response-header");
              return new Response(JSON.stringify({ header: headerVal }), {
                headers: { "Content-Type": "application/json" },
              });
            }
          });
        `);

        const response = await runtime.fetch.dispatchRequest(
          new Request(`http://test/?target=http://localhost:${port}/headers`)
        );
        const json = await response.json();
        assert.strictEqual(json.header, "resp-value");
      } finally {
        await runtime.dispose();
      }
    });

    it("content-type preserved", { timeout: 5000 }, async () => {
      const runtime = await connection.createRuntime({
        fetch: async (url, init) => fetch(url, init),
      });
      try {
        await runtime.eval(`
          serve({
            async fetch(request) {
              const url = new URL(request.url);
              const target = url.searchParams.get("target");
              const res = await fetch(target);
              const ct = res.headers.get("content-type");
              return new Response(JSON.stringify({ contentType: ct }), {
                headers: { "Content-Type": "application/json" },
              });
            }
          });
        `);

        const response = await runtime.fetch.dispatchRequest(
          new Request(`http://test/?target=http://localhost:${port}/json-body`)
        );
        const json = await response.json();
        assert.strictEqual(json.contentType, "application/json");
      } finally {
        await runtime.dispose();
      }
    });
  });

  // --- Response body methods ---

  describe("Response body methods", () => {
    it("res.text()", { timeout: 5000 }, async () => {
      const runtime = await connection.createRuntime({
        fetch: async (url, init) => fetch(url, init),
      });
      try {
        await runtime.eval(`
          serve({
            async fetch(request) {
              const url = new URL(request.url);
              const target = url.searchParams.get("target");
              const res = await fetch(target);
              return new Response(await res.text(), {
                headers: { "Content-Type": "text/plain" },
              });
            }
          });
        `);

        const response = await runtime.fetch.dispatchRequest(
          new Request(`http://test/?target=http://localhost:${port}/text-body`)
        );
        assert.strictEqual(await response.text(), "plain text body");
      } finally {
        await runtime.dispose();
      }
    });

    it("res.json()", { timeout: 5000 }, async () => {
      const runtime = await connection.createRuntime({
        fetch: async (url, init) => fetch(url, init),
      });
      try {
        await runtime.eval(`
          serve({
            async fetch(request) {
              const url = new URL(request.url);
              const target = url.searchParams.get("target");
              const res = await fetch(target);
              const data = await res.json();
              return new Response(JSON.stringify(data), {
                headers: { "Content-Type": "application/json" },
              });
            }
          });
        `);

        const response = await runtime.fetch.dispatchRequest(
          new Request(`http://test/?target=http://localhost:${port}/json-body`)
        );
        assert.deepStrictEqual(await response.json(), { key: "value" });
      } finally {
        await runtime.dispose();
      }
    });

    it("res.arrayBuffer()", { timeout: 5000 }, async () => {
      const runtime = await connection.createRuntime({
        fetch: async (url, init) => fetch(url, init),
      });
      try {
        await runtime.eval(`
          serve({
            async fetch(request) {
              const url = new URL(request.url);
              const target = url.searchParams.get("target");
              const res = await fetch(target);
              const buf = await res.arrayBuffer();
              const arr = Array.from(new Uint8Array(buf));
              return new Response(JSON.stringify(arr), {
                headers: { "Content-Type": "application/json" },
              });
            }
          });
        `);

        const response = await runtime.fetch.dispatchRequest(
          new Request(
            `http://test/?target=http://localhost:${port}/binary-body`
          )
        );
        const arr = await response.json();
        assert.deepStrictEqual(arr, [0, 1, 2, 3]);
      } finally {
        await runtime.dispose();
      }
    });

    it("res.blob()", { timeout: 5000 }, async () => {
      const runtime = await connection.createRuntime({
        fetch: async (url, init) => fetch(url, init),
      });
      try {
        await runtime.eval(`
          serve({
            async fetch(request) {
              const url = new URL(request.url);
              const target = url.searchParams.get("target");
              const res = await fetch(target);
              const blob = await res.blob();
              return new Response(JSON.stringify({ size: blob.size, type: blob.type }), {
                headers: { "Content-Type": "application/json" },
              });
            }
          });
        `);

        const response = await runtime.fetch.dispatchRequest(
          new Request(
            `http://test/?target=http://localhost:${port}/binary-body`
          )
        );
        const json = await response.json();
        assert.strictEqual(json.size, 4);
        assert.strictEqual(json.type, "application/octet-stream");
      } finally {
        await runtime.dispose();
      }
    });
  });

  // --- Error responses ---

  describe("Error responses", () => {
    it("4xx with JSON error body", { timeout: 5000 }, async () => {
      const runtime = await connection.createRuntime({
        fetch: async (url, init) => fetch(url, init),
      });
      try {
        await runtime.eval(`
          serve({
            async fetch(request) {
              const url = new URL(request.url);
              const target = url.searchParams.get("target");
              const res = await fetch(target);
              const data = await res.json();
              return new Response(JSON.stringify({ status: res.status, ...data }), {
                headers: { "Content-Type": "application/json" },
              });
            }
          });
        `);

        const response = await runtime.fetch.dispatchRequest(
          new Request(
            `http://test/?target=http://localhost:${port}/error-json`
          )
        );
        const json = await response.json();
        assert.strictEqual(json.status, 422);
        assert.strictEqual(json.error, "validation failed");
      } finally {
        await runtime.dispose();
      }
    });

    it("5xx with text error body", { timeout: 5000 }, async () => {
      const runtime = await connection.createRuntime({
        fetch: async (url, init) => fetch(url, init),
      });
      try {
        await runtime.eval(`
          serve({
            async fetch(request) {
              const url = new URL(request.url);
              const target = url.searchParams.get("target");
              const res = await fetch(target);
              const text = await res.text();
              return new Response(JSON.stringify({ status: res.status, body: text }), {
                headers: { "Content-Type": "application/json" },
              });
            }
          });
        `);

        const response = await runtime.fetch.dispatchRequest(
          new Request(
            `http://test/?target=http://localhost:${port}/error-text`
          )
        );
        const json = await response.json();
        assert.strictEqual(json.status, 503);
        assert.strictEqual(json.body, "service unavailable");
      } finally {
        await runtime.dispose();
      }
    });
  });
});
