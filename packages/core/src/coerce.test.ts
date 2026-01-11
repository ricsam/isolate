import { describe, test, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import ivm from "isolated-vm";

describe("coerce", () => {
  describe("createCoercer", () => {
    test("creates a coercer with safeParse that returns success", async () => {
      // TODO: Implement test
      // const stringCoercer = createCoercer<string>(
      //   "string",
      //   (v) => typeof v === "string",
      //   (v) => v as string
      // );
      //
      // const result = stringCoercer.safeParse("hello");
      // assert.strictEqual(result.success, true);
      // if (result.success) {
      //   assert.strictEqual(result.value, "hello");
      // }
    });

    test("creates a coercer with safeParse that returns failure", async () => {
      // TODO: Implement test
      // const stringCoercer = createCoercer<string>(
      //   "string",
      //   (v) => typeof v === "string",
      //   (v) => v as string
      // );
      //
      // const result = stringCoercer.safeParse(123);
      // assert.strictEqual(result.success, false);
      // if (!result.success) {
      //   assert.ok(result.error.includes("Expected string"));
      // }
    });

    test("parse throws on failure", async () => {
      // TODO: Implement test
      // const stringCoercer = createCoercer<string>(
      //   "string",
      //   (v) => typeof v === "string",
      //   (v) => v as string
      // );
      //
      // assert.throws(() => stringCoercer.parse(123), TypeError);
    });

    test("is checks if value can be coerced", async () => {
      // TODO: Implement test
      // const stringCoercer = createCoercer<string>(
      //   "string",
      //   (v) => typeof v === "string",
      //   (v) => v as string
      // );
      //
      // assert.strictEqual(stringCoercer.is("hello"), true);
      // assert.strictEqual(stringCoercer.is(123), false);
    });

    test("or combines coercers", async () => {
      // TODO: Implement test
      // const stringCoercer = createCoercer<string>(
      //   "string",
      //   (v) => typeof v === "string",
      //   (v) => v as string
      // );
      // const numberCoercer = createCoercer<number>(
      //   "number",
      //   (v) => typeof v === "number",
      //   (v) => v as number
      // );
      //
      // const combined = stringCoercer.or(numberCoercer);
      //
      // assert.strictEqual(combined.is("hello"), true);
      // assert.strictEqual(combined.is(123), true);
      // assert.strictEqual(combined.is({}), false);
      //
      // assert.strictEqual(combined.parse("hello"), "hello");
      // assert.strictEqual(combined.parse(123), 123);
    });

    test("transform creates a new coercer with transformed output", async () => {
      // TODO: Implement test
      // const numberCoercer = createCoercer<number>(
      //   "number",
      //   (v) => typeof v === "number",
      //   (v) => v as number
      // );
      //
      // const doubled = numberCoercer.transform((n) => n * 2);
      //
      // assert.strictEqual(doubled.parse(5), 10);
    });

    test("optional allows undefined/null", async () => {
      // TODO: Implement test
      // const stringCoercer = createCoercer<string>(
      //   "string",
      //   (v) => typeof v === "string",
      //   (v) => v as string
      // );
      //
      // const optionalString = stringCoercer.optional();
      //
      // assert.strictEqual(optionalString.parse("hello"), "hello");
      // assert.strictEqual(optionalString.parse(undefined), undefined);
      // assert.strictEqual(optionalString.parse(null), undefined);
    });
  });

  describe("coerceURL", () => {
    test("coerces string to URL data", async () => {
      // TODO: Implement test
      // const result = coerceURL.parse("https://example.com/path?query=1#hash");
      // assert.strictEqual(result.href, "https://example.com/path?query=1#hash");
      // assert.strictEqual(result.protocol, "https:");
      // assert.strictEqual(result.host, "example.com");
      // assert.strictEqual(result.hostname, "example.com");
      // assert.strictEqual(result.pathname, "/path");
      // assert.strictEqual(result.search, "?query=1");
      // assert.strictEqual(result.hash, "#hash");
    });

    test("coerces URL-like object with href to URL data", async () => {
      // TODO: Implement test
      // const result = coerceURL.parse({ href: "https://example.com/test" });
      // assert.strictEqual(result.href, "https://example.com/test");
      // assert.strictEqual(result.pathname, "/test");
    });

    test("safeParse returns error for invalid input", async () => {
      // TODO: Implement test
      // const result = coerceURL.safeParse(123);
      // assert.strictEqual(result.success, false);
    });

    test("safeParse returns error for object without href", async () => {
      // TODO: Implement test
      // const result = coerceURL.safeParse({ foo: "bar" });
      // assert.strictEqual(result.success, false);
    });
  });

  describe("coerceToURLString", () => {
    test("extracts href from string URL", async () => {
      // TODO: Implement test
      // const result = coerceToURLString("https://example.com/path");
      // assert.strictEqual(result, "https://example.com/path");
    });

    test("extracts href from URL-like object", async () => {
      // TODO: Implement test
      // const result = coerceToURLString({ href: "https://example.com/test" });
      // assert.strictEqual(result, "https://example.com/test");
    });

    test("falls back to String() for invalid input", async () => {
      // TODO: Implement test
      // const result = coerceToURLString(123);
      // assert.strictEqual(result, "123");
    });
  });

  describe("coerceHeaders", () => {
    test("coerces plain object to Headers data", async () => {
      // TODO: Implement test
      // const result = coerceHeaders.parse({
      //   "Content-Type": "application/json",
      //   "X-Custom": "value",
      // });
      // assert.deepStrictEqual(result.headers.get("content-type"), ["application/json"]);
      // assert.deepStrictEqual(result.headers.get("x-custom"), ["value"]);
    });

    test("coerces array of pairs to Headers data", async () => {
      // TODO: Implement test
      // const result = coerceHeaders.parse([
      //   ["Content-Type", "text/plain"],
      //   ["Accept", "application/json"],
      // ]);
      // assert.deepStrictEqual(result.headers.get("content-type"), ["text/plain"]);
      // assert.deepStrictEqual(result.headers.get("accept"), ["application/json"]);
    });

    test("coerces null to empty headers", async () => {
      // TODO: Implement test
      // const result = coerceHeaders.parse(null);
      // assert.strictEqual(result.headers.size, 0);
    });

    test("coerces undefined to empty headers", async () => {
      // TODO: Implement test
      // const result = coerceHeaders.parse(undefined);
      // assert.strictEqual(result.headers.size, 0);
    });

    test("normalizes header names to lowercase", async () => {
      // TODO: Implement test
      // const result = coerceHeaders.parse({
      //   "Content-TYPE": "application/json",
      //   "X-CUSTOM-HEADER": "value",
      // });
      // assert.strictEqual(result.headers.has("content-type"), true);
      // assert.strictEqual(result.headers.has("x-custom-header"), true);
    });

    test("handles multiple values for same header", async () => {
      // TODO: Implement test
      // const result = coerceHeaders.parse([
      //   ["Set-Cookie", "a=1"],
      //   ["Set-Cookie", "b=2"],
      // ]);
      // assert.deepStrictEqual(result.headers.get("set-cookie"), ["a=1", "b=2"]);
    });

    test("skips internal defineClass properties", async () => {
      // TODO: Implement test
      // const result = coerceHeaders.parse({
      //   "Content-Type": "text/plain",
      //   __instanceId__: 123,
      //   __className__: "Headers",
      //   __isDefineClassInstance__: true,
      // });
      // assert.strictEqual(result.headers.has("__instanceid__"), false);
      // assert.strictEqual(result.headers.has("__classname__"), false);
      // assert.strictEqual(result.headers.has("__isdefineclassinstance__"), false);
      // assert.deepStrictEqual(result.headers.get("content-type"), ["text/plain"]);
    });

    test("coerces HeadersState shape", async () => {
      // TODO: Implement test
      // const headersMap = new Map<string, string[]>();
      // headersMap.set("content-type", ["application/json"]);
      //
      // const result = coerceHeaders.parse({ headers: headersMap });
      // assert.deepStrictEqual(result.headers.get("content-type"), ["application/json"]);
    });
  });

  describe("coerceBody", () => {
    test("returns null for null input", async () => {
      // TODO: Implement test
      // assert.strictEqual(coerceBody(null), null);
    });

    test("returns null for undefined input", async () => {
      // TODO: Implement test
      // assert.strictEqual(coerceBody(undefined), null);
    });

    test("encodes string to Uint8Array", async () => {
      // TODO: Implement test
      // const result = coerceBody("hello");
      // assert.ok(result instanceof Uint8Array);
      // assert.strictEqual(new TextDecoder().decode(result!), "hello");
    });

    test("converts ArrayBuffer to Uint8Array", async () => {
      // TODO: Implement test
      // const buffer = new ArrayBuffer(5);
      // const view = new Uint8Array(buffer);
      // view.set([1, 2, 3, 4, 5]);
      //
      // const result = coerceBody(buffer);
      // assert.ok(result instanceof Uint8Array);
      // assert.deepStrictEqual(Array.from(result!), [1, 2, 3, 4, 5]);
    });

    test("passes through Uint8Array", async () => {
      // TODO: Implement test
      // const input = new Uint8Array([1, 2, 3]);
      // const result = coerceBody(input);
      // assert.strictEqual(result, input);
    });
  });

  describe("coerceRequestInit", () => {
    test("returns empty object for null", async () => {
      // TODO: Implement test
      // const result = coerceRequestInit.parse(null);
      // assert.deepStrictEqual(result, {});
    });

    test("returns empty object for undefined", async () => {
      // TODO: Implement test
      // const result = coerceRequestInit.parse(undefined);
      // assert.deepStrictEqual(result, {});
    });

    test("extracts method from plain object", async () => {
      // TODO: Implement test
      // const result = coerceRequestInit.parse({ method: "post" });
      // assert.strictEqual(result.method, "POST");
    });

    test("extracts headers from plain object", async () => {
      // TODO: Implement test
      // const result = coerceRequestInit.parse({
      //   headers: { "Content-Type": "application/json" },
      // });
      // assert.deepStrictEqual(result.headersState?.headers.get("content-type"), [
      //   "application/json",
      // ]);
    });

    test("extracts body from plain object", async () => {
      // TODO: Implement test
      // const result = coerceRequestInit.parse({ body: "test body" });
      // assert.ok(result.body instanceof Uint8Array);
      // assert.strictEqual(new TextDecoder().decode(result.body!), "test body");
    });

    test("extracts multiple properties", async () => {
      // TODO: Implement test
      // const result = coerceRequestInit.parse({
      //   method: "PUT",
      //   cache: "no-cache",
      //   credentials: "include",
      //   mode: "cors",
      //   redirect: "follow",
      // });
      // assert.strictEqual(result.method, "PUT");
      // assert.strictEqual(result.cache, "no-cache");
      // assert.strictEqual(result.credentials, "include");
      // assert.strictEqual(result.mode, "cors");
      // assert.strictEqual(result.redirect, "follow");
    });
  });

  describe("coerceResponseInit", () => {
    test("returns empty object for null", async () => {
      // TODO: Implement test
      // const result = coerceResponseInit.parse(null);
      // assert.deepStrictEqual(result, {});
    });

    test("extracts status from plain object", async () => {
      // TODO: Implement test
      // const result = coerceResponseInit.parse({ status: 201 });
      // assert.strictEqual(result.status, 201);
    });

    test("extracts statusText from plain object", async () => {
      // TODO: Implement test
      // const result = coerceResponseInit.parse({ statusText: "Created" });
      // assert.strictEqual(result.statusText, "Created");
    });

    test("extracts headers from plain object", async () => {
      // TODO: Implement test
      // const result = coerceResponseInit.parse({
      //   headers: { "Content-Type": "application/json" },
      // });
      // assert.deepStrictEqual(result.headersState?.headers.get("content-type"), [
      //   "application/json",
      // ]);
    });
  });

  describe("classCoercer with isolate context", () => {
    let isolate: ivm.Isolate;
    let context: ivm.Context;

    beforeEach(async () => {
      isolate = new ivm.Isolate();
      context = await isolate.createContext();
    });

    afterEach(() => {
      context.release();
      isolate.dispose();
    });

    test("classCoercer extracts state from defineClass instance", async () => {
      // TODO: Implement test
      // interface PointState {
      //   x: number;
      //   y: number;
      // }
      //
      // const stateMap = createStateMap();
      // const PointClass = defineClass<PointState>(context, stateMap, {
      //   name: "Point",
      //   construct: (args) => ({
      //     x: Number(args[0] ?? 0),
      //     y: Number(args[1] ?? 0),
      //   }),
      // });
      // context.setProp(context.global, "Point", PointClass);
      // PointClass.dispose();
      //
      // const result = context.evalCode(`new Point(10, 20)`);
      // if (result.error) {
      //   result.error.dispose();
      //   throw new Error("Failed to create Point");
      // }
      //
      // const unmarshalled = unmarshal(context, result.value);
      // result.value.dispose();
      //
      // const pointCoercer = classCoercer<PointState>("Point");
      // const state = pointCoercer.parse(unmarshalled);
      //
      // assert.strictEqual(state.x, 10);
      // assert.strictEqual(state.y, 20);
    });

    test("classCoercer returns false for wrong class", async () => {
      // TODO: Implement test
      // interface PointState {
      //   x: number;
      //   y: number;
      // }
      //
      // const stateMap = createStateMap();
      // const PointClass = defineClass<PointState>(context, stateMap, {
      //   name: "Point",
      //   construct: (args) => ({
      //     x: Number(args[0] ?? 0),
      //     y: Number(args[1] ?? 0),
      //   }),
      // });
      // context.setProp(context.global, "Point", PointClass);
      // PointClass.dispose();
      //
      // const result = context.evalCode(`new Point(10, 20)`);
      // if (result.error) {
      //   result.error.dispose();
      //   throw new Error("Failed to create Point");
      // }
      //
      // const unmarshalled = unmarshal(context, result.value);
      // result.value.dispose();
      //
      // const rectangleCoercer = classCoercer("Rectangle");
      // assert.strictEqual(rectangleCoercer.is(unmarshalled), false);
    });
  });
});
