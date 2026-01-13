import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import {
  createFetchTestContext,
  evalCode,
  evalCodeAsync,
  runTestCode,
  type FetchTestContext,
} from "@ricsam/isolate-test-utils";

describe("Request", () => {
  let ctx: FetchTestContext;

  beforeEach(async () => {
    ctx = await createFetchTestContext();
  });

  afterEach(() => {
    ctx.dispose();
  });

  test("text() body method", async () => {
    const data = await evalCodeAsync<string>(
      ctx.context,
      `
      (async () => {
        const request = new Request("https://example.com", {
          method: "POST",
          body: "Hello World",
        });
        const text = await request.text();
        return JSON.stringify({ text });
      })()
    `
    );
    const result = JSON.parse(data);

    assert.strictEqual(result.text, "Hello World");
  });

  test("json() body method", async () => {
    const data = await evalCodeAsync<string>(
      ctx.context,
      `
      (async () => {
        const request = new Request("https://example.com", {
          method: "POST",
          body: JSON.stringify({ name: "test", value: 42 }),
        });
        return JSON.stringify(await request.json());
      })()
    `
    );
    const result = JSON.parse(data) as { name: string; value: number };

    assert.strictEqual(result.name, "test");
    assert.strictEqual(result.value, 42);
  });

  test("arrayBuffer() body method", async () => {
    const data = await evalCodeAsync<string>(
      ctx.context,
      `
      (async () => {
        const request = new Request("https://example.com", {
          method: "POST",
          body: "ABC",
        });
        const buffer = await request.arrayBuffer();
        return JSON.stringify({
          isArrayBuffer: buffer instanceof ArrayBuffer,
          byteLength: buffer.byteLength,
        });
      })()
    `
    );
    const result = JSON.parse(data) as {
      isArrayBuffer: boolean;
      byteLength: number;
    };

    assert.strictEqual(result.isArrayBuffer, true);
    assert.strictEqual(result.byteLength, 3);
  });

  test("bodyUsed flag after consumption", async () => {
    const data = await evalCodeAsync<string>(
      ctx.context,
      `
      (async () => {
        const request = new Request("https://example.com", {
          method: "POST",
          body: "test",
        });
        const before = request.bodyUsed;
        await request.text();
        const after = request.bodyUsed;
        return JSON.stringify({ before, after });
      })()
    `
    );
    const result = JSON.parse(data) as { before: boolean; after: boolean };

    assert.strictEqual(result.before, false);
    assert.strictEqual(result.after, true);
  });

  test("body property exists", () => {
    const data = evalCode<string>(
      ctx.context,
      `
      const request = new Request("https://example.com", {
        method: "POST",
        body: "Stream test",
      });
      JSON.stringify({
        hasBody: request.body !== null,
        hasBodyUsed: typeof request.bodyUsed === "boolean",
      })
    `
    );
    const result = JSON.parse(data) as { hasBody: boolean; hasBodyUsed: boolean };

    assert.strictEqual(result.hasBody, true);
    assert.strictEqual(result.hasBodyUsed, true);
  });

  test("body property returns HostBackedReadableStream", () => {
    const isStream = evalCode<boolean>(
      ctx.context,
      `
      const request = new Request("http://example.com", {
        method: "POST",
        body: "test body"
      });
      request.body instanceof HostBackedReadableStream
      `
    );
    assert.strictEqual(isStream, true);
  });

  test("can read body via stream reader", async () => {
    const result = await evalCodeAsync<string>(
      ctx.context,
      `
      (async () => {
        const request = new Request("http://example.com", {
          method: "POST",
          body: "hello"
        });
        const reader = request.body.getReader();
        const { value, done } = await reader.read();
        return JSON.stringify({
          hasValue: value != null,
          isDone: done
        });
      })()
      `
    );
    const data = JSON.parse(result) as { hasValue: boolean; isDone: boolean };
    assert.strictEqual(data.hasValue, true);
    assert.strictEqual(data.isDone, false);
  });

  test("Request URL is preserved when created with URL object and init options", () => {
    const result = evalCode<string>(
      ctx.context,
      `
      const originalUrl = "http://localhost:3333/auth/get-session";
      const request = new Request(originalUrl);
      // Create new request with URL object and explicit options (not passing request object)
      const newRequest = new Request(new URL(request.url), {
        method: request.method,
        headers: request.headers,
      });
      JSON.stringify({
        originalUrl: request.url,
        newUrl: newRequest.url,
      })
      `
    );
    const data = JSON.parse(result) as { originalUrl: string; newUrl: string };
    assert.strictEqual(data.originalUrl, "http://localhost:3333/auth/get-session");
    assert.strictEqual(data.newUrl, "http://localhost:3333/auth/get-session");
  });
});

/**
 * Native Request -> Isolate tests
 *
 * These tests verify that native Request objects passed into the isolate
 * behave identically to Request instances created with `new Request()` in the isolate.
 *
 * The tests use `runTestCode()` which converts native Request to isolate Request
 * instances before executing the test code.
 *
 * Note: These tests focus on synchronous properties. Body consumption methods
 * (text(), json(), arrayBuffer()) require async support in runTestCode which
 * is not yet implemented.
 */
describe("Native Request -> Isolate", () => {
  let ctx: FetchTestContext;

  beforeEach(async () => {
    ctx = await createFetchTestContext();
  });

  afterEach(() => {
    ctx.dispose();
  });

  test("native Request should pass instanceof check in isolate", () => {
    const runtime = runTestCode(
      ctx.context,
      `
      const request = testingInput.request;
      log("instanceof", request instanceof Request);
      log("constructorName", request.constructor.name);
    `
    ).input({
      request: new Request("https://example.com/test"),
    });

    assert.deepStrictEqual(runtime.logs, {
      instanceof: true,
      constructorName: "Request",
    });
  });

  test("url property is preserved", () => {
    const runtime = runTestCode(
      ctx.context,
      `
      const request = testingInput.request;
      log("url", request.url);
    `
    ).input({
      request: new Request("https://example.com/path?query=value"),
    });

    assert.strictEqual(runtime.logs.url, "https://example.com/path?query=value");
  });

  test("method property is preserved", () => {
    const runtime = runTestCode(
      ctx.context,
      `
      const request = testingInput.request;
      log("method", request.method);
    `
    ).input({
      request: new Request("https://example.com", { method: "POST" }),
    });

    assert.strictEqual(runtime.logs.method, "POST");
  });

  test("headers property is a Headers instance", () => {
    const runtime = runTestCode(
      ctx.context,
      `
      const request = testingInput.request;
      log("headersInstanceof", request.headers instanceof Headers);
      log("contentType", request.headers.get("content-type"));
      log("accept", request.headers.get("accept"));
    `
    ).input({
      request: new Request("https://example.com", {
        headers: {
          "Content-Type": "application/json",
          Accept: "text/html",
        },
      }),
    });

    assert.deepStrictEqual(runtime.logs, {
      headersInstanceof: true,
      contentType: "application/json",
      accept: "text/html",
    });
  });

  test("credentials property is preserved", () => {
    const runtime = runTestCode(
      ctx.context,
      `
      const request = testingInput.request;
      log("credentials", request.credentials);
    `
    ).input({
      request: new Request("https://example.com", { credentials: "include" }),
    });

    assert.strictEqual(runtime.logs.credentials, "include");
  });

  test("redirect property is preserved", () => {
    const runtime = runTestCode(
      ctx.context,
      `
      const request = testingInput.request;
      log("redirect", request.redirect);
    `
    ).input({
      request: new Request("https://example.com", { redirect: "manual" }),
    });

    assert.strictEqual(runtime.logs.redirect, "manual");
  });

  test("bodyUsed property exists and is false initially", () => {
    const runtime = runTestCode(
      ctx.context,
      `
      const request = testingInput.request;
      log("bodyUsed", request.bodyUsed);
      log("hasBodyUsed", typeof request.bodyUsed === "boolean");
    `
    ).input({
      request: new Request("https://example.com"),
    });

    assert.deepStrictEqual(runtime.logs, {
      bodyUsed: false,
      hasBodyUsed: true,
    });
  });

  test("all standard properties exist", () => {
    const runtime = runTestCode(
      ctx.context,
      `
      const request = testingInput.request;
      log("hasUrl", typeof request.url === "string");
      log("hasMethod", typeof request.method === "string");
      log("hasHeaders", request.headers instanceof Headers);
      log("hasMode", typeof request.mode === "string");
      log("hasCredentials", typeof request.credentials === "string");
      log("hasCache", typeof request.cache === "string");
      log("hasRedirect", typeof request.redirect === "string");
      log("hasReferrer", typeof request.referrer === "string");
      log("hasIntegrity", typeof request.integrity === "string");
    `
    ).input({
      request: new Request("https://example.com"),
    });

    assert.deepStrictEqual(runtime.logs, {
      hasUrl: true,
      hasMethod: true,
      hasHeaders: true,
      hasMode: true,
      hasCredentials: true,
      hasCache: true,
      hasRedirect: true,
      hasReferrer: true,
      hasIntegrity: true,
    });
  });

  describe("Bidirectional Conversion (Native->Isolate->Native)", () => {
    test("Request created in isolate should return as native Request", () => {
      const runtime = runTestCode(
        ctx.context,
        `
        const request = new Request("https://example.com/test", {
          method: "POST",
          headers: { "Content-Type": "application/json" }
        });
        log("request", request);
      `
      ).input({});

      assert.ok(runtime.logs.request instanceof Request);
      assert.strictEqual(
        (runtime.logs.request as Request).url,
        "https://example.com/test"
      );
      assert.strictEqual((runtime.logs.request as Request).method, "POST");
    });

    test("native Request passed through isolate returns as native Request", () => {
      const runtime = runTestCode(
        ctx.context,
        `
        const request = testingInput.request;
        log("request", request);
      `
      ).input({
        request: new Request("https://example.com/passthrough", {
          method: "PUT",
          headers: { "X-Custom": "value" },
        }),
      });

      assert.ok(runtime.logs.request instanceof Request);
      assert.strictEqual(
        (runtime.logs.request as Request).url,
        "https://example.com/passthrough"
      );
      assert.strictEqual((runtime.logs.request as Request).method, "PUT");
    });

    test("Request headers should be native Headers after round-trip", () => {
      const runtime = runTestCode(
        ctx.context,
        `
        const request = new Request("https://example.com", {
          headers: { "Content-Type": "application/json" }
        });
        log("request", request);
      `
      ).input({});

      assert.ok(runtime.logs.request instanceof Request);
      assert.ok((runtime.logs.request as Request).headers instanceof Headers);
      assert.strictEqual(
        (runtime.logs.request as Request).headers.get("content-type"),
        "application/json"
      );
    });

    test("nested object with Request converts properly", () => {
      const runtime = runTestCode(
        ctx.context,
        `
        const request = testingInput.request;
        log("result", {
          request: request,
          metadata: { id: 123 }
        });
      `
      ).input({
        request: new Request("https://example.com", { method: "DELETE" }),
      });

      const result = runtime.logs.result as {
        request: Request;
        metadata: { id: number };
      };
      assert.ok(result.request instanceof Request);
      assert.strictEqual(result.request.method, "DELETE");
      assert.deepStrictEqual(result.metadata, { id: 123 });
    });

    test("Request with modified headers converts properly through round-trip", () => {
      const runtime = runTestCode(
        ctx.context,
        `
        const headers = new Headers(testingInput.request.headers);
        headers.append("test2", "test2");
        headers.delete("to-remove");
        const request = new Request(new URL(testingInput.request.url), {
          method: testingInput.request.method,
          headers: headers,
        });
        log("result", {
          request: request,
          metadata: { id: 123 }
        });
      `
      ).input({
        request: new Request("https://example.com", {
          method: "DELETE",
          headers: { test: "test", "to-remove": "to-remove" },
        }),
      });

      const result = runtime.logs.result as {
        request: Request;
        metadata: { id: number };
      };
      assert.ok(result.request instanceof Request);
      assert.strictEqual(result.request.method, "DELETE");
      assert.deepStrictEqual(result.metadata, { id: 123 });
      assert.ok(result.request.headers instanceof Headers);
      assert.strictEqual(result.request.headers.get("test"), "test");
      assert.strictEqual(result.request.headers.get("test2"), "test2");
      assert.strictEqual(result.request.headers.has("to-remove"), false);
    });
  });
});
