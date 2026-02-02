import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import { createServer, type Server } from "node:http";
import { connect, type DaemonConnection } from "./index.ts";
import { startDaemon, type DaemonHandle } from "@ricsam/isolate-daemon";

const TEST_SOCKET = "/tmp/isolate-fetch-response-advanced-test.sock";

describe("Fetch response advanced (daemon/client)", () => {
  let daemon: DaemonHandle;
  let connection: DaemonConnection;
  let server: Server;
  let port: number;

  beforeEach(async () => {
    server = createServer((req, res) => {
      if (req.url === "/json-for-clone") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ msg: "clone-me" }));
        return;
      }

      if (req.url === "/form-urlencoded") {
        res.writeHead(200, {
          "Content-Type": "application/x-www-form-urlencoded",
        });
        res.end("name=alice&age=30");
        return;
      }

      if (req.url === "/chunked-reader") {
        res.writeHead(200, {
          "Content-Type": "text/plain",
          "Transfer-Encoding": "chunked",
        });
        let i = 0;
        const interval = setInterval(() => {
          res.write(`chunk-${i}\n`);
          i++;
          if (i >= 5) {
            clearInterval(interval);
            res.end();
          }
        }, 10);
        return;
      }

      if (req.url === "/slow") {
        setTimeout(() => {
          res.writeHead(200, { "Content-Type": "text/plain" });
          res.end("slow response");
        }, 3000);
        return;
      }

      if (req.url === "/error-midstream") {
        res.writeHead(200, {
          "Content-Type": "text/plain",
          "Transfer-Encoding": "chunked",
        });
        res.write("first-chunk");
        setTimeout(() => {
          res.destroy();
        }, 50);
        return;
      }

      if (req.url === "/infinite-stream") {
        res.writeHead(200, {
          "Content-Type": "text/plain",
          "Transfer-Encoding": "chunked",
        });
        let i = 0;
        const interval = setInterval(() => {
          res.write(`inf-${i}\n`);
          i++;
        }, 50);
        res.on("close", () => {
          clearInterval(interval);
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

  // --- Category 3: ReadableStream ---

  it("ReadableStream getReader - passthrough", { timeout: 10000 }, async () => {
    const runtime = await connection.createRuntime({
      fetch: async (request) => fetch(request),
    });
    try {
      await runtime.eval(`
        serve({
          async fetch(request) {
            const url = new URL(request.url);
            const target = url.searchParams.get("target");
            const res = await fetch(target);
            const reader = res.body.getReader();
            const chunks = [];
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              chunks.push(new TextDecoder().decode(value));
            }
            const text = chunks.join("");
            return new Response(text, {
              headers: { "Content-Type": "text/plain" },
            });
          }
        });
      `);

      const response = await runtime.fetch.dispatchRequest(
        new Request(
          `http://test/?target=http://localhost:${port}/chunked-reader`
        )
      );
      const text = await response.text();
      for (let i = 0; i < 5; i++) {
        assert.ok(
          text.includes(`chunk-${i}`),
          `should contain chunk-${i}`
        );
      }
    } finally {
      await runtime.dispose();
    }
  });

  it("ReadableStream getReader - in-isolate", { timeout: 10000 }, async () => {
    const runtime = await connection.createRuntime({
      fetch: async (request) => fetch(request),
      testEnvironment: true,
    });
    try {
      await runtime.eval(`
        describe("getReader", () => {
          it("should read all chunks", async () => {
            const res = await fetch("http://localhost:${port}/chunked-reader");
            const reader = res.body.getReader();
            const chunks = [];
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              chunks.push(new TextDecoder().decode(value));
            }
            const text = chunks.join("");
            for (let i = 0; i < 5; i++) {
              expect(text).toContain("chunk-" + i);
            }
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

  it("ReadableStream async iteration - passthrough", { timeout: 10000 }, async () => {
    const runtime = await connection.createRuntime({
      fetch: async (request) => fetch(request),
    });
    try {
      await runtime.eval(`
        serve({
          async fetch(request) {
            const url = new URL(request.url);
            const target = url.searchParams.get("target");
            const res = await fetch(target);
            const chunks = [];
            for await (const chunk of res.body) {
              chunks.push(new TextDecoder().decode(chunk));
            }
            const text = chunks.join("");
            return new Response(text, {
              headers: { "Content-Type": "text/plain" },
            });
          }
        });
      `);

      const response = await runtime.fetch.dispatchRequest(
        new Request(
          `http://test/?target=http://localhost:${port}/chunked-reader`
        )
      );
      const text = await response.text();
      for (let i = 0; i < 5; i++) {
        assert.ok(
          text.includes(`chunk-${i}`),
          `should contain chunk-${i}`
        );
      }
    } finally {
      await runtime.dispose();
    }
  });

  // --- Category 4: Response.clone() ---

  it("Response.clone() buffered - passthrough", { timeout: 5000 }, async () => {
    const runtime = await connection.createRuntime({
      fetch: async (request) => fetch(request),
    });
    try {
      await runtime.eval(`
        serve({
          async fetch(request) {
            const url = new URL(request.url);
            const target = url.searchParams.get("target");
            const res = await fetch(target);
            const clone = res.clone();
            const [a, b] = await Promise.all([res.json(), clone.json()]);
            return new Response(JSON.stringify({ a, b }), {
              headers: { "Content-Type": "application/json" },
            });
          }
        });
      `);

      const response = await runtime.fetch.dispatchRequest(
        new Request(
          `http://test/?target=http://localhost:${port}/json-for-clone`
        )
      );
      const json = await response.json();
      assert.deepStrictEqual(json.a, { msg: "clone-me" });
      assert.deepStrictEqual(json.b, { msg: "clone-me" });
    } finally {
      await runtime.dispose();
    }
  });

  it("Response.clone() buffered - in-isolate", { timeout: 5000 }, async () => {
    const runtime = await connection.createRuntime({
      fetch: async (request) => fetch(request),
      testEnvironment: true,
    });
    try {
      await runtime.eval(`
        describe("clone buffered", () => {
          it("should clone and consume both", async () => {
            const res = await fetch("http://localhost:${port}/json-for-clone");
            const clone = res.clone();
            const [a, b] = await Promise.all([res.json(), clone.json()]);
            expect(a).toEqual({ msg: "clone-me" });
            expect(b).toEqual({ msg: "clone-me" });
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

  it("Response.clone() streaming - passthrough", { timeout: 10000 }, async () => {
    const runtime = await connection.createRuntime({
      fetch: async (request) => fetch(request),
    });
    try {
      await runtime.eval(`
        serve({
          async fetch(request) {
            const url = new URL(request.url);
            const target = url.searchParams.get("target");
            const res = await fetch(target);
            const clone = res.clone();
            const [a, b] = await Promise.all([res.text(), clone.text()]);
            return new Response(JSON.stringify({ a, b }), {
              headers: { "Content-Type": "application/json" },
            });
          }
        });
      `);

      const response = await runtime.fetch.dispatchRequest(
        new Request(
          `http://test/?target=http://localhost:${port}/chunked-reader`
        )
      );
      const json = await response.json();
      for (let i = 0; i < 5; i++) {
        assert.ok(json.a.includes(`chunk-${i}`), `a should contain chunk-${i}`);
        assert.ok(json.b.includes(`chunk-${i}`), `b should contain chunk-${i}`);
      }
    } finally {
      await runtime.dispose();
    }
  });

  // --- Category 5: Response.formData() ---

  it("Response.formData() urlencoded - passthrough", { timeout: 5000 }, async () => {
    const runtime = await connection.createRuntime({
      fetch: async (request) => fetch(request),
    });
    try {
      await runtime.eval(`
        serve({
          async fetch(request) {
            const url = new URL(request.url);
            const target = url.searchParams.get("target");
            const res = await fetch(target);
            const form = await res.formData();
            return new Response(JSON.stringify({
              name: form.get("name"),
              age: form.get("age"),
            }), {
              headers: { "Content-Type": "application/json" },
            });
          }
        });
      `);

      const response = await runtime.fetch.dispatchRequest(
        new Request(
          `http://test/?target=http://localhost:${port}/form-urlencoded`
        )
      );
      const json = await response.json();
      assert.strictEqual(json.name, "alice");
      assert.strictEqual(json.age, "30");
    } finally {
      await runtime.dispose();
    }
  });

  it("Response.formData() urlencoded - in-isolate", { timeout: 5000 }, async () => {
    const runtime = await connection.createRuntime({
      fetch: async (request) => fetch(request),
      testEnvironment: true,
    });
    try {
      await runtime.eval(`
        describe("formData", () => {
          it("should parse urlencoded", async () => {
            const res = await fetch("http://localhost:${port}/form-urlencoded");
            const form = await res.formData();
            expect(form.get("name")).toBe("alice");
            expect(form.get("age")).toBe("30");
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

  // --- Category 6: Abort ---

  it("Abort slow request - passthrough", { timeout: 10000 }, async () => {
    const runtime = await connection.createRuntime({
      fetch: async (request) => fetch(request),
    });
    try {
      await runtime.eval(`
        serve({
          async fetch(request) {
            const url = new URL(request.url);
            const target = url.searchParams.get("target");
            const controller = new AbortController();
            setTimeout(() => controller.abort(), 100);
            try {
              await fetch(target, { signal: controller.signal });
              return new Response("should not reach here");
            } catch (err) {
              return new Response(JSON.stringify({
                name: err.name,
                isAbort: err.name === "AbortError",
              }), {
                headers: { "Content-Type": "application/json" },
              });
            }
          }
        });
      `);

      const response = await runtime.fetch.dispatchRequest(
        new Request(`http://test/?target=http://localhost:${port}/slow`)
      );
      const json = await response.json();
      assert.strictEqual(json.isAbort, true);
    } finally {
      await runtime.dispose();
    }
  });

  it("Abort slow request - in-isolate", { timeout: 10000 }, async () => {
    const runtime = await connection.createRuntime({
      fetch: async (request) => fetch(request),
      testEnvironment: true,
    });
    try {
      await runtime.eval(`
        describe("abort", () => {
          it("should throw AbortError", async () => {
            const controller = new AbortController();
            setTimeout(() => controller.abort(), 100);
            try {
              await fetch("http://localhost:${port}/slow", { signal: controller.signal });
              throw new Error("should not reach here");
            } catch (err) {
              expect(err.name).toBe("AbortError");
            }
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

  // --- Category 7: Error / cancellation ---

  it("Error midstream - passthrough", { timeout: 10000 }, async () => {
    const runtime = await connection.createRuntime({
      fetch: async (request) => fetch(request),
    });
    try {
      await runtime.eval(`
        serve({
          async fetch(request) {
            const url = new URL(request.url);
            const target = url.searchParams.get("target");
            const res = await fetch(target);
            const reader = res.body.getReader();
            const chunks = [];
            let error = null;
            try {
              while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                chunks.push(new TextDecoder().decode(value));
              }
            } catch (err) {
              error = err.message || "read error";
            }
            return new Response(JSON.stringify({
              chunksRead: chunks.length,
              error,
            }), {
              headers: { "Content-Type": "application/json" },
            });
          }
        });
      `);

      const response = await runtime.fetch.dispatchRequest(
        new Request(
          `http://test/?target=http://localhost:${port}/error-midstream`
        )
      );
      const json = await response.json();
      assert.ok(json.chunksRead >= 1, "should have read at least one chunk");
      assert.ok(json.error, "should have encountered an error");
    } finally {
      await runtime.dispose();
    }
  });

  it("Early cancellation - passthrough", { timeout: 10000 }, async () => {
    const runtime = await connection.createRuntime({
      fetch: async (request) => fetch(request),
    });
    try {
      await runtime.eval(`
        serve({
          async fetch(request) {
            const url = new URL(request.url);
            const target = url.searchParams.get("target");
            const res = await fetch(target);
            const reader = res.body.getReader();
            const chunks = [];
            for (let i = 0; i < 2; i++) {
              const { done, value } = await reader.read();
              if (done) break;
              chunks.push(new TextDecoder().decode(value));
            }
            await reader.cancel();
            return new Response(JSON.stringify({
              chunksRead: chunks.length,
            }), {
              headers: { "Content-Type": "application/json" },
            });
          }
        });
      `);

      const response = await runtime.fetch.dispatchRequest(
        new Request(
          `http://test/?target=http://localhost:${port}/infinite-stream`
        )
      );
      const json = await response.json();
      assert.strictEqual(json.chunksRead, 2);
    } finally {
      await runtime.dispose();
    }
  });

  it("Backpressure slow consumer - passthrough", { timeout: 10000 }, async () => {
    const runtime = await connection.createRuntime({
      fetch: async (request) => fetch(request),
    });
    try {
      await runtime.eval(`
        serve({
          async fetch(request) {
            const url = new URL(request.url);
            const target = url.searchParams.get("target");
            const res = await fetch(target);
            const reader = res.body.getReader();
            const chunks = [];
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              chunks.push(new TextDecoder().decode(value));
              await new Promise(r => setTimeout(r, 20));
            }
            const text = chunks.join("");
            return new Response(JSON.stringify({
              allChunks: true,
              text,
            }), {
              headers: { "Content-Type": "application/json" },
            });
          }
        });
      `);

      const response = await runtime.fetch.dispatchRequest(
        new Request(
          `http://test/?target=http://localhost:${port}/chunked-reader`
        )
      );
      const json = await response.json();
      for (let i = 0; i < 5; i++) {
        assert.ok(
          json.text.includes(`chunk-${i}`),
          `should contain chunk-${i}`
        );
      }
    } finally {
      await runtime.dispose();
    }
  });
});
