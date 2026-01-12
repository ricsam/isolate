import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import ivm from "isolated-vm";
import { setupFetch, clearAllInstanceState } from "./index.ts";

describe("@ricsam/isolate-fetch", () => {
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

  describe("Headers", () => {
    test("creates Headers with no arguments", async () => {
      await setupFetch(context);
      const result = context.evalSync(`
        const h = new Headers();
        h.has('content-type');
      `);
      assert.strictEqual(result, false);
    });

    test("creates Headers from object", async () => {
      await setupFetch(context);
      const result = context.evalSync(`
        const h = new Headers({ 'Content-Type': 'application/json' });
        h.get('content-type');
      `);
      assert.strictEqual(result, "application/json");
    });

    test("get is case-insensitive", async () => {
      await setupFetch(context);
      const result = context.evalSync(`
        const h = new Headers({ 'Content-Type': 'text/html' });
        JSON.stringify([
          h.get('content-type'),
          h.get('CONTENT-TYPE'),
          h.get('Content-Type')
        ]);
      `);
      const values = JSON.parse(result as string);
      assert.deepStrictEqual(values, ["text/html", "text/html", "text/html"]);
    });

    test("forEach iterates all headers", async () => {
      await setupFetch(context);
      const result = context.evalSync(`
        const h = new Headers({ 'X-One': '1', 'X-Two': '2' });
        const items = [];
        h.forEach((value, key) => items.push([key, value]));
        JSON.stringify(items);
      `);
      const items = JSON.parse(result as string);
      assert.strictEqual(items.length, 2);
    });

    test("getSetCookie returns array", async () => {
      await setupFetch(context);
      const result = context.evalSync(`
        const h = new Headers();
        h.append('Set-Cookie', 'a=1');
        h.append('Set-Cookie', 'b=2');
        JSON.stringify(h.getSetCookie());
      `);
      const cookies = JSON.parse(result as string);
      assert.deepStrictEqual(cookies, ["a=1", "b=2"]);
    });
  });

  describe("Request", () => {
    test("creates Request with URL string", async () => {
      await setupFetch(context);
      const result = context.evalSync(`
        const r = new Request('https://example.com/path');
        r.url;
      `);
      assert.strictEqual(result, "https://example.com/path");
    });

    test("creates Request with URL and init", async () => {
      await setupFetch(context);
      const result = context.evalSync(`
        const r = new Request('https://example.com', { method: 'POST' });
        JSON.stringify({ url: r.url, method: r.method });
      `);
      const data = JSON.parse(result as string);
      assert.strictEqual(data.url, "https://example.com");
      assert.strictEqual(data.method, "POST");
    });

    test("has correct method", async () => {
      await setupFetch(context);
      const result = context.evalSync(`
        const r = new Request('https://example.com', { method: 'PUT' });
        r.method;
      `);
      assert.strictEqual(result, "PUT");
    });

    test("has correct headers", async () => {
      await setupFetch(context);
      const result = context.evalSync(`
        const r = new Request('https://example.com', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' }
        });
        r.headers.get('content-type');
      `);
      assert.strictEqual(result, "application/json");
    });

    test("can read body as text", async () => {
      await setupFetch(context);
      const result = await context.eval(
        `
        (async () => {
          const r = new Request('https://example.com', {
            method: 'POST',
            body: 'Hello, World!'
          });
          return await r.text();
        })();
      `,
        { promise: true }
      );
      assert.strictEqual(result, "Hello, World!");
    });

    test("can read body as JSON", async () => {
      await setupFetch(context);
      const result = await context.eval(
        `
        (async () => {
          const r = new Request('https://example.com', {
            method: 'POST',
            body: JSON.stringify({ name: 'test' })
          });
          const data = await r.json();
          return JSON.stringify(data);
        })();
      `,
        { promise: true }
      );
      const data = JSON.parse(result as string);
      assert.deepStrictEqual(data, { name: "test" });
    });

    test("can read body as formData", async () => {
      await setupFetch(context);
      const result = await context.eval(
        `
        (async () => {
          const r = new Request('https://example.com', {
            method: 'POST',
            body: 'key=value&foo=bar',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
          });
          const fd = await r.formData();
          return JSON.stringify({ key: fd.get('key'), foo: fd.get('foo') });
        })();
      `,
        { promise: true }
      );
      const data = JSON.parse(result as string);
      assert.deepStrictEqual(data, { key: "value", foo: "bar" });
    });
  });

  describe("Response", () => {
    test("creates Response with body", async () => {
      await setupFetch(context);
      const result = await context.eval(
        `
        (async () => {
          const r = new Response('Hello');
          return await r.text();
        })();
      `,
        { promise: true }
      );
      assert.strictEqual(result, "Hello");
    });

    test("has correct status", async () => {
      await setupFetch(context);
      const result = context.evalSync(`
        const r = new Response('OK', { status: 201 });
        r.status;
      `);
      assert.strictEqual(result, 201);
    });

    test("has correct statusText", async () => {
      await setupFetch(context);
      const result = context.evalSync(`
        const r = new Response('OK', { status: 201, statusText: 'Created' });
        r.statusText;
      `);
      assert.strictEqual(result, "Created");
    });

    test("has correct headers", async () => {
      await setupFetch(context);
      const result = context.evalSync(`
        const r = new Response('OK', {
          headers: { 'X-Custom': 'value' }
        });
        r.headers.get('x-custom');
      `);
      assert.strictEqual(result, "value");
    });

    test("can read body as text", async () => {
      await setupFetch(context);
      const result = await context.eval(
        `
        (async () => {
          const r = new Response('Body text');
          return await r.text();
        })();
      `,
        { promise: true }
      );
      assert.strictEqual(result, "Body text");
    });

    test("can read body as JSON", async () => {
      await setupFetch(context);
      const result = await context.eval(
        `
        (async () => {
          const r = new Response(JSON.stringify({ hello: 'world' }));
          const data = await r.json();
          return JSON.stringify(data);
        })();
      `,
        { promise: true }
      );
      const data = JSON.parse(result as string);
      assert.deepStrictEqual(data, { hello: "world" });
    });

    test("Response.json() static method", async () => {
      await setupFetch(context);
      const result = await context.eval(
        `
        (async () => {
          const r = Response.json({ data: 123 });
          const text = await r.text();
          return JSON.stringify({
            contentType: r.headers.get('content-type'),
            body: text
          });
        })();
      `,
        { promise: true }
      );
      const data = JSON.parse(result as string);
      assert.strictEqual(data.contentType, "application/json");
      assert.strictEqual(data.body, '{"data":123}');
    });

    test("Response.redirect() static method", async () => {
      await setupFetch(context);
      const result = context.evalSync(`
        const r = Response.redirect('https://example.com/new', 301);
        JSON.stringify({
          status: r.status,
          location: r.headers.get('location')
        });
      `);
      const data = JSON.parse(result as string);
      assert.strictEqual(data.status, 301);
      assert.strictEqual(data.location, "https://example.com/new");
    });
  });

  describe("FormData", () => {
    test("creates empty FormData", async () => {
      await setupFetch(context);
      const result = context.evalSync(`
        const fd = new FormData();
        fd.has('anything');
      `);
      assert.strictEqual(result, false);
    });

    test("append and get values", async () => {
      await setupFetch(context);
      const result = context.evalSync(`
        const fd = new FormData();
        fd.append('name', 'John');
        fd.append('name', 'Jane');
        JSON.stringify({
          first: fd.get('name'),
          all: fd.getAll('name')
        });
      `);
      const data = JSON.parse(result as string);
      assert.strictEqual(data.first, "John");
      assert.deepStrictEqual(data.all, ["John", "Jane"]);
    });

    test("handles File objects", async () => {
      await setupFetch(context);
      const result = context.evalSync(`
        const fd = new FormData();
        const file = new File(['content'], 'test.txt', { type: 'text/plain' });
        fd.append('file', file);
        const retrieved = fd.get('file');
        JSON.stringify({
          isFile: retrieved instanceof File,
          name: retrieved.name,
          type: retrieved.type
        });
      `);
      const data = JSON.parse(result as string);
      assert.strictEqual(data.isFile, true);
      assert.strictEqual(data.name, "test.txt");
      assert.strictEqual(data.type, "text/plain");
    });
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
  });
});
