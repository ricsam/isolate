import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import {
  createConsistencyTestContext,
  getResponseFromOrigin,
  getDispatchResponse,
  type ConsistencyTestContext,
  type ResponseOrigin,
  RESPONSE_ORIGINS,
} from "./origins.ts";

describe("Response Consistency", () => {
  let ctx: ConsistencyTestContext;

  beforeEach(async () => {
    ctx = await createConsistencyTestContext();
  });

  afterEach(async () => {
    await ctx.dispose();
  });

  // ============================================================================
  // Property Existence
  // ============================================================================

  describe("Property Existence", () => {
    for (const origin of RESPONSE_ORIGINS) {
      test(`status property exists when from ${origin}`, async () => {
        await getResponseFromOrigin(ctx, origin, "test body", { status: 201 });
        await ctx.eval(`
          setResult(typeof __testResponse.status === 'number');
        `);
        assert.strictEqual(ctx.getResult(), true);
      });

      test(`statusText property exists when from ${origin}`, async () => {
        await getResponseFromOrigin(ctx, origin, "test body", { statusText: "Created" });
        await ctx.eval(`
          setResult(typeof __testResponse.statusText === 'string');
        `);
        assert.strictEqual(ctx.getResult(), true);
      });

      test(`ok property exists when from ${origin}`, async () => {
        await getResponseFromOrigin(ctx, origin, "test body");
        await ctx.eval(`
          setResult(typeof __testResponse.ok === 'boolean');
        `);
        assert.strictEqual(ctx.getResult(), true);
      });

      test(`headers property exists when from ${origin}`, async () => {
        await getResponseFromOrigin(ctx, origin, "test body");
        await ctx.eval(`
          setResult(__testResponse.headers instanceof Headers);
        `);
        assert.strictEqual(ctx.getResult(), true);
      });

      test(`body property exists when from ${origin}`, async () => {
        await getResponseFromOrigin(ctx, origin, "test body");
        await ctx.eval(`
          setResult(__testResponse.body !== undefined);
        `);
        assert.strictEqual(ctx.getResult(), true);
      });

      test(`bodyUsed property exists when from ${origin}`, async () => {
        await getResponseFromOrigin(ctx, origin, "test body");
        await ctx.eval(`
          setResult(typeof __testResponse.bodyUsed === 'boolean');
        `);
        assert.strictEqual(ctx.getResult(), true);
      });

      test(`type property exists when from ${origin}`, async () => {
        await getResponseFromOrigin(ctx, origin, "test body");
        await ctx.eval(`
          setResult(typeof __testResponse.type === 'string');
        `);
        assert.strictEqual(ctx.getResult(), true);
      });

      test(`url property exists when from ${origin}`, async () => {
        await getResponseFromOrigin(ctx, origin, "test body");
        await ctx.eval(`
          setResult(typeof __testResponse.url === 'string');
        `);
        assert.strictEqual(ctx.getResult(), true);
      });

      test(`redirected property exists when from ${origin}`, async () => {
        await getResponseFromOrigin(ctx, origin, "test body");
        await ctx.eval(`
          setResult(typeof __testResponse.redirected === 'boolean');
        `);
        assert.strictEqual(ctx.getResult(), true);
      });
    }
  });

  // ============================================================================
  // Property Values
  // ============================================================================

  describe("Property Values", () => {
    for (const origin of RESPONSE_ORIGINS) {
      test(`status returns correct value when from ${origin}`, async () => {
        await getResponseFromOrigin(ctx, origin, "test body", { status: 201 });
        await ctx.eval(`
          setResult(__testResponse.status);
        `);
        assert.strictEqual(ctx.getResult(), 201);
      });

      test(`statusText returns correct value when from ${origin}`, async () => {
        await getResponseFromOrigin(ctx, origin, "test body", { statusText: "Created" });
        await ctx.eval(`
          setResult(__testResponse.statusText);
        `);
        assert.strictEqual(ctx.getResult(), "Created");
      });

      test(`ok is true for 2xx status when from ${origin}`, async () => {
        await getResponseFromOrigin(ctx, origin, "test body", { status: 200 });
        await ctx.eval(`
          setResult(__testResponse.ok);
        `);
        assert.strictEqual(ctx.getResult(), true);
      });

      test(`ok is false for non-2xx status when from ${origin}`, async () => {
        await getResponseFromOrigin(ctx, origin, "test body", { status: 404 });
        await ctx.eval(`
          setResult(__testResponse.ok);
        `);
        assert.strictEqual(ctx.getResult(), false);
      });

      test(`headers.get() works when from ${origin}`, async () => {
        await getResponseFromOrigin(ctx, origin, "test body", {
          headers: { "X-Custom": "test-value" },
        });
        await ctx.eval(`
          setResult(__testResponse.headers.get("X-Custom"));
        `);
        assert.strictEqual(ctx.getResult(), "test-value");
      });

      test(`bodyUsed is initially false when from ${origin}`, async () => {
        await getResponseFromOrigin(ctx, origin, "test body");
        await ctx.eval(`
          setResult(__testResponse.bodyUsed);
        `);
        assert.strictEqual(ctx.getResult(), false);
      });
    }
  });

  // ============================================================================
  // Body Methods
  // ============================================================================

  describe("Body Methods", () => {
    for (const origin of RESPONSE_ORIGINS) {
      test(`text() returns body content when from ${origin}`, async () => {
        await getResponseFromOrigin(ctx, origin, "hello world");
        await ctx.eval(`
          const text = await __testResponse.text();
          setResult(text);
        `);
        assert.strictEqual(ctx.getResult(), "hello world");
      });

      test(`json() parses JSON body when from ${origin}`, async () => {
        await getResponseFromOrigin(ctx, origin, '{"foo": "bar"}', {
          headers: { "Content-Type": "application/json" },
        });
        await ctx.eval(`
          const data = await __testResponse.json();
          setResult(JSON.stringify(data));
        `);
        assert.deepStrictEqual(JSON.parse(ctx.getResult() as string), { foo: "bar" });
      });

      test(`arrayBuffer() returns buffer when from ${origin}`, async () => {
        await getResponseFromOrigin(ctx, origin, "ABCDE");
        await ctx.eval(`
          const buffer = await __testResponse.arrayBuffer();
          setResult({
            isArrayBuffer: buffer instanceof ArrayBuffer,
            byteLength: buffer.byteLength,
          });
        `);
        const result = ctx.getResult() as { isArrayBuffer: boolean; byteLength: number };
        assert.strictEqual(result.isArrayBuffer, true);
        assert.strictEqual(result.byteLength, 5);
      });

      test(`blob() returns Blob when from ${origin}`, async () => {
        await getResponseFromOrigin(ctx, origin, "blob content", {
          headers: { "Content-Type": "text/plain" },
        });
        await ctx.eval(`
          const blob = await __testResponse.blob();
          setResult({
            isBlob: blob instanceof Blob,
            size: blob.size,
            type: blob.type,
          });
        `);
        const result = ctx.getResult() as { isBlob: boolean; size: number; type: string };
        assert.strictEqual(result.isBlob, true);
        assert.strictEqual(result.size, 12);
        assert.strictEqual(result.type, "text/plain");
      });

      test(`formData() parses urlencoded body when from ${origin}`, async () => {
        await getResponseFromOrigin(ctx, origin, "name=John&age=30", {
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
        });
        await ctx.eval(`
          const formData = await __testResponse.formData();
          setResult({
            isFormData: formData instanceof FormData,
            name: formData.get("name"),
            age: formData.get("age"),
          });
        `);
        const result = ctx.getResult() as { isFormData: boolean; name: string; age: string };
        assert.strictEqual(result.isFormData, true);
        assert.strictEqual(result.name, "John");
        assert.strictEqual(result.age, "30");
      });

      test(`bodyUsed is true after consuming body when from ${origin}`, async () => {
        await getResponseFromOrigin(ctx, origin, "test body");
        await ctx.eval(`
          await __testResponse.text();
          setResult(__testResponse.bodyUsed);
        `);
        assert.strictEqual(ctx.getResult(), true);
      });

      test(`consuming body twice throws error when from ${origin}`, async () => {
        await getResponseFromOrigin(ctx, origin, "test body");
        await ctx.eval(`
          await __testResponse.text();
          try {
            await __testResponse.text();
            setResult({ threw: false });
          } catch (e) {
            setResult({ threw: true, name: e.name });
          }
        `);
        const result = ctx.getResult() as { threw: boolean; name?: string };
        assert.strictEqual(result.threw, true);
        assert.strictEqual(result.name, "TypeError");
      });
    }
  });

  // ============================================================================
  // Clone Method
  // ============================================================================

  describe("Clone Method", () => {
    for (const origin of RESPONSE_ORIGINS) {
      test(`clone() creates independent copy when from ${origin}`, async () => {
        await getResponseFromOrigin(ctx, origin, "clone me", { status: 201 });
        await ctx.eval(`
          const cloned = __testResponse.clone();
          setResult({
            clonedStatus: cloned.status,
            sameStatus: __testResponse.status === cloned.status,
            originalNotUsed: !__testResponse.bodyUsed,
            clonedNotUsed: !cloned.bodyUsed,
            isResponse: cloned instanceof Response,
          });
        `);
        const result = ctx.getResult() as {
          clonedStatus: number;
          sameStatus: boolean;
          originalNotUsed: boolean;
          clonedNotUsed: boolean;
          isResponse: boolean;
        };
        assert.strictEqual(result.clonedStatus, 201);
        assert.strictEqual(result.sameStatus, true);
        assert.strictEqual(result.originalNotUsed, true);
        assert.strictEqual(result.clonedNotUsed, true);
        assert.strictEqual(result.isResponse, true);
      });

      test(`clone() body can be consumed independently when from ${origin}`, async () => {
        await getResponseFromOrigin(ctx, origin, "test content");
        await ctx.eval(`
          const cloned = __testResponse.clone();
          const originalText = await __testResponse.text();
          const clonedText = await cloned.text();
          setResult({
            originalText,
            clonedText,
            textsEqual: originalText === clonedText,
          });
        `);
        const result = ctx.getResult() as {
          originalText: string;
          clonedText: string;
          textsEqual: boolean;
        };
        assert.strictEqual(result.originalText, "test content");
        assert.strictEqual(result.clonedText, "test content");
        assert.strictEqual(result.textsEqual, true);
      });

      test(`clone() throws if body already used when from ${origin}`, async () => {
        await getResponseFromOrigin(ctx, origin, "test body");
        await ctx.eval(`
          await __testResponse.text();
          try {
            __testResponse.clone();
            setResult({ threw: false });
          } catch (e) {
            setResult({ threw: true, name: e.name });
          }
        `);
        const result = ctx.getResult() as { threw: boolean; name?: string };
        assert.strictEqual(result.threw, true);
        assert.strictEqual(result.name, "TypeError");
      });
    }
  });

  // ============================================================================
  // instanceof Check
  // ============================================================================

  describe("instanceof Check", () => {
    for (const origin of RESPONSE_ORIGINS) {
      test(`response instanceof Response when from ${origin}`, async () => {
        await getResponseFromOrigin(ctx, origin, "test body");
        await ctx.eval(`
          setResult(__testResponse instanceof Response);
        `);
        assert.strictEqual(ctx.getResult(), true);
      });

      test(`response.constructor.name is Response when from ${origin}`, async () => {
        await getResponseFromOrigin(ctx, origin, "test body");
        await ctx.eval(`
          setResult(__testResponse.constructor.name);
        `);
        assert.strictEqual(ctx.getResult(), "Response");
      });
    }
  });

  // ============================================================================
  // Body Stream
  // ============================================================================

  describe("Body Stream", () => {
    for (const origin of RESPONSE_ORIGINS) {
      test(`body.getReader() exists when from ${origin}`, async () => {
        await getResponseFromOrigin(ctx, origin, "test body");
        await ctx.eval(`
          const body = __testResponse.body;
          setResult(typeof body.getReader === 'function');
        `);
        assert.strictEqual(ctx.getResult(), true);
      });

      test(`body.getReader().read() works when from ${origin}`, async () => {
        await getResponseFromOrigin(ctx, origin, "hello");
        await ctx.eval(`
          const reader = __testResponse.body.getReader();
          const { value, done } = await reader.read();
          setResult({
            hasValue: value != null,
            done,
            firstByte: value ? value[0] : null,
          });
        `);
        const result = ctx.getResult() as { hasValue: boolean; done: boolean; firstByte: number | null };
        assert.strictEqual(result.hasValue, true);
        assert.strictEqual(result.done, false);
        // 'h' = 104
        assert.strictEqual(result.firstByte, 104);
      });
    }

    // WHATWG Issue: Response.body from fetch is not a proper ReadableStream
    // See WHATWG_INCONSISTENCIES.md#4-responsebody-from-fetch-is-not-a-proper-readablestream
    describe("ReadableStream Compliance (fetchCallback)", () => {
      test.todo("body instanceof ReadableStream when from fetchCallback", async () => {
        await getResponseFromOrigin(ctx, "fetchCallback", "test");
        await ctx.eval(`
          setResult(__testResponse.body instanceof ReadableStream);
        `);
        assert.strictEqual(ctx.getResult(), true, "body should be instanceof ReadableStream");
      });

      test.todo("body.constructor.name is ReadableStream when from fetchCallback", async () => {
        await getResponseFromOrigin(ctx, "fetchCallback", "test");
        await ctx.eval(`
          setResult(__testResponse.body.constructor.name);
        `);
        assert.strictEqual(ctx.getResult(), "ReadableStream", "body constructor should be ReadableStream");
      });

      test.todo("body.tee() exists when from fetchCallback", async () => {
        await getResponseFromOrigin(ctx, "fetchCallback", "test");
        await ctx.eval(`
          setResult(typeof __testResponse.body.tee === 'function');
        `);
        assert.strictEqual(ctx.getResult(), true, "tee() should be a function");
      });

      test.todo("body.tee() works when from fetchCallback", async () => {
        await getResponseFromOrigin(ctx, "fetchCallback", "hello");
        await ctx.eval(`
          const [stream1, stream2] = __testResponse.body.tee();
          const reader1 = stream1.getReader();
          const reader2 = stream2.getReader();
          const result1 = await reader1.read();
          const result2 = await reader2.read();
          setResult({
            stream1HasValue: result1.value != null,
            stream2HasValue: result2.value != null,
          });
        `);
        const result = ctx.getResult() as { stream1HasValue: boolean; stream2HasValue: boolean };
        assert.strictEqual(result.stream1HasValue, true);
        assert.strictEqual(result.stream2HasValue, true);
      });

      test.todo("body.pipeThrough() exists when from fetchCallback", async () => {
        await getResponseFromOrigin(ctx, "fetchCallback", "test");
        await ctx.eval(`
          setResult(typeof __testResponse.body.pipeThrough === 'function');
        `);
        assert.strictEqual(ctx.getResult(), true, "pipeThrough() should be a function");
      });

      test.todo("body.pipeTo() exists when from fetchCallback", async () => {
        await getResponseFromOrigin(ctx, "fetchCallback", "test");
        await ctx.eval(`
          setResult(typeof __testResponse.body.pipeTo === 'function');
        `);
        assert.strictEqual(ctx.getResult(), true, "pipeTo() should be a function");
      });

      test.todo("body.values() exists when from fetchCallback", async () => {
        await getResponseFromOrigin(ctx, "fetchCallback", "test");
        await ctx.eval(`
          setResult(typeof __testResponse.body.values === 'function');
        `);
        assert.strictEqual(ctx.getResult(), true, "values() should be a function");
      });
    });
  });

  // ============================================================================
  // Host-side Response (dispatchResponse origin)
  // ============================================================================

  describe("Host-side Response (dispatchResponse)", () => {
    test("dispatchResponse returns native Response", async () => {
      const response = await getDispatchResponse(ctx, "hello from isolate", { status: 201 });
      assert.ok(response instanceof Response);
      assert.strictEqual(response.status, 201);
    });

    test("dispatchResponse body can be consumed", async () => {
      const response = await getDispatchResponse(ctx, "response body content");
      const text = await response.text();
      assert.strictEqual(text, "response body content");
    });

    test("dispatchResponse headers are preserved", async () => {
      const response = await getDispatchResponse(ctx, "test", {
        headers: { "X-Custom-Header": "custom-value" },
      });
      assert.strictEqual(response.headers.get("X-Custom-Header"), "custom-value");
    });

    test("dispatchResponse statusText is preserved", async () => {
      const response = await getDispatchResponse(ctx, "test", {
        status: 201,
        statusText: "Created",
      });
      assert.strictEqual(response.statusText, "Created");
    });
  });

  // ============================================================================
  // Static Methods
  // ============================================================================

  describe("Static Methods", () => {
    test("Response.json() creates JSON response", async () => {
      await ctx.eval(`
        const response = Response.json({ foo: "bar" });
        setResult({
          status: response.status,
          contentType: response.headers.get("content-type"),
          isResponse: response instanceof Response,
        });
      `);
      const result = ctx.getResult() as { status: number; contentType: string; isResponse: boolean };
      assert.strictEqual(result.status, 200);
      assert.ok(result.contentType.includes("application/json"));
      assert.strictEqual(result.isResponse, true);
    });

    test("Response.redirect() creates redirect response", async () => {
      await ctx.eval(`
        const response = Response.redirect("https://example.com", 302);
        setResult({
          status: response.status,
          location: response.headers.get("location"),
          isResponse: response instanceof Response,
        });
      `);
      const result = ctx.getResult() as { status: number; location: string; isResponse: boolean };
      assert.strictEqual(result.status, 302);
      assert.strictEqual(result.location, "https://example.com");
      assert.strictEqual(result.isResponse, true);
    });

    test("Response.error() creates error response", async () => {
      await ctx.eval(`
        const response = Response.error();
        setResult({
          status: response.status,
          type: response.type,
          isResponse: response instanceof Response,
        });
      `);
      const result = ctx.getResult() as { status: number; type: string; isResponse: boolean };
      assert.strictEqual(result.status, 0);
      assert.strictEqual(result.type, "error");
      assert.strictEqual(result.isResponse, true);
    });
  });
});
