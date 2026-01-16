/**
 * Tests for Request.body behavior with GET/HEAD methods
 * Verifies fixes for Issue 3 (Request.body returns null) and Issue 4 (host strips body)
 */

import { test, describe } from "node:test";
import assert from "node:assert";
import ivm from "isolated-vm";
import { setupFetch } from "./index.ts";

describe("Request.body with GET/HEAD methods", () => {
  test("Request.body returns null for GET requests", async () => {
    const isolate = new ivm.Isolate();
    const context = await isolate.createContext();

    const handle = await setupFetch(context);

    try {
      const result = await context.eval(
        `
        (async () => {
          const req = new Request("http://example.com/test");
          return req.body === null;
        })()
        `,
        { promise: true }
      );

      assert.strictEqual(result, true, "Request.body should be null for GET requests");
    } finally {
      handle.dispose();
      isolate.dispose();
    }
  });

  test("Request.body returns null for HEAD requests", async () => {
    const isolate = new ivm.Isolate();
    const context = await isolate.createContext();

    const handle = await setupFetch(context);

    try {
      const result = await context.eval(
        `
        (async () => {
          const req = new Request("http://example.com/test", { method: "HEAD" });
          return req.body === null;
        })()
        `,
        { promise: true }
      );

      assert.strictEqual(result, true, "Request.body should be null for HEAD requests");
    } finally {
      handle.dispose();
      isolate.dispose();
    }
  });

  test("Request.body is not null for POST requests with body", async () => {
    const isolate = new ivm.Isolate();
    const context = await isolate.createContext();

    const handle = await setupFetch(context);

    try {
      const result = await context.eval(
        `
        (async () => {
          const req = new Request("http://example.com/test", {
            method: "POST",
            body: "hello"
          });
          return req.body !== null;
        })()
        `,
        { promise: true }
      );

      assert.strictEqual(result, true, "Request.body should not be null for POST with body");
    } finally {
      handle.dispose();
      isolate.dispose();
    }
  });

  test("Request constructor throws TypeError for GET with body", async () => {
    const isolate = new ivm.Isolate();
    const context = await isolate.createContext();

    const handle = await setupFetch(context);

    try {
      const resultJson = await context.eval(
        `
        (async () => {
          try {
            new Request("http://example.com/test", {
              method: "GET",
              body: "hello"
            });
            return JSON.stringify({ threw: false });
          } catch (e) {
            return JSON.stringify({
              threw: true,
              name: e.name,
              message: e.message
            });
          }
        })()
        `,
        { promise: true }
      );

      const result = JSON.parse(resultJson);
      assert.strictEqual(result.threw, true, "Should throw for GET with body");
      assert.strictEqual(result.name, "TypeError", "Should throw TypeError");
      assert.ok(
        result.message.includes("GET") || result.message.includes("body"),
        "Error message should mention GET or body"
      );
    } finally {
      handle.dispose();
      isolate.dispose();
    }
  });

  test("Request constructor throws TypeError for HEAD with body", async () => {
    const isolate = new ivm.Isolate();
    const context = await isolate.createContext();

    const handle = await setupFetch(context);

    try {
      const resultJson = await context.eval(
        `
        (async () => {
          try {
            new Request("http://example.com/test", {
              method: "HEAD",
              body: "hello"
            });
            return JSON.stringify({ threw: false });
          } catch (e) {
            return JSON.stringify({
              threw: true,
              name: e.name
            });
          }
        })()
        `,
        { promise: true }
      );

      const result = JSON.parse(resultJson);
      assert.strictEqual(result.threw, true, "Should throw for HEAD with body");
      assert.strictEqual(result.name, "TypeError", "Should throw TypeError");
    } finally {
      handle.dispose();
      isolate.dispose();
    }
  });

  test("dispatchRequest strips body for GET requests (host-side)", async () => {
    const isolate = new ivm.Isolate();
    const context = await isolate.createContext();

    let receivedMethod: string | null = null;
    let receivedBody: string | null = null;

    const handle = await setupFetch(context, {
      onFetch: async (req) => {
        receivedMethod = req.method;
        receivedBody = req.body ? await req.text() : null;
        return new Response("ok");
      },
    });

    try {
      // Create a POST request inside isolate and dispatch it
      await context.eval(
        `
        (async () => {
          const req = new Request("http://example.com/test", {
            method: "POST",
            body: "test body"
          });
          await fetch(req);
        })()
        `,
        { promise: true }
      );

      // Verify POST request had body
      assert.strictEqual(receivedMethod, "POST", "Should have received POST");
      assert.strictEqual(receivedBody, "test body", "POST request should have body");

      // Now test GET
      receivedMethod = null;
      receivedBody = null;

      await context.eval(
        `
        (async () => {
          await fetch("http://example.com/test");
        })()
        `,
        { promise: true }
      );

      assert.strictEqual(receivedMethod, "GET", "Should have received GET");
      assert.strictEqual(receivedBody, null, "GET request body should be null");
    } finally {
      handle.dispose();
      isolate.dispose();
    }
  });
});
