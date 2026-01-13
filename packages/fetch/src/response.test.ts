import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import {
  createFetchTestContext,
  evalCode,
  evalCodeAsync,
  runTestCode,
  type FetchTestContext,
} from "@ricsam/isolate-test-utils";

describe("Response", () => {
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
        const response = new Response("Hello Response");
        const text = await response.text();
        return JSON.stringify({ text });
      })()
    `
    );
    const result = JSON.parse(data);

    assert.strictEqual(result.text, "Hello Response");
  });

  test("json() body method", async () => {
    const data = await evalCodeAsync<string>(
      ctx.context,
      `
      (async () => {
        const response = new Response(JSON.stringify({ foo: "bar", num: 123 }));
        return JSON.stringify(await response.json());
      })()
    `
    );
    const result = JSON.parse(data) as { foo: string; num: number };

    assert.strictEqual(result.foo, "bar");
    assert.strictEqual(result.num, 123);
  });

  test("arrayBuffer() body method", async () => {
    const data = await evalCodeAsync<string>(
      ctx.context,
      `
      (async () => {
        const response = new Response("ABCDE");
        const buffer = await response.arrayBuffer();
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
    assert.strictEqual(result.byteLength, 5);
  });

  test("clone() creates copy", () => {
    const data = evalCode<string>(
      ctx.context,
      `
      const original = new Response("Clone me", { status: 201 });
      const cloned = original.clone();
      JSON.stringify({
        clonedStatus: cloned.status,
        sameStatus: original.status === cloned.status,
        originalNotUsed: !original.bodyUsed,
        clonedNotUsed: !cloned.bodyUsed,
      })
    `
    );
    const result = JSON.parse(data) as {
      clonedStatus: number;
      sameStatus: boolean;
      originalNotUsed: boolean;
      clonedNotUsed: boolean;
    };

    assert.strictEqual(result.clonedStatus, 201);
    assert.strictEqual(result.sameStatus, true);
    assert.strictEqual(result.originalNotUsed, true);
    assert.strictEqual(result.clonedNotUsed, true);
  });

  test("Response.json() with custom options", () => {
    const data = evalCode<string>(
      ctx.context,
      `
      const response = Response.json({ data: "test" }, {
        status: 201,
        headers: { "X-Custom": "value" },
      });
      JSON.stringify({
        status: response.status,
        customHeader: response.headers.get("X-Custom"),
        contentType: response.headers.get("Content-Type"),
      })
    `
    );
    const result = JSON.parse(data) as {
      status: number;
      customHeader: string;
      contentType: string;
    };

    assert.strictEqual(result.status, 201);
    assert.strictEqual(result.customHeader, "value");
    assert.ok(result.contentType.includes("application/json"));
  });

  test("body property returns HostBackedReadableStream", () => {
    const isStream = evalCode<boolean>(
      ctx.context,
      `
      const response = new Response("test body");
      response.body instanceof HostBackedReadableStream
      `
    );
    assert.strictEqual(isStream, true);
  });

  test("can read body via stream reader", async () => {
    const result = await evalCodeAsync<string>(
      ctx.context,
      `
      (async () => {
        const response = new Response("hello");
        const reader = response.body.getReader();
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

  test("Response with Headers(undefined) should be valid", async () => {
    const result = await evalCodeAsync<string>(
      ctx.context,
      `
      (async () => {
        const responseHeaders = new Headers(undefined);
        const response = new Response(JSON.stringify([]), {
          status: 200,
          headers: responseHeaders,
        });
        return JSON.stringify({
          status: response.status,
          ok: response.ok,
          body: await response.json(),
        });
      })()
      `
    );
    const data = JSON.parse(result) as {
      status: number;
      ok: boolean;
      body: unknown[];
    };
    assert.strictEqual(data.status, 200);
    assert.strictEqual(data.ok, true);
    assert.deepStrictEqual(data.body, []);
  });

  test("Response.json() with Headers instance should not leak internal properties", () => {
    // This test verifies that internal properties are non-enumerable
    const data = evalCode<string>(
      ctx.context,
      `
      const headers = new Headers();
      headers.set("x-custom", "value");

      // Check what properties exist on the Headers instance
      const headersOwnKeys = Object.keys(headers);

      // This is what Response.json does internally with Object.assign
      const assigned = Object.assign({ "content-type": "application/json" }, headers);
      const assignedKeys = Object.keys(assigned);
      const objectEntriesKeys = Object.entries(headers).map(e => e[0]);

      // When this assigned object is passed to Response
      const responseFromAssigned = new Response("test", { headers: assigned });
      const responseFromAssignedKeys = Array.from(responseFromAssigned.headers.keys());

      JSON.stringify({
        headersOwnKeys,
        assignedKeys,
        objectEntriesKeys,
        responseFromAssignedKeys,
        responseFromAssignedHasInstanceId: responseFromAssigned.headers.has("__instanceid__"),
        responseFromAssignedContentType: responseFromAssigned.headers.get("content-type"),
      })
      `
    );
    const result = JSON.parse(data) as {
      headersOwnKeys: string[];
      assignedKeys: string[];
      objectEntriesKeys: string[];
      responseFromAssignedKeys: string[];
      responseFromAssignedHasInstanceId: boolean;
      responseFromAssignedContentType: string | null;
    };

    // Internal properties should NOT be enumerable (not in Object.keys)
    assert.deepStrictEqual(result.headersOwnKeys, []);
    assert.deepStrictEqual(result.objectEntriesKeys, []);

    // Object.assign should NOT copy internal properties (since they're non-enumerable)
    assert.deepStrictEqual(result.assignedKeys, ["content-type"]);

    // Response created from plain object should only have content-type
    assert.deepStrictEqual(result.responseFromAssignedKeys, ["content-type"]);
    assert.strictEqual(result.responseFromAssignedHasInstanceId, false);
    assert.strictEqual(result.responseFromAssignedContentType, "application/json");
  });
});

/**
 * Native Response -> Isolate tests
 *
 * These tests verify that native Response objects passed into the isolate
 * behave identically to Response instances created with `new Response()` in the isolate.
 *
 * The tests use `runTestCode()` which converts native Response to isolate Response
 * instances before executing the test code.
 *
 * Note: These tests focus on synchronous properties. Body consumption methods
 * (text(), json(), arrayBuffer()) require async support in runTestCode which
 * is not yet implemented.
 */
describe("Native Response -> Isolate", () => {
  let ctx: FetchTestContext;

  beforeEach(async () => {
    ctx = await createFetchTestContext();
  });

  afterEach(() => {
    ctx.dispose();
  });

  test("native Response should pass instanceof check in isolate", () => {
    const runtime = runTestCode(
      ctx.context,
      `
      const response = testingInput.response;
      log("instanceof", response instanceof Response);
      log("constructorName", response.constructor.name);
    `
    ).input({
      response: new Response("test body"),
    });

    assert.deepStrictEqual(runtime.logs, {
      instanceof: true,
      constructorName: "Response",
    });
  });

  test("status property is preserved", () => {
    const runtime = runTestCode(
      ctx.context,
      `
      const response = testingInput.response;
      log("status", response.status);
    `
    ).input({
      response: new Response(null, { status: 201 }),
    });

    assert.strictEqual(runtime.logs.status, 201);
  });

  test("statusText property is preserved", () => {
    const runtime = runTestCode(
      ctx.context,
      `
      const response = testingInput.response;
      log("statusText", response.statusText);
    `
    ).input({
      response: new Response(null, { status: 201, statusText: "Created" }),
    });

    assert.strictEqual(runtime.logs.statusText, "Created");
  });

  test("ok property is correct for 2xx status", () => {
    const runtime = runTestCode(
      ctx.context,
      `
      const okResponse = testingInput.okResponse;
      const errorResponse = testingInput.errorResponse;
      log("okStatus", okResponse.ok);
      log("errorStatus", errorResponse.ok);
    `
    ).input({
      okResponse: new Response(null, { status: 200 }),
      errorResponse: new Response(null, { status: 404 }),
    });

    assert.deepStrictEqual(runtime.logs, {
      okStatus: true,
      errorStatus: false,
    });
  });

  test("headers property is a Headers instance", () => {
    const runtime = runTestCode(
      ctx.context,
      `
      const response = testingInput.response;
      log("headersInstanceof", response.headers instanceof Headers);
      log("contentType", response.headers.get("content-type"));
      log("customHeader", response.headers.get("x-custom"));
    `
    ).input({
      response: new Response(null, {
        headers: {
          "Content-Type": "application/json",
          "X-Custom": "test-value",
        },
      }),
    });

    assert.deepStrictEqual(runtime.logs, {
      headersInstanceof: true,
      contentType: "application/json",
      customHeader: "test-value",
    });
  });

  test("bodyUsed property exists and is false initially", () => {
    const runtime = runTestCode(
      ctx.context,
      `
      const response = testingInput.response;
      log("bodyUsed", response.bodyUsed);
      log("hasBodyUsed", typeof response.bodyUsed === "boolean");
    `
    ).input({
      response: new Response("test"),
    });

    assert.deepStrictEqual(runtime.logs, {
      bodyUsed: false,
      hasBodyUsed: true,
    });
  });

  test("type property exists", () => {
    const runtime = runTestCode(
      ctx.context,
      `
      const response = testingInput.response;
      log("type", response.type);
      log("hasType", typeof response.type === "string");
    `
    ).input({
      response: new Response(null),
    });

    assert.strictEqual(runtime.logs.hasType, true);
    assert.strictEqual(typeof runtime.logs.type, "string");
  });

  test("redirected property exists", () => {
    const runtime = runTestCode(
      ctx.context,
      `
      const response = testingInput.response;
      log("redirected", response.redirected);
      log("hasRedirected", typeof response.redirected === "boolean");
    `
    ).input({
      response: new Response(null),
    });

    assert.deepStrictEqual(runtime.logs, {
      redirected: false,
      hasRedirected: true,
    });
  });

  test("all standard properties exist", () => {
    const runtime = runTestCode(
      ctx.context,
      `
      const response = testingInput.response;
      log("hasStatus", typeof response.status === "number");
      log("hasStatusText", typeof response.statusText === "string");
      log("hasOk", typeof response.ok === "boolean");
      log("hasHeaders", response.headers instanceof Headers);
      log("hasBodyUsed", typeof response.bodyUsed === "boolean");
      log("hasType", typeof response.type === "string");
      log("hasRedirected", typeof response.redirected === "boolean");
      log("hasUrl", typeof response.url === "string");
    `
    ).input({
      response: new Response(null),
    });

    assert.deepStrictEqual(runtime.logs, {
      hasStatus: true,
      hasStatusText: true,
      hasOk: true,
      hasHeaders: true,
      hasBodyUsed: true,
      hasType: true,
      hasRedirected: true,
      hasUrl: true,
    });
  });

  describe("Bidirectional Conversion (Native->Isolate->Native)", () => {
    test("Response created in isolate should return as native Response", () => {
      const runtime = runTestCode(
        ctx.context,
        `
        const response = new Response(null, {
          status: 201,
          statusText: "Created",
          headers: { "Content-Type": "application/json" }
        });
        log("response", response);
      `
      ).input({});

      assert.ok(runtime.logs.response instanceof Response);
      assert.strictEqual((runtime.logs.response as Response).status, 201);
      assert.strictEqual((runtime.logs.response as Response).statusText, "Created");
    });

    test("native Response passed through isolate returns as native Response", () => {
      const runtime = runTestCode(
        ctx.context,
        `
        const response = testingInput.response;
        log("response", response);
      `
      ).input({
        response: new Response(null, {
          status: 404,
          statusText: "Not Found",
          headers: { "X-Error": "missing" },
        }),
      });

      assert.ok(runtime.logs.response instanceof Response);
      assert.strictEqual((runtime.logs.response as Response).status, 404);
      assert.strictEqual((runtime.logs.response as Response).statusText, "Not Found");
    });

    test("Response headers should be native Headers after round-trip", () => {
      const runtime = runTestCode(
        ctx.context,
        `
        const response = new Response(null, {
          headers: { "Content-Type": "text/html" }
        });
        log("response", response);
      `
      ).input({});

      assert.ok(runtime.logs.response instanceof Response);
      assert.ok((runtime.logs.response as Response).headers instanceof Headers);
      assert.strictEqual(
        (runtime.logs.response as Response).headers.get("content-type"),
        "text/html"
      );
    });

    test("nested object with Response converts properly", () => {
      const runtime = runTestCode(
        ctx.context,
        `
        const response = testingInput.response;
        log("result", {
          response: response,
          metadata: { cached: true }
        });
      `
      ).input({
        response: new Response(null, { status: 200 }),
      });

      const result = runtime.logs.result as {
        response: Response;
        metadata: { cached: boolean };
      };
      assert.ok(result.response instanceof Response);
      assert.strictEqual(result.response.status, 200);
      assert.deepStrictEqual(result.metadata, { cached: true });
    });
  });
});
