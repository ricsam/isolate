import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import {
  createFetchTestContext,
  evalCode,
  runTestCode,
  type FetchTestContext,
} from "@ricsam/isolate-test-utils";

describe("Headers", () => {
  let ctx: FetchTestContext;

  beforeEach(async () => {
    ctx = await createFetchTestContext();
  });

  afterEach(() => {
    ctx.dispose();
  });

  test("case-insensitive get", () => {
    const data = evalCode<{ withCaps: string; lowercase: string; uppercase: string }>(
      ctx.context,
      `
      const headers = new Headers({ "Content-Type": "application/json" });
      JSON.stringify({
        withCaps: headers.get("Content-Type"),
        lowercase: headers.get("content-type"),
        uppercase: headers.get("CONTENT-TYPE"),
      })
    `
    );
    const result = JSON.parse(data as unknown as string);

    assert.strictEqual(result.withCaps, "application/json");
    assert.strictEqual(result.lowercase, "application/json");
    assert.strictEqual(result.uppercase, "application/json");
  });

  test("forEach callback", () => {
    const data = evalCode<string>(
      ctx.context,
      `
      const headers = new Headers({ "X-One": "1", "X-Two": "2" });
      const collected = [];
      headers.forEach((value, key) => {
        collected.push({ value, key: key.toLowerCase() });
      });
      JSON.stringify(collected)
    `
    );
    const collected = JSON.parse(data) as { value: string; key: string }[];

    assert.strictEqual(collected.length, 2);
    assert.deepStrictEqual(
      collected.map((d) => d.key).sort(),
      ["x-one", "x-two"]
    );
    assert.deepStrictEqual(
      collected.map((d) => d.value).sort(),
      ["1", "2"]
    );
  });

  test("getSetCookie returns array", () => {
    const data = evalCode<string>(
      ctx.context,
      `
      const headers = new Headers();
      headers.append("Set-Cookie", "a=1");
      headers.append("Set-Cookie", "b=2");
      JSON.stringify({
        cookies: headers.getSetCookie(),
        regular: headers.get("Set-Cookie"),
      })
    `
    );
    const result = JSON.parse(data) as { cookies: string[]; regular: string };

    assert.deepStrictEqual(result.cookies, ["a=1", "b=2"]);
    assert.strictEqual(result.regular, "a=1, b=2");
  });

  test("constructor with array of pairs", () => {
    const data = evalCode<string>(
      ctx.context,
      `
      const headers = new Headers([["X-First", "one"], ["X-Second", "two"]]);
      JSON.stringify({
        first: headers.get("X-First"),
        second: headers.get("X-Second"),
        keys: Array.from(headers.keys()).map(k => k.toLowerCase()),
      })
    `
    );
    const result = JSON.parse(data) as { first: string; second: string; keys: string[] };

    assert.strictEqual(result.first, "one");
    assert.strictEqual(result.second, "two");
    assert.deepStrictEqual(result.keys.sort(), ["x-first", "x-second"]);
  });

  test("for...of iteration on Headers", () => {
    const data = evalCode<string>(
      ctx.context,
      `
      const headers = new Headers({
        "Content-Type": "application/json",
        "X-Custom": "value"
      });
      const entries = [];
      for (const [key, value] of headers) {
        entries.push([key.toLowerCase(), value]);
      }
      JSON.stringify(entries)
      `
    );
    const entries = JSON.parse(data) as Array<[string, string]>;

    assert.ok(
      entries.some(([k, v]) => k === "content-type" && v === "application/json")
    );
    assert.ok(entries.some(([k, v]) => k === "x-custom" && v === "value"));
  });

  test("Array.from(headers)", () => {
    const data = evalCode<string>(
      ctx.context,
      `
      const headers = new Headers({
        "Content-Type": "application/json",
        "Accept": "text/html"
      });
      JSON.stringify(Array.from(headers).map(([k, v]) => [k.toLowerCase(), v]))
      `
    );
    const entries = JSON.parse(data) as Array<[string, string]>;

    assert.ok(
      entries.some(([k, v]) => k === "content-type" && v === "application/json")
    );
    assert.ok(entries.some(([k, v]) => k === "accept" && v === "text/html"));
  });

  test("headers should not include internal properties", () => {
    const data = evalCode<string>(
      ctx.context,
      `
      const headers = new Headers({
        "Content-Type": "application/octet-stream",
      });
      JSON.stringify({
        entries: Array.from(headers.entries()).map(([k, v]) => [k.toLowerCase(), v]),
        keys: Array.from(headers.keys()).map(k => k.toLowerCase()),
      })
      `
    );
    const result = JSON.parse(data) as {
      entries: Array<[string, string]>;
      keys: string[];
    };

    // Headers should only contain the actual header, not internal properties
    assert.deepStrictEqual(result.keys, ["content-type"]);
    assert.ok(!result.keys.includes("__instanceid__"));
    assert.ok(!result.keys.includes("__classname__"));
    assert.deepStrictEqual(result.entries, [
      ["content-type", "application/octet-stream"],
    ]);
  });

  test("instanceof Headers returns true", () => {
    const data = evalCode<string>(
      ctx.context,
      `
      const headers = new Headers();
      JSON.stringify({ instanceofHeaders: headers instanceof Headers })
      `
    );
    const result = JSON.parse(data) as { instanceofHeaders: boolean };
    assert.strictEqual(result.instanceofHeaders, true);
  });

  test("constructor.name is 'Headers'", () => {
    const data = evalCode<string>(
      ctx.context,
      `
      const headers = new Headers();
      JSON.stringify({ constructorName: headers.constructor.name })
      `
    );
    const result = JSON.parse(data) as { constructorName: string };
    assert.strictEqual(result.constructorName, "Headers");
  });

  test("new Headers(existingHeaders) copies headers", () => {
    const data = evalCode<string>(
      ctx.context,
      `
      const original = new Headers();
      original.set('cookie', 'session=abc123');
      original.set('content-type', 'application/json');

      const copied = new Headers(original);

      JSON.stringify({
        originalCookie: original.get('cookie'),
        copiedCookie: copied.get('cookie'),
        originalContentType: original.get('content-type'),
        copiedContentType: copied.get('content-type'),
      })
      `
    );
    const result = JSON.parse(data) as {
      originalCookie: string | null;
      copiedCookie: string | null;
      originalContentType: string | null;
      copiedContentType: string | null;
    };
    assert.strictEqual(result.originalCookie, "session=abc123");
    assert.strictEqual(result.copiedCookie, "session=abc123");
    assert.strictEqual(result.originalContentType, "application/json");
    assert.strictEqual(result.copiedContentType, "application/json");
  });
});

/**
 * Native Headers -> Isolate tests
 *
 * These tests verify that native Headers objects passed into the isolate
 * behave identically to Headers instances created with `new Headers()` in the isolate.
 *
 * The tests use `runTestCode()` which converts native Headers to isolate Headers
 * instances before executing the test code.
 */
describe("Native Headers -> Isolate", () => {
  let ctx: FetchTestContext;

  beforeEach(async () => {
    ctx = await createFetchTestContext();
  });

  afterEach(() => {
    ctx.dispose();
  });

  test("native Headers should pass instanceof check in isolate", () => {
    const runtime = runTestCode(
      ctx.context,
      `
      const headers = testingInput.headers;
      log("instanceof", headers instanceof Headers);
      log("constructorName", headers.constructor.name);
    `
    ).input({
      headers: new Headers({ "Content-Type": "application/json" }),
    });

    assert.deepStrictEqual(runtime.logs, {
      instanceof: true,
      constructorName: "Headers",
    });
  });

  test("case-insensitive get", () => {
    const runtime = runTestCode(
      ctx.context,
      `
      const headers = testingInput.headers;
      log("withCaps", headers.get("Content-Type"));
      log("lowercase", headers.get("content-type"));
      log("uppercase", headers.get("CONTENT-TYPE"));
    `
    ).input({
      headers: new Headers({ "Content-Type": "application/json" }),
    });

    assert.deepStrictEqual(runtime.logs, {
      withCaps: "application/json",
      lowercase: "application/json",
      uppercase: "application/json",
    });
  });

  test("forEach callback", () => {
    const runtime = runTestCode(
      ctx.context,
      `
      const headers = testingInput.headers;
      const collected = [];
      headers.forEach((value, key) => {
        collected.push({ value, key });
      });
      log("collected", collected);
    `
    ).input({
      headers: new Headers({ "X-One": "1", "X-Two": "2" }),
    });

    const collected = runtime.logs.collected as { value: string; key: string }[];
    assert.strictEqual(collected.length, 2);
    assert.deepStrictEqual(
      collected.map((d) => d.key).sort(),
      ["x-one", "x-two"]
    );
    assert.deepStrictEqual(
      collected.map((d) => d.value).sort(),
      ["1", "2"]
    );
  });

  test("getSetCookie returns array", () => {
    // Native Headers with multiple Set-Cookie values
    const nativeHeaders = new Headers();
    nativeHeaders.append("Set-Cookie", "a=1");
    nativeHeaders.append("Set-Cookie", "b=2");

    const runtime = runTestCode(
      ctx.context,
      `
      const headers = testingInput.headers;
      log("cookies", headers.getSetCookie());
      log("regular", headers.get("Set-Cookie"));
    `
    ).input({
      headers: nativeHeaders,
    });

    assert.deepStrictEqual(runtime.logs.cookies, ["a=1", "b=2"]);
    assert.strictEqual(runtime.logs.regular, "a=1, b=2");
  });

  test("for...of iteration on Headers", () => {
    const runtime = runTestCode(
      ctx.context,
      `
      const headers = testingInput.headers;
      const entries = [];
      for (const [key, value] of headers) {
        entries.push([key, value]);
      }
      log("entries", entries);
    `
    ).input({
      headers: new Headers({
        "Content-Type": "application/json",
        "X-Custom": "value",
      }),
    });

    const entries = runtime.logs.entries as Array<[string, string]>;
    assert.ok(
      entries.some(([k, v]) => k === "content-type" && v === "application/json")
    );
    assert.ok(entries.some(([k, v]) => k === "x-custom" && v === "value"));
  });

  test("Array.from(headers)", () => {
    const runtime = runTestCode(
      ctx.context,
      `
      const headers = testingInput.headers;
      log("entries", Array.from(headers));
    `
    ).input({
      headers: new Headers({
        "Content-Type": "application/json",
        Accept: "text/html",
      }),
    });

    const entries = runtime.logs.entries as Array<[string, string]>;
    assert.ok(
      entries.some(([k, v]) => k === "content-type" && v === "application/json")
    );
    assert.ok(entries.some(([k, v]) => k === "accept" && v === "text/html"));
  });

  test("headers should not include internal properties", () => {
    const runtime = runTestCode(
      ctx.context,
      `
      const headers = testingInput.headers;
      log("entries", Array.from(headers.entries()));
      log("keys", Array.from(headers.keys()));
    `
    ).input({
      headers: new Headers({
        "Content-Type": "application/octet-stream",
      }),
    });

    const keys = runtime.logs.keys as string[];
    const entries = runtime.logs.entries as Array<[string, string]>;

    assert.deepStrictEqual(keys, ["content-type"]);
    assert.ok(!keys.includes("__instanceid__"));
    assert.ok(!keys.includes("__classname__"));
    assert.deepStrictEqual(entries, [
      ["content-type", "application/octet-stream"],
    ]);
  });

  test("methods work correctly (set, has, delete)", () => {
    const runtime = runTestCode(
      ctx.context,
      `
      const headers = testingInput.headers;
      log("initialGet", headers.get("content-type"));
      log("initialHas", headers.has("content-type"));

      headers.set("x-custom", "new-value");
      log("afterSet", headers.get("x-custom"));

      headers.delete("content-type");
      log("afterDelete", headers.has("content-type"));
    `
    ).input({
      headers: new Headers({ "Content-Type": "application/json" }),
    });

    assert.deepStrictEqual(runtime.logs, {
      initialGet: "application/json",
      initialHas: true,
      afterSet: "new-value",
      afterDelete: false,
    });
  });

  test("append adds to existing header", () => {
    const runtime = runTestCode(
      ctx.context,
      `
      const headers = testingInput.headers;
      headers.append("Accept", "text/html");
      log("afterAppend", headers.get("Accept"));
    `
    ).input({
      headers: new Headers({ Accept: "application/json" }),
    });

    assert.strictEqual(runtime.logs.afterAppend, "application/json, text/html");
  });

  test("keys() and values() methods", () => {
    const runtime = runTestCode(
      ctx.context,
      `
      const headers = testingInput.headers;
      log("keys", Array.from(headers.keys()));
      log("values", Array.from(headers.values()));
    `
    ).input({
      headers: new Headers({ "X-First": "one", "X-Second": "two" }),
    });

    const keys = runtime.logs.keys as string[];
    const values = runtime.logs.values as string[];

    assert.deepStrictEqual(keys.sort(), ["x-first", "x-second"]);
    assert.deepStrictEqual(values.sort(), ["one", "two"]);
  });

  describe("Bidirectional Conversion (Native->Isolate->Native)", () => {
    test("Headers created in isolate should return as native Headers", () => {
      const runtime = runTestCode(
        ctx.context,
        `
        const headers = new Headers({ "Content-Type": "application/json" });
        log("headers", headers);
      `
      ).input({});

      assert.ok(runtime.logs.headers instanceof Headers);
      assert.strictEqual(
        (runtime.logs.headers as Headers).get("content-type"),
        "application/json"
      );
    });

    test("native Headers passed through isolate returns as native Headers", () => {
      const runtime = runTestCode(
        ctx.context,
        `
        const headers = testingInput.headers;
        log("headers", headers);
      `
      ).input({
        headers: new Headers({ "Content-Type": "application/json" }),
      });

      assert.ok(runtime.logs.headers instanceof Headers);
      assert.strictEqual(
        (runtime.logs.headers as Headers).get("content-type"),
        "application/json"
      );
    });

    test("modifications in isolate are preserved when returning as native Headers", () => {
      const runtime = runTestCode(
        ctx.context,
        `
        const headers = testingInput.headers;
        headers.append("x-added", "new-value");
        headers.set("x-custom", "custom-value");
        log("headers", headers);
      `
      ).input({
        headers: new Headers({ "Content-Type": "application/json" }),
      });

      assert.ok(runtime.logs.headers instanceof Headers);
      const headers = runtime.logs.headers as Headers;
      assert.strictEqual(headers.get("content-type"), "application/json");
      assert.strictEqual(headers.get("x-added"), "new-value");
      assert.strictEqual(headers.get("x-custom"), "custom-value");
    });

    test("deleted headers are not present in returned native Headers", () => {
      const runtime = runTestCode(
        ctx.context,
        `
        const headers = testingInput.headers;
        headers.delete("x-to-delete");
        log("headers", headers);
      `
      ).input({
        headers: new Headers({
          "Content-Type": "application/json",
          "X-To-Delete": "will be deleted",
        }),
      });

      assert.ok(runtime.logs.headers instanceof Headers);
      const headers = runtime.logs.headers as Headers;
      assert.strictEqual(headers.get("content-type"), "application/json");
      assert.strictEqual(headers.has("x-to-delete"), false);
    });

    test("nested object with Headers converts properly", () => {
      const runtime = runTestCode(
        ctx.context,
        `
        const headers = testingInput.headers;
        headers.set("x-modified", "true");
        log("result", {
          headers: headers,
          metadata: { count: 3 }
        });
      `
      ).input({
        headers: new Headers({ "Content-Type": "application/json" }),
      });

      const result = runtime.logs.result as {
        headers: Headers;
        metadata: { count: number };
      };
      assert.ok(result.headers instanceof Headers);
      assert.strictEqual(result.headers.get("x-modified"), "true");
      assert.deepStrictEqual(result.metadata, { count: 3 });
    });

    test("array of Headers converts properly", () => {
      const runtime = runTestCode(
        ctx.context,
        `
        const h1 = new Headers({ "X-First": "one" });
        const h2 = new Headers({ "X-Second": "two" });
        log("headers", [h1, h2]);
      `
      ).input({});

      const headers = runtime.logs.headers as Headers[];
      assert.strictEqual(headers.length, 2);
      assert.ok(headers[0] instanceof Headers);
      assert.ok(headers[1] instanceof Headers);
      assert.strictEqual(headers[0].get("x-first"), "one");
      assert.strictEqual(headers[1].get("x-second"), "two");
    });
  });
});
