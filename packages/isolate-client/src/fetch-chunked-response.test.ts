import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import { createServer, type Server } from "node:http";
import { connect, type DaemonConnection } from "./index.ts";
import { startDaemon, type DaemonHandle } from "@ricsam/isolate-daemon";

const TEST_SOCKET = "/tmp/isolate-fetch-chunked-response-test.sock";

describe("Fetch chunked response (daemon/client)", () => {
  let daemon: DaemonHandle;
  let connection: DaemonConnection;
  let server: Server;
  let port: number;

  beforeEach(async () => {
    server = createServer((req, res) => {
      if (req.url === "/json") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ users: [] }));
      } else if (req.url === "/text") {
        res.writeHead(200, { "Content-Type": "text/plain" });
        res.end("hello world");
      } else if (req.url === "/large") {
        res.writeHead(200, { "Content-Type": "text/plain", "Transfer-Encoding": "chunked" });
        const chunk = "x".repeat(1024);
        let i = 0;
        const interval = setInterval(() => {
          res.write(chunk);
          i++;
          if (i >= 64) {
            clearInterval(interval);
            res.end();
          }
        }, 1);
      } else if (req.url === "/sse") {
        res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "Connection": "keep-alive" });
        for (let i = 0; i < 3; i++) {
          res.write(`data: {"n":${i}}\n\n`);
        }
        res.end();
      } else if (req.url === "/post-stream" && req.method === "POST") {
        let body = "";
        req.on("data", (chunk) => { body += chunk; });
        req.on("end", () => {
          res.writeHead(200, { "Content-Type": "text/plain", "Transfer-Encoding": "chunked" });
          const parts = [body.slice(0, Math.floor(body.length / 2)), body.slice(Math.floor(body.length / 2))];
          res.write(parts[0]);
          res.write(parts[1]);
          res.end();
        });
      } else {
        res.writeHead(404);
        res.end();
      }
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

  it("chunked response - text()", { timeout: 5000 }, async () => {
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
        new Request(`http://test/?target=http://localhost:${port}/json`)
      );
      const text = await response.text();
      assert.strictEqual(text, JSON.stringify({ users: [] }));
    } finally {
      await runtime.dispose();
    }
  });

  it("chunked response - arrayBuffer()", { timeout: 5000 }, async () => {
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
            return new Response(new TextDecoder().decode(buf), {
              headers: { "Content-Type": "text/plain" },
            });
          }
        });
      `);

      const response = await runtime.fetch.dispatchRequest(
        new Request(`http://test/?target=http://localhost:${port}/json`)
      );
      const text = await response.text();
      assert.strictEqual(text, JSON.stringify({ users: [] }));
    } finally {
      await runtime.dispose();
    }
  });

  it("chunked response - json()", { timeout: 5000 }, async () => {
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
        new Request(`http://test/?target=http://localhost:${port}/json`)
      );
      const data = await response.json();
      assert.deepStrictEqual(data, { users: [] });
    } finally {
      await runtime.dispose();
    }
  });

  it("fetch callback chunked - text()", { timeout: 5000 }, async () => {
    const runtime = await connection.createRuntime({
      fetch: async () => {
        return new Response("hello world");
      },
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
        new Request("http://test/?target=http://example.com/")
      );
      const text = await response.text();
      assert.strictEqual(text, "hello world");
    } finally {
      await runtime.dispose();
    }
  });

  it("fetch callback chunked - json()", { timeout: 5000 }, async () => {
    const runtime = await connection.createRuntime({
      fetch: async () => {
        return new Response(JSON.stringify({ users: [] }), {
          headers: { "Content-Type": "application/json" },
        });
      },
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
        new Request("http://test/?target=http://example.com/")
      );
      const data = await response.json();
      assert.deepStrictEqual(data, { users: [] });
    } finally {
      await runtime.dispose();
    }
  });

  it("streaming large download - passthrough", { timeout: 10000 }, async () => {
    const runtime = await connection.createRuntime({
      fetch: async (url, init) => fetch(url, init),
    });
    try {
      await runtime.eval(`
        serve({
          async fetch(request) {
            const url = new URL(request.url);
            const target = url.searchParams.get("target");
            return fetch(target);
          }
        });
      `);

      const response = await runtime.fetch.dispatchRequest(
        new Request(`http://test/?target=http://localhost:${port}/large`)
      );
      const text = await response.text();
      assert.strictEqual(text.length, 64 * 1024);
    } finally {
      await runtime.dispose();
    }
  });

  it("streaming large download - in-isolate", { timeout: 10000 }, async () => {
    const runtime = await connection.createRuntime({
      fetch: async (url, init) => fetch(url, init),
      testEnvironment: true,
    });
    try {
      await runtime.eval(`
        describe("large download", () => {
          it("should receive 64KB", async () => {
            const res = await fetch("http://localhost:${port}/large");
            const text = await res.text();
            expect(text.length).toBe(65536);
          });
        });
      `);

      const results = await runtime.testEnvironment.runTests();
      assert.strictEqual(results.failed, 0, `Expected no failures but got ${results.failed}`);
    } finally {
      await runtime.dispose();
    }
  });

  it("SSE streaming - passthrough", { timeout: 10000 }, async () => {
    const runtime = await connection.createRuntime({
      fetch: async (url, init) => fetch(url, init),
    });
    try {
      await runtime.eval(`
        serve({
          async fetch(request) {
            const url = new URL(request.url);
            const target = url.searchParams.get("target");
            return fetch(target);
          }
        });
      `);

      const response = await runtime.fetch.dispatchRequest(
        new Request(`http://test/?target=http://localhost:${port}/sse`)
      );
      const text = await response.text();
      assert.ok(text.includes('data: {"n":0}'), "should contain first event");
      assert.ok(text.includes('data: {"n":1}'), "should contain second event");
      assert.ok(text.includes('data: {"n":2}'), "should contain third event");
    } finally {
      await runtime.dispose();
    }
  });

  it("SSE streaming - in-isolate", { timeout: 10000 }, async () => {
    const runtime = await connection.createRuntime({
      fetch: async (url, init) => fetch(url, init),
      testEnvironment: true,
    });
    try {
      await runtime.eval(`
        describe("SSE", () => {
          it("should receive 3 events", async () => {
            const res = await fetch("http://localhost:${port}/sse");
            const text = await res.text();
            expect(text).toContain('data: {"n":0}');
            expect(text).toContain('data: {"n":1}');
            expect(text).toContain('data: {"n":2}');
          });
        });
      `);

      const results = await runtime.testEnvironment.runTests();
      assert.strictEqual(results.failed, 0, `Expected no failures but got ${results.failed}`);
    } finally {
      await runtime.dispose();
    }
  });

  it("POST response streaming - passthrough", { timeout: 10000 }, async () => {
    const runtime = await connection.createRuntime({
      fetch: async (url, init) => fetch(url, init),
    });
    try {
      await runtime.eval(`
        serve({
          async fetch(request) {
            const url = new URL(request.url);
            const target = url.searchParams.get("target");
            return fetch(target, { method: "POST", body: "echo-this-body" });
          }
        });
      `);

      const response = await runtime.fetch.dispatchRequest(
        new Request(`http://test/?target=http://localhost:${port}/post-stream`, {
          method: "POST",
          body: "echo-this-body",
        })
      );
      const text = await response.text();
      assert.strictEqual(text, "echo-this-body");
    } finally {
      await runtime.dispose();
    }
  });

  it("POST response streaming - in-isolate", { timeout: 10000 }, async () => {
    const runtime = await connection.createRuntime({
      fetch: async (url, init) => fetch(url, init),
      testEnvironment: true,
    });
    try {
      await runtime.eval(`
        describe("POST stream", () => {
          it("should echo body back", async () => {
            const res = await fetch("http://localhost:${port}/post-stream", {
              method: "POST",
              body: "echo-this-body",
            });
            const text = await res.text();
            expect(text).toBe("echo-this-body");
          });
        });
      `);

      const results = await runtime.testEnvironment.runTests();
      assert.strictEqual(results.failed, 0, `Expected no failures but got ${results.failed}`);
    } finally {
      await runtime.dispose();
    }
  });
});
