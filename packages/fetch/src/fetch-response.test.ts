import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import http from "node:http";
import ivm from "isolated-vm";
import { setupFetch, clearAllInstanceState } from "./index.ts";

describe("fetch chunked response", () => {
  let isolate: ivm.Isolate;
  let context: ivm.Context;
  let server: http.Server;
  let port: number;

  beforeEach(async () => {
    isolate = new ivm.Isolate();
    context = await isolate.createContext();
    clearAllInstanceState();

    server = http.createServer((req, res) => {
      if (req.url === "/json") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ users: [] }));
      } else if (req.url === "/text") {
        res.writeHead(200, { "Content-Type": "text/plain" });
        res.end("hello world");
      } else {
        res.writeHead(404);
        res.end();
      }
    });

    await new Promise<void>((resolve) => {
      server.listen(0, () => resolve());
    });
    const addr = server.address();
    port = typeof addr === "object" && addr ? addr.port : 0;
  });

  afterEach(async () => {
    context.release();
    isolate.dispose();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  test("fetch chunked response - text()", { timeout: 5000 }, async () => {
    await setupFetch(context);
    const result = await context.eval(
      `
      (async () => {
        const res = await fetch('http://localhost:${port}/json');
        return await res.text();
      })();
    `,
      { promise: true }
    );
    assert.strictEqual(result, JSON.stringify({ users: [] }));
  });

  test(
    "fetch chunked response - arrayBuffer()",
    { timeout: 5000 },
    async () => {
      await setupFetch(context);
      const result = await context.eval(
        `
      (async () => {
        const res = await fetch('http://localhost:${port}/json');
        const buf = await res.arrayBuffer();
        return new TextDecoder().decode(buf);
      })();
    `,
        { promise: true }
      );
      assert.strictEqual(result, JSON.stringify({ users: [] }));
    }
  );

  test("fetch chunked response - json()", { timeout: 5000 }, async () => {
    await setupFetch(context);
    const result = await context.eval(
      `
      (async () => {
        const res = await fetch('http://localhost:${port}/json');
        return JSON.stringify(await res.json());
      })();
    `,
      { promise: true }
    );
    assert.strictEqual(result, JSON.stringify({ users: [] }));
  });
});
