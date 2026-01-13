import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import ivm from "isolated-vm";
import { setupFetch, clearAllInstanceState } from "./index.ts";

/**
 * Integration tests for @ricsam/isolate-fetch
 *
 * Note: Comprehensive tests for Headers, Request, Response, and FormData
 * are in their respective test files (headers.test.ts, request.test.ts, etc.)
 * These tests focus on integration scenarios like fetch function and AbortController.
 */
describe("@ricsam/isolate-fetch Integration", () => {
  let isolate: ivm.Isolate;
  let context: ivm.Context;

  beforeEach(async () => {
    isolate = new ivm.Isolate();
    context = await isolate.createContext();
    clearAllInstanceState();
  });

  afterEach(() => {
    context.release();
    isolate.dispose();
  });

  describe("AbortController", () => {
    test("creates AbortController", async () => {
      await setupFetch(context);
      const result = context.evalSync(`
        const controller = new AbortController();
        typeof controller.signal;
      `);
      assert.strictEqual(result, "object");
    });

    test("signal starts not aborted", async () => {
      await setupFetch(context);
      const result = context.evalSync(`
        const controller = new AbortController();
        controller.signal.aborted;
      `);
      assert.strictEqual(result, false);
    });

    test("abort() sets signal.aborted to true", async () => {
      await setupFetch(context);
      const result = context.evalSync(`
        const controller = new AbortController();
        controller.abort();
        controller.signal.aborted;
      `);
      assert.strictEqual(result, true);
    });

    test("abort() with reason", async () => {
      await setupFetch(context);
      const result = context.evalSync(`
        const controller = new AbortController();
        controller.abort("custom reason");
        JSON.stringify({
          aborted: controller.signal.aborted,
          reason: controller.signal.reason
        });
      `);
      const data = JSON.parse(result as string);
      assert.strictEqual(data.aborted, true);
      assert.strictEqual(data.reason, "custom reason");
    });
  });

  describe("fetch function", () => {
    test("calls onFetch handler", async () => {
      let requestReceived: Request | null = null;

      await setupFetch(context, {
        onFetch: async (request) => {
          requestReceived = request;
          return new Response("OK");
        },
      });

      await context.eval(
        `
        (async () => {
          await fetch('https://example.com/api');
        })();
      `,
        { promise: true }
      );

      assert.notStrictEqual(requestReceived, null);
      assert.strictEqual(requestReceived!.url, "https://example.com/api");
    });

    test("returns Response from handler", async () => {
      await setupFetch(context, {
        onFetch: async () => {
          return new Response(JSON.stringify({ success: true }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        },
      });

      const result = await context.eval(
        `
        (async () => {
          const response = await fetch('https://example.com/api');
          const data = await response.json();
          return JSON.stringify({
            status: response.status,
            data: data
          });
        })();
      `,
        { promise: true }
      );

      const data = JSON.parse(result as string);
      assert.strictEqual(data.status, 200);
      assert.deepStrictEqual(data.data, { success: true });
    });

    test("passes request method and headers to handler", async () => {
      let receivedMethod = "";
      let receivedHeaders: Headers | null = null;

      await setupFetch(context, {
        onFetch: async (request) => {
          receivedMethod = request.method;
          receivedHeaders = request.headers;
          return new Response("OK");
        },
      });

      await context.eval(
        `
        (async () => {
          await fetch('https://example.com/api', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Custom': 'value' }
          });
        })();
      `,
        { promise: true }
      );

      assert.strictEqual(receivedMethod, "POST");
      assert.ok(receivedHeaders !== null);
      assert.strictEqual(receivedHeaders!.get("content-type"), "application/json");
      assert.strictEqual(receivedHeaders!.get("x-custom"), "value");
    });

    test("supports abort signal", async () => {
      await setupFetch(context, {
        onFetch: async () => {
          return new Response("OK");
        },
      });

      const result = await context.eval(
        `
        (async () => {
          const controller = new AbortController();
          controller.abort();
          try {
            await fetch('https://example.com', { signal: controller.signal });
            return 'no error';
          } catch (e) {
            return e.name;
          }
        })();
      `,
        { promise: true }
      );

      assert.strictEqual(result, "AbortError");
    });

    test("abort signal works with default handler", async () => {
      await setupFetch(context);

      const result = await context.eval(
        `
        (async () => {
          const controller = new AbortController();
          controller.abort();
          try {
            await fetch('https://example.com', { signal: controller.signal });
            return 'no error';
          } catch (e) {
            return e.name;
          }
        })();
      `,
        { promise: true }
      );

      assert.strictEqual(result, "AbortError");
    });

    test("fetch with Request object", async () => {
      let receivedUrl = "";
      let receivedMethod = "";

      await setupFetch(context, {
        onFetch: async (request) => {
          receivedUrl = request.url;
          receivedMethod = request.method;
          return new Response("OK");
        },
      });

      await context.eval(
        `
        (async () => {
          const request = new Request('https://example.com/api', { method: 'PUT' });
          await fetch(request);
        })();
      `,
        { promise: true }
      );

      assert.strictEqual(receivedUrl, "https://example.com/api");
      assert.strictEqual(receivedMethod, "PUT");
    });

    test("fetch response body can be read as text", async () => {
      await setupFetch(context, {
        onFetch: async () => {
          return new Response("Hello from handler");
        },
      });

      const result = await context.eval(
        `
        (async () => {
          const response = await fetch('https://example.com');
          return await response.text();
        })();
      `,
        { promise: true }
      );

      assert.strictEqual(result, "Hello from handler");
    });

    test("fetch response body can be read as JSON", async () => {
      await setupFetch(context, {
        onFetch: async () => {
          return new Response(JSON.stringify({ message: "hello", count: 42 }), {
            headers: { "Content-Type": "application/json" },
          });
        },
      });

      const result = await context.eval(
        `
        (async () => {
          const response = await fetch('https://example.com');
          const data = await response.json();
          return JSON.stringify(data);
        })();
      `,
        { promise: true }
      );

      const data = JSON.parse(result as string);
      assert.deepStrictEqual(data, { message: "hello", count: 42 });
    });
  });
});
