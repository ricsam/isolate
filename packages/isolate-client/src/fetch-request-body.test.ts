import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import { createServer, type Server } from "node:http";
import { connect, type DaemonConnection } from "./index.ts";
import { startDaemon, type DaemonHandle } from "@ricsam/isolate-daemon";

const TEST_SOCKET = "/tmp/isolate-fetch-request-body-test.sock";

describe("Fetch request body (daemon/client)", () => {
  let daemon: DaemonHandle;
  let connection: DaemonConnection;
  let server: Server;
  let port: number;

  beforeEach(async () => {
    server = createServer((req, res) => {
      if (req.url === "/echo-body" && req.method === "POST") {
        const chunks: Buffer[] = [];
        req.on("data", (chunk: Buffer) => {
          chunks.push(chunk);
        });
        req.on("end", () => {
          const body = Buffer.concat(chunks);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              contentType: req.headers["content-type"] || null,
              body: body.toString("base64"),
              length: body.length,
            })
          );
        });
        return;
      }

      if (req.url === "/echo-body-length" && req.method === "POST") {
        let length = 0;
        req.on("data", (chunk: Buffer) => {
          length += chunk.length;
        });
        req.on("end", () => {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ length }));
        });
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

  // --- Category 1: Various body types ---

  it("FormData body", { timeout: 5000 }, async () => {
    const runtime = await connection.createRuntime({
      fetch: async (url, init) => fetch(url, init),
    });
    try {
      await runtime.eval(`
        serve({
          async fetch(request) {
            const url = new URL(request.url);
            const target = url.searchParams.get("target");
            const form = new FormData();
            form.append("name", "alice");
            form.append("age", "30");
            const res = await fetch(target, { method: "POST", body: form });
            return new Response(await res.text(), {
              headers: { "Content-Type": "application/json" },
            });
          }
        });
      `);

      const response = await runtime.fetch.dispatchRequest(
        new Request(`http://test/?target=http://localhost:${port}/echo-body`)
      );
      const json = await response.json();
      const bodyText = Buffer.from(json.body, "base64").toString("utf-8");
      assert.ok(
        json.contentType?.includes("multipart/form-data"),
        "Content-Type should be multipart/form-data"
      );
      assert.ok(bodyText.includes("alice"), "body should contain alice");
      assert.ok(bodyText.includes("30"), "body should contain 30");
    } finally {
      await runtime.dispose();
    }
  });

  it("ArrayBuffer body", { timeout: 5000 }, async () => {
    const runtime = await connection.createRuntime({
      fetch: async (url, init) => fetch(url, init),
    });
    try {
      await runtime.eval(`
        serve({
          async fetch(request) {
            const url = new URL(request.url);
            const target = url.searchParams.get("target");
            const buf = new ArrayBuffer(4);
            new Uint8Array(buf).set([0xDE, 0xAD, 0xBE, 0xEF]);
            const res = await fetch(target, { method: "POST", body: buf });
            return new Response(await res.text(), {
              headers: { "Content-Type": "application/json" },
            });
          }
        });
      `);

      const response = await runtime.fetch.dispatchRequest(
        new Request(`http://test/?target=http://localhost:${port}/echo-body`)
      );
      const json = await response.json();
      const bodyBuf = Buffer.from(json.body, "base64");
      assert.deepStrictEqual(
        Array.from(bodyBuf),
        [0xde, 0xad, 0xbe, 0xef]
      );
    } finally {
      await runtime.dispose();
    }
  });

  it("Uint8Array body", { timeout: 5000 }, async () => {
    const runtime = await connection.createRuntime({
      fetch: async (url, init) => fetch(url, init),
    });
    try {
      await runtime.eval(`
        serve({
          async fetch(request) {
            const url = new URL(request.url);
            const target = url.searchParams.get("target");
            const arr = new Uint8Array([1, 2, 3, 4, 5]);
            const res = await fetch(target, { method: "POST", body: arr });
            return new Response(await res.text(), {
              headers: { "Content-Type": "application/json" },
            });
          }
        });
      `);

      const response = await runtime.fetch.dispatchRequest(
        new Request(`http://test/?target=http://localhost:${port}/echo-body`)
      );
      const json = await response.json();
      const bodyBuf = Buffer.from(json.body, "base64");
      assert.deepStrictEqual(Array.from(bodyBuf), [1, 2, 3, 4, 5]);
    } finally {
      await runtime.dispose();
    }
  });

  it("URLSearchParams body", { timeout: 5000 }, async () => {
    const runtime = await connection.createRuntime({
      fetch: async (url, init) => fetch(url, init),
    });
    try {
      await runtime.eval(`
        serve({
          async fetch(request) {
            const url = new URL(request.url);
            const target = url.searchParams.get("target");
            const params = new URLSearchParams({ foo: "bar", baz: "qux" });
            const res = await fetch(target, { method: "POST", body: params });
            return new Response(await res.text(), {
              headers: { "Content-Type": "application/json" },
            });
          }
        });
      `);

      const response = await runtime.fetch.dispatchRequest(
        new Request(`http://test/?target=http://localhost:${port}/echo-body`)
      );
      const json = await response.json();
      const bodyText = Buffer.from(json.body, "base64").toString("utf-8");
      assert.ok(
        json.contentType?.includes("application/x-www-form-urlencoded"),
        "Content-Type should be urlencoded"
      );
      assert.ok(
        bodyText.includes("foo=bar"),
        "body should contain foo=bar"
      );
      assert.ok(
        bodyText.includes("baz=qux"),
        "body should contain baz=qux"
      );
    } finally {
      await runtime.dispose();
    }
  });

  it("Blob body", { timeout: 5000 }, async () => {
    const runtime = await connection.createRuntime({
      fetch: async (url, init) => fetch(url, init),
    });
    try {
      await runtime.eval(`
        serve({
          async fetch(request) {
            const url = new URL(request.url);
            const target = url.searchParams.get("target");
            const blob = new Blob(["hello blob"], { type: "text/plain" });
            const res = await fetch(target, { method: "POST", body: blob });
            return new Response(await res.text(), {
              headers: { "Content-Type": "application/json" },
            });
          }
        });
      `);

      const response = await runtime.fetch.dispatchRequest(
        new Request(`http://test/?target=http://localhost:${port}/echo-body`)
      );
      const json = await response.json();
      const bodyText = Buffer.from(json.body, "base64").toString("utf-8");
      assert.strictEqual(bodyText, "hello blob");
    } finally {
      await runtime.dispose();
    }
  });

  it("ReadableStream body", { timeout: 5000 }, async () => {
    const runtime = await connection.createRuntime({
      fetch: async (url, init) => fetch(url, init),
    });
    try {
      await runtime.eval(`
        serve({
          async fetch(request) {
            const url = new URL(request.url);
            const target = url.searchParams.get("target");
            const stream = new ReadableStream({
              start(controller) {
                controller.enqueue(new TextEncoder().encode("stream-"));
                controller.enqueue(new TextEncoder().encode("body"));
                controller.close();
              }
            });
            const res = await fetch(target, {
              method: "POST",
              body: stream,
              duplex: "half",
            });
            return new Response(await res.text(), {
              headers: { "Content-Type": "application/json" },
            });
          }
        });
      `);

      const response = await runtime.fetch.dispatchRequest(
        new Request(`http://test/?target=http://localhost:${port}/echo-body`)
      );
      const json = await response.json();
      const bodyText = Buffer.from(json.body, "base64").toString("utf-8");
      assert.strictEqual(bodyText, "stream-body");
    } finally {
      await runtime.dispose();
    }
  });

  // --- Category 2: Large bodies ---

  it("Large body 2MB - passthrough", { timeout: 10000 }, async () => {
    const runtime = await connection.createRuntime({
      fetch: async (url, init) => fetch(url, init),
    });
    try {
      await runtime.eval(`
        serve({
          async fetch(request) {
            const url = new URL(request.url);
            const target = url.searchParams.get("target");
            const body = "x".repeat(2 * 1024 * 1024);
            const res = await fetch(target, { method: "POST", body });
            return new Response(await res.text(), {
              headers: { "Content-Type": "application/json" },
            });
          }
        });
      `);

      const response = await runtime.fetch.dispatchRequest(
        new Request(
          `http://test/?target=http://localhost:${port}/echo-body-length`
        )
      );
      const json = await response.json();
      assert.strictEqual(json.length, 2 * 1024 * 1024);
    } finally {
      await runtime.dispose();
    }
  });

  it("Large body 2MB - in-isolate", { timeout: 10000 }, async () => {
    const runtime = await connection.createRuntime({
      fetch: async (url, init) => fetch(url, init),
      testEnvironment: true,
    });
    try {
      await runtime.eval(`
        describe("large body", () => {
          it("should send 2MB", async () => {
            const body = "x".repeat(2 * 1024 * 1024);
            const res = await fetch("http://localhost:${port}/echo-body-length", {
              method: "POST",
              body,
            });
            const json = await res.json();
            expect(json.length).toBe(2 * 1024 * 1024);
          });
        });
      `);

      const results = await runtime.testEnvironment.runTests();
      assert.strictEqual(
        results.failed,
        0,
        `Expected no failures but got ${results.failed}`
      );
    } finally {
      await runtime.dispose();
    }
  });
});
