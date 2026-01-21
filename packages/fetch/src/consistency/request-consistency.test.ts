import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import {
  createConsistencyTestContext,
  getRequestFromOrigin,
  type ConsistencyTestContext,
  type RequestOrigin,
  REQUEST_ORIGINS,
} from "./origins.ts";

describe("Request Consistency", () => {
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
    for (const origin of REQUEST_ORIGINS) {
      test(`method property exists when from ${origin}`, async () => {
        await getRequestFromOrigin(ctx, origin, "https://example.com");
        await ctx.eval(`
          setResult(typeof __testRequest.method === 'string');
        `);
        assert.strictEqual(ctx.getResult(), true);
      });

      test(`url property exists when from ${origin}`, async () => {
        await getRequestFromOrigin(ctx, origin, "https://example.com/path");
        await ctx.eval(`
          setResult(typeof __testRequest.url === 'string');
        `);
        assert.strictEqual(ctx.getResult(), true);
      });

      test(`headers property exists when from ${origin}`, async () => {
        await getRequestFromOrigin(ctx, origin, "https://example.com");
        await ctx.eval(`
          setResult(__testRequest.headers instanceof Headers);
        `);
        assert.strictEqual(ctx.getResult(), true);
      });

      test(`bodyUsed property exists when from ${origin}`, async () => {
        await getRequestFromOrigin(ctx, origin, "https://example.com");
        await ctx.eval(`
          setResult(typeof __testRequest.bodyUsed === 'boolean');
        `);
        assert.strictEqual(ctx.getResult(), true);
      });

      test(`mode property exists when from ${origin}`, async () => {
        await getRequestFromOrigin(ctx, origin, "https://example.com");
        await ctx.eval(`
          setResult(typeof __testRequest.mode === 'string');
        `);
        assert.strictEqual(ctx.getResult(), true);
      });

      test(`credentials property exists when from ${origin}`, async () => {
        await getRequestFromOrigin(ctx, origin, "https://example.com");
        await ctx.eval(`
          setResult(typeof __testRequest.credentials === 'string');
        `);
        assert.strictEqual(ctx.getResult(), true);
      });

      test(`cache property exists when from ${origin}`, async () => {
        await getRequestFromOrigin(ctx, origin, "https://example.com");
        await ctx.eval(`
          setResult(typeof __testRequest.cache === 'string');
        `);
        assert.strictEqual(ctx.getResult(), true);
      });

      test(`redirect property exists when from ${origin}`, async () => {
        await getRequestFromOrigin(ctx, origin, "https://example.com");
        await ctx.eval(`
          setResult(typeof __testRequest.redirect === 'string');
        `);
        assert.strictEqual(ctx.getResult(), true);
      });

      test(`referrer property exists when from ${origin}`, async () => {
        await getRequestFromOrigin(ctx, origin, "https://example.com");
        await ctx.eval(`
          setResult(typeof __testRequest.referrer === 'string');
        `);
        assert.strictEqual(ctx.getResult(), true);
      });

      test(`integrity property exists when from ${origin}`, async () => {
        await getRequestFromOrigin(ctx, origin, "https://example.com");
        await ctx.eval(`
          setResult(typeof __testRequest.integrity === 'string');
        `);
        assert.strictEqual(ctx.getResult(), true);
      });
    }
  });

  // ============================================================================
  // Property Values
  // ============================================================================

  describe("Property Values", () => {
    for (const origin of REQUEST_ORIGINS) {
      test(`method returns correct value when from ${origin}`, async () => {
        await getRequestFromOrigin(ctx, origin, "https://example.com", { method: "POST" });
        await ctx.eval(`
          setResult(__testRequest.method);
        `);
        assert.strictEqual(ctx.getResult(), "POST");
      });

      test(`url returns correct value when from ${origin}`, async () => {
        await getRequestFromOrigin(ctx, origin, "https://example.com/path?query=1");
        await ctx.eval(`
          setResult(__testRequest.url);
        `);
        assert.strictEqual(ctx.getResult(), "https://example.com/path?query=1");
      });

      test(`headers.get() works when from ${origin}`, async () => {
        await getRequestFromOrigin(ctx, origin, "https://example.com", {
          headers: { "X-Custom": "test-value" },
        });
        await ctx.eval(`
          setResult(__testRequest.headers.get("X-Custom"));
        `);
        assert.strictEqual(ctx.getResult(), "test-value");
      });

      test(`bodyUsed is initially false when from ${origin}`, async () => {
        await getRequestFromOrigin(ctx, origin, "https://example.com");
        await ctx.eval(`
          setResult(__testRequest.bodyUsed);
        `);
        assert.strictEqual(ctx.getResult(), false);
      });
    }
  });

  // ============================================================================
  // Body Methods (for POST/PUT requests)
  // Note: serveRequest origin has limitations with request body transfer
  // ============================================================================

  describe("Body Methods", () => {
    // serveRequest origin doesn't properly transfer request body
    const BODY_ORIGINS = REQUEST_ORIGINS.filter(o => o !== "serveRequest") as RequestOrigin[];

    for (const origin of BODY_ORIGINS) {
      test(`text() returns body content when from ${origin}`, async () => {
        await getRequestFromOrigin(ctx, origin, "https://example.com", {
          method: "POST",
          body: "hello world",
        });
        await ctx.eval(`
          const text = await __testRequest.text();
          setResult(text);
        `);
        assert.strictEqual(ctx.getResult(), "hello world");
      });

      test(`json() parses JSON body when from ${origin}`, async () => {
        await getRequestFromOrigin(ctx, origin, "https://example.com", {
          method: "POST",
          body: '{"foo": "bar"}',
          headers: { "Content-Type": "application/json" },
        });
        await ctx.eval(`
          const data = await __testRequest.json();
          setResult(JSON.stringify(data));
        `);
        assert.deepStrictEqual(JSON.parse(ctx.getResult() as string), { foo: "bar" });
      });

      test(`arrayBuffer() returns buffer when from ${origin}`, async () => {
        await getRequestFromOrigin(ctx, origin, "https://example.com", {
          method: "POST",
          body: "ABCDE",
        });
        await ctx.eval(`
          const buffer = await __testRequest.arrayBuffer();
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
        await getRequestFromOrigin(ctx, origin, "https://example.com", {
          method: "POST",
          body: "blob content",
          headers: { "Content-Type": "text/plain" },
        });
        await ctx.eval(`
          const blob = await __testRequest.blob();
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
        await getRequestFromOrigin(ctx, origin, "https://example.com", {
          method: "POST",
          body: "name=John&age=30",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
        });
        await ctx.eval(`
          const formData = await __testRequest.formData();
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
        await getRequestFromOrigin(ctx, origin, "https://example.com", {
          method: "POST",
          body: "test body",
        });
        await ctx.eval(`
          await __testRequest.text();
          setResult(__testRequest.bodyUsed);
        `);
        assert.strictEqual(ctx.getResult(), true);
      });

      test(`consuming body twice throws error when from ${origin}`, async () => {
        await getRequestFromOrigin(ctx, origin, "https://example.com", {
          method: "POST",
          body: "test body",
        });
        await ctx.eval(`
          await __testRequest.text();
          try {
            await __testRequest.text();
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

    // WHATWG Issue: Request body not transferred to serve() handler
    // See WHATWG_INCONSISTENCIES.md#3-request-body-not-transferred-to-serve-handler
    test.todo("text() returns body content when from serveRequest", async () => {
      await getRequestFromOrigin(ctx, "serveRequest", "https://example.com", {
        method: "POST",
        body: "hello world",
      });
      await ctx.eval(`
        const text = await __testRequest.text();
        setResult(text);
      `);
      assert.strictEqual(ctx.getResult(), "hello world", "Request body should be transferred to serve handler");
    });

    test.todo("json() parses JSON body when from serveRequest", async () => {
      await getRequestFromOrigin(ctx, "serveRequest", "https://example.com", {
        method: "POST",
        body: '{"foo": "bar"}',
        headers: { "Content-Type": "application/json" },
      });
      await ctx.eval(`
        const data = await __testRequest.json();
        setResult(JSON.stringify(data));
      `);
      assert.deepStrictEqual(JSON.parse(ctx.getResult() as string), { foo: "bar" });
    });

    test.todo("arrayBuffer() returns buffer when from serveRequest", async () => {
      await getRequestFromOrigin(ctx, "serveRequest", "https://example.com", {
        method: "POST",
        body: "ABCDE",
      });
      await ctx.eval(`
        const buffer = await __testRequest.arrayBuffer();
        setResult({
          isArrayBuffer: buffer instanceof ArrayBuffer,
          byteLength: buffer.byteLength,
        });
      `);
      const result = ctx.getResult() as { isArrayBuffer: boolean; byteLength: number };
      assert.strictEqual(result.isArrayBuffer, true);
      assert.strictEqual(result.byteLength, 5, "Request body buffer should have correct size");
    });
  });

  // ============================================================================
  // Body Property for GET/HEAD
  // ============================================================================

  describe("Body Property for GET/HEAD", () => {
    for (const origin of REQUEST_ORIGINS) {
      test(`body is null for GET request when from ${origin}`, async () => {
        await getRequestFromOrigin(ctx, origin, "https://example.com", { method: "GET" });
        await ctx.eval(`
          setResult(__testRequest.body === null);
        `);
        assert.strictEqual(ctx.getResult(), true);
      });

      test(`body is null for HEAD request when from ${origin}`, async () => {
        await getRequestFromOrigin(ctx, origin, "https://example.com", { method: "HEAD" });
        await ctx.eval(`
          setResult(__testRequest.body === null);
        `);
        assert.strictEqual(ctx.getResult(), true);
      });
    }
  });

  // ============================================================================
  // Clone Method
  // ============================================================================

  describe("Clone Method", () => {
    for (const origin of REQUEST_ORIGINS) {
      test(`clone() creates independent copy when from ${origin}`, async () => {
        await getRequestFromOrigin(ctx, origin, "https://example.com/path", { method: "GET" });
        await ctx.eval(`
          const cloned = __testRequest.clone();
          setResult({
            clonedUrl: cloned.url,
            clonedMethod: cloned.method,
            sameUrl: __testRequest.url === cloned.url,
            originalNotUsed: !__testRequest.bodyUsed,
            clonedNotUsed: !cloned.bodyUsed,
            isRequest: cloned instanceof Request,
          });
        `);
        const result = ctx.getResult() as {
          clonedUrl: string;
          clonedMethod: string;
          sameUrl: boolean;
          originalNotUsed: boolean;
          clonedNotUsed: boolean;
          isRequest: boolean;
        };
        assert.strictEqual(result.clonedUrl, "https://example.com/path");
        assert.strictEqual(result.clonedMethod, "GET");
        assert.strictEqual(result.sameUrl, true);
        assert.strictEqual(result.originalNotUsed, true);
        assert.strictEqual(result.clonedNotUsed, true);
        assert.strictEqual(result.isRequest, true);
      });
    }

    // Body-related clone tests - serveRequest doesn't transfer body properly
    const BODY_ORIGINS = REQUEST_ORIGINS.filter(o => o !== "serveRequest") as RequestOrigin[];

    for (const origin of BODY_ORIGINS) {
      test(`clone() body can be consumed independently when from ${origin}`, async () => {
        await getRequestFromOrigin(ctx, origin, "https://example.com", {
          method: "POST",
          body: "test content",
        });
        await ctx.eval(`
          const cloned = __testRequest.clone();
          const originalText = await __testRequest.text();
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
        await getRequestFromOrigin(ctx, origin, "https://example.com", {
          method: "POST",
          body: "test body",
        });
        await ctx.eval(`
          await __testRequest.text();
          try {
            __testRequest.clone();
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
    for (const origin of REQUEST_ORIGINS) {
      test(`request instanceof Request when from ${origin}`, async () => {
        await getRequestFromOrigin(ctx, origin, "https://example.com");
        await ctx.eval(`
          setResult(__testRequest instanceof Request);
        `);
        assert.strictEqual(ctx.getResult(), true);
      });

      test(`request.constructor.name is Request when from ${origin}`, async () => {
        await getRequestFromOrigin(ctx, origin, "https://example.com");
        await ctx.eval(`
          setResult(__testRequest.constructor.name);
        `);
        assert.strictEqual(ctx.getResult(), "Request");
      });
    }
  });

  // ============================================================================
  // Request Options
  // ============================================================================

  describe("Request Options", () => {
    for (const origin of REQUEST_ORIGINS) {
      // Skip serveRequest for options tests as they come from the host
      if (origin === "serveRequest") continue;

      test(`default mode is cors when from ${origin}`, async () => {
        await getRequestFromOrigin(ctx, origin, "https://example.com");
        await ctx.eval(`
          setResult(__testRequest.mode);
        `);
        assert.strictEqual(ctx.getResult(), "cors");
      });

      test(`default credentials is same-origin when from ${origin}`, async () => {
        await getRequestFromOrigin(ctx, origin, "https://example.com");
        await ctx.eval(`
          setResult(__testRequest.credentials);
        `);
        assert.strictEqual(ctx.getResult(), "same-origin");
      });

      test(`default cache is default when from ${origin}`, async () => {
        await getRequestFromOrigin(ctx, origin, "https://example.com");
        await ctx.eval(`
          setResult(__testRequest.cache);
        `);
        assert.strictEqual(ctx.getResult(), "default");
      });

      test(`default redirect is follow when from ${origin}`, async () => {
        await getRequestFromOrigin(ctx, origin, "https://example.com");
        await ctx.eval(`
          setResult(__testRequest.redirect);
        `);
        assert.strictEqual(ctx.getResult(), "follow");
      });
    }
  });

  // ============================================================================
  // Body Property Existence
  // ============================================================================

  describe("Body Property", () => {
    for (const origin of REQUEST_ORIGINS) {
      test(`body property is stream for POST with body when from ${origin}`, async () => {
        await getRequestFromOrigin(ctx, origin, "https://example.com", {
          method: "POST",
          body: "test body",
        });
        await ctx.eval(`
          const body = __testRequest.body;
          setResult({
            hasBody: body !== null,
            hasGetReader: body !== null && typeof body.getReader === 'function',
          });
        `);
        const result = ctx.getResult() as { hasBody: boolean; hasGetReader: boolean };
        assert.strictEqual(result.hasBody, true);
        assert.strictEqual(result.hasGetReader, true);
      });
    }
  });

  // ============================================================================
  // Constructor from Request
  // ============================================================================

  describe("Constructor from Request", () => {
    test("new Request(request) creates copy", async () => {
      await ctx.eval(`
        const original = new Request("https://example.com/path", {
          method: "POST",
          headers: { "X-Test": "value" },
        });
        const copy = new Request(original);
        setResult({
          url: copy.url,
          method: copy.method,
          header: copy.headers.get("X-Test"),
        });
      `);
      const result = ctx.getResult() as { url: string; method: string; header: string };
      assert.strictEqual(result.url, "https://example.com/path");
      assert.strictEqual(result.method, "POST");
      assert.strictEqual(result.header, "value");
    });

    test("new Request(request, init) allows override", async () => {
      await ctx.eval(`
        const original = new Request("https://example.com/path", {
          method: "POST",
          headers: { "X-Test": "original" },
        });
        const copy = new Request(original, {
          method: "PUT",
          headers: { "X-Test": "override" },
        });
        setResult({
          url: copy.url,
          method: copy.method,
          header: copy.headers.get("X-Test"),
        });
      `);
      const result = ctx.getResult() as { url: string; method: string; header: string };
      assert.strictEqual(result.url, "https://example.com/path");
      assert.strictEqual(result.method, "PUT");
      assert.strictEqual(result.header, "override");
    });
  });

  // ============================================================================
  // Error Cases
  // ============================================================================

  describe("Error Cases", () => {
    test("Request with GET and body throws TypeError", async () => {
      await ctx.eval(`
        try {
          new Request("https://example.com", { method: "GET", body: "test" });
          setResult({ threw: false });
        } catch (e) {
          setResult({ threw: true, name: e.name });
        }
      `);
      const result = ctx.getResult() as { threw: boolean; name?: string };
      assert.strictEqual(result.threw, true);
      assert.strictEqual(result.name, "TypeError");
    });

    test("Request with HEAD and body throws TypeError", async () => {
      await ctx.eval(`
        try {
          new Request("https://example.com", { method: "HEAD", body: "test" });
          setResult({ threw: false });
        } catch (e) {
          setResult({ threw: true, name: e.name });
        }
      `);
      const result = ctx.getResult() as { threw: boolean; name?: string };
      assert.strictEqual(result.threw, true);
      assert.strictEqual(result.name, "TypeError");
    });
  });
});
