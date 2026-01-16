import { describe, it } from "node:test";
import assert from "node:assert";
import {
  marshalValue,
  marshalValueSync,
  unmarshalValue,
  MarshalError,
  type MarshalContext,
  type UnmarshalContext,
} from "./marshalValue.ts";

// Helper for sync round-trip
function roundTrip(value: unknown): unknown {
  const marshalled = marshalValueSync(value);
  return unmarshalValue(marshalled);
}

// Helper for async round-trip
async function roundTripAsync(value: unknown): Promise<unknown> {
  const marshalled = await marshalValue(value);
  return unmarshalValue(marshalled);
}

describe("marshalValue/unmarshalValue round-trip", () => {
  describe("primitives", () => {
    it("should handle string", () => {
      const result = roundTrip("hello");
      assert.strictEqual(result, "hello");
    });

    it("should handle number", () => {
      const result = roundTrip(42);
      assert.strictEqual(result, 42);
    });

    it("should handle float", () => {
      const result = roundTrip(3.14);
      assert.strictEqual(result, 3.14);
    });

    it("should handle boolean true", () => {
      const result = roundTrip(true);
      assert.strictEqual(result, true);
    });

    it("should handle boolean false", () => {
      const result = roundTrip(false);
      assert.strictEqual(result, false);
    });

    it("should handle null", () => {
      const result = roundTrip(null);
      assert.strictEqual(result, null);
    });

    it("should handle undefined", () => {
      const result = roundTrip(undefined);
      assert.strictEqual(result, undefined);
    });

    it("should handle bigint", () => {
      const result = roundTrip(123n);
      assert.strictEqual(result, 123n);
    });

    it("should handle large bigint", () => {
      const big = BigInt("9007199254740993"); // > Number.MAX_SAFE_INTEGER
      const result = roundTrip(big);
      assert.strictEqual(result, big);
    });
  });

  describe("complex types", () => {
    it("should handle Date", () => {
      const date = new Date("2024-01-15T12:00:00Z");
      const result = roundTrip(date) as Date;
      assert.ok(result instanceof Date);
      assert.strictEqual(result.getTime(), date.getTime());
    });

    it("should handle RegExp", () => {
      const regex = /test/gi;
      const result = roundTrip(regex) as RegExp;
      assert.ok(result instanceof RegExp);
      assert.strictEqual(result.source, "test");
      assert.strictEqual(result.flags, "gi");
    });

    it("should handle RegExp with complex pattern", () => {
      const regex = /^[a-z]+\d{2,4}$/im;
      const result = roundTrip(regex) as RegExp;
      assert.ok(result instanceof RegExp);
      assert.strictEqual(result.source, "^[a-z]+\\d{2,4}$");
      assert.strictEqual(result.flags, "im");
    });

    it("should handle URL", () => {
      const url = new URL("https://example.com/path?q=1#hash");
      const result = roundTrip(url) as URL;
      assert.ok(result instanceof URL);
      assert.strictEqual(result.href, "https://example.com/path?q=1#hash");
      assert.strictEqual(result.pathname, "/path");
      assert.strictEqual(result.search, "?q=1");
    });

    it("should handle Headers", () => {
      const headers = new Headers({
        "Content-Type": "application/json",
        "X-Custom": "value",
      });
      const result = roundTrip(headers) as Headers;
      assert.ok(result instanceof Headers);
      assert.strictEqual(result.get("content-type"), "application/json");
      assert.strictEqual(result.get("x-custom"), "value");
    });
  });

  describe("binary types", () => {
    it("should handle Uint8Array", () => {
      const arr = new Uint8Array([1, 2, 3, 4, 5]);
      const result = roundTrip(arr) as Uint8Array;
      assert.ok(result instanceof Uint8Array);
      assert.deepStrictEqual([...result], [1, 2, 3, 4, 5]);
    });

    it("should handle ArrayBuffer", () => {
      const buffer = new ArrayBuffer(8);
      const view = new Uint8Array(buffer);
      view.set([0, 1, 2, 3, 4, 5, 6, 7]);
      const result = roundTrip(buffer) as Uint8Array;
      // ArrayBuffer gets converted to Uint8Array
      assert.ok(result instanceof Uint8Array);
      assert.strictEqual(result.length, 8);
    });
  });

  describe("containers", () => {
    it("should handle nested object", () => {
      const obj = { a: { b: { c: 1 } } };
      const result = roundTrip(obj);
      assert.deepStrictEqual(result, { a: { b: { c: 1 } } });
    });

    it("should handle array", () => {
      const arr = [1, "two", { three: 3 }];
      const result = roundTrip(arr);
      assert.deepStrictEqual(result, [1, "two", { three: 3 }]);
    });

    it("should handle mixed nested structures", () => {
      const date = new Date("2024-01-01");
      const obj = {
        primitives: {
          str: "hello",
          num: 42,
          bool: true,
          nil: null,
          undef: undefined,
          big: 123n,
        },
        complex: {
          date,
          regex: /test/gi,
          url: new URL("https://example.com"),
        },
        arrays: [[1, 2], ["a", "b"]],
      };
      const result = roundTrip(obj) as typeof obj;
      assert.strictEqual(result.primitives.str, "hello");
      assert.strictEqual(result.primitives.num, 42);
      assert.strictEqual(result.primitives.bool, true);
      assert.strictEqual(result.primitives.nil, null);
      assert.strictEqual(result.primitives.undef, undefined);
      assert.strictEqual(result.primitives.big, 123n);
      assert.ok(result.complex.date instanceof Date);
      assert.strictEqual(result.complex.date.getTime(), date.getTime());
      assert.ok(result.complex.regex instanceof RegExp);
      assert.ok(result.complex.url instanceof URL);
      assert.deepStrictEqual(result.arrays, [[1, 2], ["a", "b"]]);
    });
  });

  describe("async types - Request/Response/File/Blob/FormData", () => {
    it("should handle Request", async () => {
      const req = new Request("https://example.com/api", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: "value" }),
      });
      const result = (await roundTripAsync(req)) as Request;
      assert.ok(result instanceof Request);
      assert.strictEqual(result.url, "https://example.com/api");
      assert.strictEqual(result.method, "POST");
      assert.strictEqual(result.headers.get("content-type"), "application/json");
      const body = await result.json();
      assert.deepStrictEqual(body, { key: "value" });
    });

    it("should handle Request without body", async () => {
      const req = new Request("https://example.com");
      const result = (await roundTripAsync(req)) as Request;
      assert.ok(result instanceof Request);
      assert.strictEqual(result.url, "https://example.com/");
      assert.strictEqual(result.method, "GET");
    });

    it("should handle Response", async () => {
      const res = new Response(JSON.stringify({ data: "test" }), {
        status: 201,
        statusText: "Created",
        headers: { "X-Test": "value" },
      });
      const result = (await roundTripAsync(res)) as Response;
      assert.ok(result instanceof Response);
      assert.strictEqual(result.status, 201);
      assert.strictEqual(result.statusText, "Created");
      assert.strictEqual(result.headers.get("x-test"), "value");
      const body = await result.json();
      assert.deepStrictEqual(body, { data: "test" });
    });

    it("should handle File", async () => {
      const file = new File(["file content"], "test.txt", {
        type: "text/plain",
        lastModified: 1704067200000,
      });
      const result = (await roundTripAsync(file)) as File;
      assert.ok(result instanceof File);
      assert.strictEqual(result.name, "test.txt");
      assert.strictEqual(result.type, "text/plain");
      assert.strictEqual(result.lastModified, 1704067200000);
      const text = await result.text();
      assert.strictEqual(text, "file content");
    });

    it("should handle Blob", async () => {
      const blob = new Blob(["blob data"], { type: "text/plain" });
      const result = (await roundTripAsync(blob)) as Blob;
      assert.ok(result instanceof Blob);
      assert.strictEqual(result.type, "text/plain");
      const text = await result.text();
      assert.strictEqual(text, "blob data");
    });

    it("should handle FormData with string entries", async () => {
      const fd = new FormData();
      fd.append("name", "John");
      fd.append("email", "john@example.com");
      const result = (await roundTripAsync(fd)) as FormData;
      assert.ok(result instanceof FormData);
      assert.strictEqual(result.get("name"), "John");
      assert.strictEqual(result.get("email"), "john@example.com");
    });

    it("should handle FormData with File entries", async () => {
      const fd = new FormData();
      fd.append("key", "value");
      fd.append("file", new File(["content"], "upload.txt", { type: "text/plain" }));
      const result = (await roundTripAsync(fd)) as FormData;
      assert.ok(result instanceof FormData);
      assert.strictEqual(result.get("key"), "value");
      const file = result.get("file") as File;
      assert.ok(file instanceof File);
      assert.strictEqual(file.name, "upload.txt");
      const text = await file.text();
      assert.strictEqual(text, "content");
    });
  });
});

describe("callback registration", () => {
  it("should marshal function to CallbackRef", () => {
    const callbacks = new Map<number, Function>();
    let nextId = 1;
    const ctx: MarshalContext = {
      registerCallback: (fn) => {
        const id = nextId++;
        callbacks.set(id, fn);
        return id;
      },
    };
    const fn = (x: number) => x * 2;
    const result = marshalValueSync(fn, ctx) as { __type: string; callbackId: number };
    assert.deepStrictEqual(result, { __type: "CallbackRef", callbackId: 1 });
    assert.strictEqual(callbacks.get(1)?.(5), 10);
  });

  it("should unmarshal CallbackRef to function", () => {
    const mockCallback = (a: number, b: number) => a + b;
    const ctx: UnmarshalContext = {
      getCallback: (id) => (id === 1 ? mockCallback as (...args: unknown[]) => unknown : undefined),
    };
    const ref = { __type: "CallbackRef", callbackId: 1 };
    const result = unmarshalValue(ref, ctx) as Function;
    assert.strictEqual(typeof result, "function");
    assert.strictEqual(result(2, 3), 5);
  });
});

describe("Promise/AsyncIterator refs", () => {
  it("should marshal Promise to PromiseRef", async () => {
    const promises = new Map<number, Promise<unknown>>();
    let nextId = 1;
    const ctx: MarshalContext = {
      registerPromise: (p) => {
        const id = nextId++;
        promises.set(id, p);
        return id;
      },
    };
    const promise = Promise.resolve(42);
    const result = (await marshalValue(promise, ctx)) as { __type: string; promiseId: number };
    assert.deepStrictEqual(result, { __type: "PromiseRef", promiseId: 1 });
  });

  it("should marshal AsyncIterable to AsyncIteratorRef", async () => {
    const iterators = new Map<number, AsyncIterator<unknown>>();
    let nextId = 1;
    const ctx: MarshalContext = {
      registerIterator: (it) => {
        const id = nextId++;
        iterators.set(id, it);
        return id;
      },
    };
    async function* gen() {
      yield 1;
      yield 2;
    }
    const result = (await marshalValue(gen(), ctx)) as { __type: string; iteratorId: number };
    assert.deepStrictEqual(result, { __type: "AsyncIteratorRef", iteratorId: 1 });
  });
});

describe("error cases", () => {
  it("should throw on unsupported class instance", () => {
    class CustomClass {
      value = 42;
    }
    assert.throws(
      () => marshalValueSync(new CustomClass()),
      (err: Error) => {
        assert.ok(err instanceof MarshalError);
        assert.ok(err.message.includes("Cannot marshal class instance"));
        assert.ok(err.message.includes("CustomClass"));
        return true;
      }
    );
  });

  it("should throw on circular reference", () => {
    const obj: Record<string, unknown> = { a: 1 };
    obj.self = obj;
    assert.throws(
      () => marshalValueSync(obj),
      (err: Error) => {
        assert.ok(err instanceof MarshalError);
        assert.ok(err.message.toLowerCase().includes("circular"));
        return true;
      }
    );
  });

  it("should throw on Symbol", () => {
    const sym = Symbol("test");
    assert.throws(
      () => marshalValueSync(sym),
      (err: Error) => {
        assert.ok(err instanceof MarshalError);
        assert.ok(err.message.includes("Symbol"));
        return true;
      }
    );
  });

  it("should throw on function without context", () => {
    assert.throws(
      () => marshalValueSync(() => {}),
      (err: Error) => {
        assert.ok(err instanceof MarshalError);
        assert.ok(err.message.includes("registerCallback"));
        return true;
      }
    );
  });

  it("should throw on Promise without context", async () => {
    await assert.rejects(
      async () => marshalValue(Promise.resolve(42)),
      (err: Error) => {
        assert.ok(err instanceof MarshalError);
        assert.ok(err.message.includes("registerPromise"));
        return true;
      }
    );
  });

  it("should throw when unmarshalling CallbackRef without context", () => {
    const ref = { __type: "CallbackRef", callbackId: 1 };
    assert.throws(
      () => unmarshalValue(ref),
      (err: Error) => {
        assert.ok(err instanceof MarshalError);
        assert.ok(err.message.includes("getCallback"));
        return true;
      }
    );
  });

  it("should throw on Request with marshalValueSync", () => {
    const req = new Request("https://example.com");
    assert.throws(
      () => marshalValueSync(req),
      (err: Error) => {
        assert.ok(err instanceof MarshalError);
        assert.ok(err.message.includes("Request"));
        return true;
      }
    );
  });

  it("should throw on Response with marshalValueSync", () => {
    const res = new Response("body");
    assert.throws(
      () => marshalValueSync(res),
      (err: Error) => {
        assert.ok(err instanceof MarshalError);
        assert.ok(err.message.includes("Response"));
        return true;
      }
    );
  });
});

describe("depth limit", () => {
  it("should throw on deeply nested objects", () => {
    let obj: Record<string, unknown> = { value: "leaf" };
    for (let i = 0; i < 150; i++) {
      obj = { nested: obj };
    }
    assert.throws(
      () => marshalValueSync(obj),
      (err: Error) => {
        assert.ok(err instanceof MarshalError);
        assert.ok(err.message.includes("depth"));
        return true;
      }
    );
  });
});
