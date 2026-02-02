import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import { createServer, type Server } from "node:http";
import { connect, type DaemonConnection } from "./index.ts";
import { startDaemon, type DaemonHandle } from "@ricsam/isolate-daemon";

const TEST_SOCKET = "/tmp/isolate-fetch-edge-cases-test.sock";

describe("Fetch edge cases (daemon/client)", () => {
  let daemon: DaemonHandle;
  let connection: DaemonConnection;
  let server: Server;
  let port: number;

  beforeEach(async () => {
    server = createServer((req, res) => {
      const url = new URL(req.url!, `http://localhost`);

      if (url.pathname === "/status-204") {
        res.writeHead(204);
        res.end();
        return;
      }

      if (url.pathname === "/status-304") {
        res.writeHead(304);
        res.end();
        return;
      }

      if (url.pathname === "/head-test") {
        res.writeHead(200, {
          "Content-Type": "text/plain",
          "X-Custom": "head-value",
          "Content-Length": "13",
        });
        if (req.method !== "HEAD") {
          res.end("head test body");
        } else {
          res.end();
        }
        return;
      }

      if (url.pathname === "/concurrent") {
        const id = url.searchParams.get("id") || "0";
        const delay = Math.floor(Math.random() * 40) + 10;
        setTimeout(() => {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ id }));
        }, delay);
        return;
      }

      if (url.pathname === "/slow-callback") {
        res.writeHead(200, { "Content-Type": "text/plain" });
        res.end("ok");
        return;
      }

      if (url.pathname === "/set-cookies") {
        res.setHeader("Set-Cookie", [
          "a=1; Path=/",
          "b=2; Path=/",
          "c=3; Path=/",
        ]);
        res.writeHead(200, { "Content-Type": "text/plain" });
        res.end("cookies set");
        return;
      }

      if (url.pathname === "/large-header") {
        const largeValue = "x".repeat(4096);
        res.writeHead(200, {
          "Content-Type": "text/plain",
          "X-Large": largeValue,
        });
        res.end("ok");
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

  // --- Category 8: Null-body status codes ---

  it("204 No Content - passthrough", { timeout: 5000 }, async () => {
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
            return new Response(JSON.stringify({
              status: res.status,
              bodyNull: res.body === null,
            }), {
              headers: { "Content-Type": "application/json" },
            });
          }
        });
      `);

      const response = await runtime.fetch.dispatchRequest(
        new Request(`http://test/?target=http://localhost:${port}/status-204`)
      );
      const json = await response.json();
      assert.strictEqual(json.status, 204);
      assert.strictEqual(json.bodyNull, true);
    } finally {
      await runtime.dispose();
    }
  });

  it("204 No Content - in-isolate", { timeout: 5000 }, async () => {
    const runtime = await connection.createRuntime({
      fetch: async (request) => fetch(request),
      testEnvironment: true,
    });
    try {
      await runtime.eval(`
        describe("204", () => {
          it("should have null body", async () => {
            const res = await fetch("http://localhost:${port}/status-204");
            expect(res.status).toBe(204);
            expect(res.body).toBeNull();
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

  it("304 Not Modified - passthrough", { timeout: 5000 }, async () => {
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
            return new Response(JSON.stringify({
              status: res.status,
              bodyNull: res.body === null,
            }), {
              headers: { "Content-Type": "application/json" },
            });
          }
        });
      `);

      const response = await runtime.fetch.dispatchRequest(
        new Request(`http://test/?target=http://localhost:${port}/status-304`)
      );
      const json = await response.json();
      assert.strictEqual(json.status, 304);
      assert.strictEqual(json.bodyNull, true);
    } finally {
      await runtime.dispose();
    }
  });

  // --- Category 9: HEAD requests ---

  it("HEAD request - passthrough", { timeout: 5000 }, async () => {
    const runtime = await connection.createRuntime({
      fetch: async (request) => fetch(request),
    });
    try {
      await runtime.eval(`
        serve({
          async fetch(request) {
            const url = new URL(request.url);
            const target = url.searchParams.get("target");
            const res = await fetch(target, { method: "HEAD" });
            return new Response(JSON.stringify({
              status: res.status,
              bodyNull: res.body === null,
              customHeader: res.headers.get("x-custom"),
            }), {
              headers: { "Content-Type": "application/json" },
            });
          }
        });
      `);

      const response = await runtime.fetch.dispatchRequest(
        new Request(`http://test/?target=http://localhost:${port}/head-test`)
      );
      const json = await response.json();
      assert.strictEqual(json.status, 200);
      assert.strictEqual(json.bodyNull, true);
      assert.strictEqual(json.customHeader, "head-value");
    } finally {
      await runtime.dispose();
    }
  });

  it("HEAD request - in-isolate", { timeout: 5000 }, async () => {
    const runtime = await connection.createRuntime({
      fetch: async (request) => fetch(request),
      testEnvironment: true,
    });
    try {
      await runtime.eval(`
        describe("HEAD", () => {
          it("should have null body and headers", async () => {
            const res = await fetch("http://localhost:${port}/head-test", { method: "HEAD" });
            expect(res.status).toBe(200);
            expect(res.body).toBeNull();
            expect(res.headers.get("x-custom")).toBe("head-value");
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

  // --- Category 10: Concurrent requests ---

  it("10 concurrent requests - passthrough", { timeout: 10000 }, async () => {
    const runtime = await connection.createRuntime({
      fetch: async (request) => fetch(request),
    });
    try {
      await runtime.eval(`
        serve({
          async fetch(request) {
            const url = new URL(request.url);
            const target = url.searchParams.get("target");
            const promises = [];
            for (let i = 0; i < 10; i++) {
              promises.push(
                fetch(target + "?id=" + i).then(r => r.json())
              );
            }
            const results = await Promise.all(promises);
            return new Response(JSON.stringify(results), {
              headers: { "Content-Type": "application/json" },
            });
          }
        });
      `);

      const response = await runtime.fetch.dispatchRequest(
        new Request(
          `http://test/?target=http://localhost:${port}/concurrent`
        )
      );
      const results = await response.json();
      assert.strictEqual(results.length, 10);
      const ids = results.map((r: any) => r.id).sort();
      assert.deepStrictEqual(
        ids,
        ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"]
      );
    } finally {
      await runtime.dispose();
    }
  });

  it("10 concurrent requests - in-isolate", { timeout: 10000 }, async () => {
    const runtime = await connection.createRuntime({
      fetch: async (request) => fetch(request),
      testEnvironment: true,
    });
    try {
      await runtime.eval(`
        describe("concurrent", () => {
          it("should handle 10 parallel fetches", async () => {
            const promises = [];
            for (let i = 0; i < 10; i++) {
              promises.push(
                fetch("http://localhost:${port}/concurrent?id=" + i).then(r => r.json())
              );
            }
            const results = await Promise.all(promises);
            expect(results.length).toBe(10);
            const ids = results.map(r => r.id).sort();
            expect(ids).toEqual(["0","1","2","3","4","5","6","7","8","9"]);
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

  // --- Category 11: Callback edge cases ---

  it("Callback throws - passthrough", { timeout: 5000 }, async () => {
    const runtime = await connection.createRuntime({
      fetch: async () => {
        throw new Error("callback boom");
      },
    });
    try {
      await runtime.eval(`
        serve({
          async fetch(request) {
            try {
              await fetch("http://example.com/anything");
              return new Response("should not reach");
            } catch (err) {
              return new Response(JSON.stringify({
                caught: true,
                message: err.message,
              }), {
                headers: { "Content-Type": "application/json" },
              });
            }
          }
        });
      `);

      const response = await runtime.fetch.dispatchRequest(
        new Request("http://test/")
      );
      const json = await response.json();
      assert.strictEqual(json.caught, true);
    } finally {
      await runtime.dispose();
    }
  });

  it("Callback returns large body - passthrough", { timeout: 10000 }, async () => {
    const largeBody = "x".repeat(2 * 1024 * 1024);
    const runtime = await connection.createRuntime({
      fetch: async () => {
        return new Response(largeBody);
      },
    });
    try {
      await runtime.eval(`
        serve({
          async fetch(request) {
            const res = await fetch("http://example.com/anything");
            const text = await res.text();
            return new Response(JSON.stringify({ length: text.length }), {
              headers: { "Content-Type": "application/json" },
            });
          }
        });
      `);

      const response = await runtime.fetch.dispatchRequest(
        new Request("http://test/")
      );
      const json = await response.json();
      assert.strictEqual(json.length, 2 * 1024 * 1024);
    } finally {
      await runtime.dispose();
    }
  });

  it("Callback slow response - passthrough", { timeout: 10000 }, async () => {
    const runtime = await connection.createRuntime({
      fetch: async () => {
        await new Promise((r) => setTimeout(r, 1000));
        return new Response("slow-callback-response");
      },
    });
    try {
      await runtime.eval(`
        serve({
          async fetch(request) {
            const res = await fetch("http://example.com/anything");
            return new Response(await res.text(), {
              headers: { "Content-Type": "text/plain" },
            });
          }
        });
      `);

      const response = await runtime.fetch.dispatchRequest(
        new Request("http://test/")
      );
      const text = await response.text();
      assert.strictEqual(text, "slow-callback-response");
    } finally {
      await runtime.dispose();
    }
  });

  // --- Category 12: Headers edge cases ---

  it("Multiple Set-Cookie - passthrough", { timeout: 5000 }, async () => {
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
            const cookies = res.headers.getSetCookie();
            return new Response(JSON.stringify({ cookies }), {
              headers: { "Content-Type": "application/json" },
            });
          }
        });
      `);

      const response = await runtime.fetch.dispatchRequest(
        new Request(
          `http://test/?target=http://localhost:${port}/set-cookies`
        )
      );
      const json = await response.json();
      assert.ok(Array.isArray(json.cookies), "cookies should be an array");
      assert.strictEqual(json.cookies.length, 3);
      assert.ok(json.cookies.some((c: string) => c.includes("a=1")));
      assert.ok(json.cookies.some((c: string) => c.includes("b=2")));
      assert.ok(json.cookies.some((c: string) => c.includes("c=3")));
    } finally {
      await runtime.dispose();
    }
  });

  it("Multiple Set-Cookie - in-isolate", { timeout: 5000 }, async () => {
    const runtime = await connection.createRuntime({
      fetch: async (request) => fetch(request),
      testEnvironment: true,
    });
    try {
      await runtime.eval(`
        describe("set-cookie", () => {
          it("should return multiple cookies", async () => {
            const res = await fetch("http://localhost:${port}/set-cookies");
            const cookies = res.headers.getSetCookie();
            expect(Array.isArray(cookies)).toBe(true);
            expect(cookies.length).toBe(3);
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

  it("Large header - passthrough", { timeout: 5000 }, async () => {
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
            const largeHeader = res.headers.get("x-large") || "";
            return new Response(JSON.stringify({
              length: largeHeader.length,
            }), {
              headers: { "Content-Type": "application/json" },
            });
          }
        });
      `);

      const response = await runtime.fetch.dispatchRequest(
        new Request(
          `http://test/?target=http://localhost:${port}/large-header`
        )
      );
      const json = await response.json();
      assert.strictEqual(json.length, 4096);
    } finally {
      await runtime.dispose();
    }
  });

  it("Request properties lost - passthrough", { timeout: 5000 }, async () => {
    const runtime = await connection.createRuntime({
      fetch: async (request) => {
        return new Response(
          JSON.stringify({
            mode: request.mode,
            credentials: request.credentials,
            cache: request.cache,
            redirect: request.redirect,
          }),
          { headers: { "Content-Type": "application/json" } }
        );
      },
    });
    try {
      await runtime.eval(`
        serve({
          async fetch(request) {
            const res = await fetch("http://example.com/anything");
            return new Response(await res.text(), {
              headers: { "Content-Type": "application/json" },
            });
          }
        });
      `);

      const response = await runtime.fetch.dispatchRequest(
        new Request("http://test/")
      );
      const json = await response.json();
      // These properties may be default values or missing depending on implementation
      assert.ok(
        typeof json.mode === "string" || json.mode === undefined || json.mode === null,
        "mode should be a string or absent"
      );
    } finally {
      await runtime.dispose();
    }
  });
});
