import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import ivm from "isolated-vm";
import { setupCore, clearAllInstanceState, cleanupUnmarshaledHandles } from "./index.ts";

describe("structuredClone", () => {
  let isolate: ivm.Isolate;
  let context: ivm.Context;

  beforeEach(async () => {
    isolate = new ivm.Isolate();
    context = await isolate.createContext();
    await setupCore(context);
    clearAllInstanceState();
  });

  afterEach(() => {
    cleanupUnmarshaledHandles(context);
    context.release();
    isolate.dispose();
  });

  describe("primitives", () => {
    test("clones null", async () => {
      const result = await context.eval(`structuredClone(null)`);
      assert.strictEqual(result, null);
    });

    test("clones undefined", async () => {
      const result = await context.eval(`structuredClone(undefined)`);
      assert.strictEqual(result, undefined);
    });

    test("clones string", async () => {
      const result = await context.eval(`structuredClone("hello")`);
      assert.strictEqual(result, "hello");
    });

    test("clones number", async () => {
      const result = await context.eval(`structuredClone(42)`);
      assert.strictEqual(result, 42);
    });

    test("clones negative number", async () => {
      const result = await context.eval(`structuredClone(-3.14)`);
      assert.strictEqual(result, -3.14);
    });

    test("clones boolean true", async () => {
      const result = await context.eval(`structuredClone(true)`);
      assert.strictEqual(result, true);
    });

    test("clones boolean false", async () => {
      const result = await context.eval(`structuredClone(false)`);
      assert.strictEqual(result, false);
    });

    test("clones bigint", async () => {
      const result = await context.eval(`structuredClone(BigInt(9007199254740991)).toString()`);
      assert.strictEqual(result, "9007199254740991");
    });
  });

  describe("objects", () => {
    test("clones plain object", async () => {
      const result = await context.eval(`
        const obj = { a: 1, b: "hello" };
        const cloned = structuredClone(obj);
        JSON.stringify({ same: obj === cloned, a: cloned.a, b: cloned.b })
      `);
      const data = JSON.parse(result as string);
      assert.strictEqual(data.same, false);
      assert.strictEqual(data.a, 1);
      assert.strictEqual(data.b, "hello");
    });

    test("clones nested object", async () => {
      const result = await context.eval(`
        const obj = { a: { b: { c: 42 } } };
        const cloned = structuredClone(obj);
        JSON.stringify({
          same: obj === cloned,
          nestedSame: obj.a === cloned.a,
          deepSame: obj.a.b === cloned.a.b,
          value: cloned.a.b.c
        })
      `);
      const data = JSON.parse(result as string);
      assert.strictEqual(data.same, false);
      assert.strictEqual(data.nestedSame, false);
      assert.strictEqual(data.deepSame, false);
      assert.strictEqual(data.value, 42);
    });

    test("clones object with mixed types", async () => {
      const result = await context.eval(`
        const obj = { str: "test", num: 123, bool: true, nil: null };
        const cloned = structuredClone(obj);
        JSON.stringify(cloned)
      `);
      const data = JSON.parse(result as string);
      assert.deepStrictEqual(data, { str: "test", num: 123, bool: true, nil: null });
    });
  });

  describe("arrays", () => {
    test("clones array", async () => {
      const result = await context.eval(`
        const arr = [1, 2, 3];
        const cloned = structuredClone(arr);
        JSON.stringify({ same: arr === cloned, values: cloned })
      `);
      const data = JSON.parse(result as string);
      assert.strictEqual(data.same, false);
      assert.deepStrictEqual(data.values, [1, 2, 3]);
    });

    test("clones nested array", async () => {
      const result = await context.eval(`
        const arr = [1, [2, [3]]];
        const cloned = structuredClone(arr);
        JSON.stringify({
          same: arr === cloned,
          innerSame: arr[1] === cloned[1],
          values: cloned
        })
      `);
      const data = JSON.parse(result as string);
      assert.strictEqual(data.same, false);
      assert.strictEqual(data.innerSame, false);
      assert.deepStrictEqual(data.values, [1, [2, [3]]]);
    });

    test("preserves sparse arrays", async () => {
      const result = await context.eval(`
        const arr = [1, , , 4];
        const cloned = structuredClone(arr);
        JSON.stringify({
          length: cloned.length,
          has1: 1 in cloned,
          has2: 2 in cloned,
          values: [cloned[0], cloned[3]]
        })
      `);
      const data = JSON.parse(result as string);
      assert.strictEqual(data.length, 4);
      assert.strictEqual(data.has1, false);
      assert.strictEqual(data.has2, false);
      assert.deepStrictEqual(data.values, [1, 4]);
    });
  });

  describe("Date", () => {
    test("clones Date", async () => {
      const result = await context.eval(`
        const date = new Date("2024-01-15T12:00:00Z");
        const cloned = structuredClone(date);
        JSON.stringify({
          same: date === cloned,
          isDate: cloned instanceof Date,
          time: cloned.getTime()
        })
      `);
      const data = JSON.parse(result as string);
      assert.strictEqual(data.same, false);
      assert.strictEqual(data.isDate, true);
      assert.strictEqual(data.time, new Date("2024-01-15T12:00:00Z").getTime());
    });
  });

  describe("RegExp", () => {
    test("clones RegExp", async () => {
      const result = await context.eval(`
        const regex = /test/gi;
        const cloned = structuredClone(regex);
        JSON.stringify({
          same: regex === cloned,
          isRegExp: cloned instanceof RegExp,
          source: cloned.source,
          flags: cloned.flags
        })
      `);
      const data = JSON.parse(result as string);
      assert.strictEqual(data.same, false);
      assert.strictEqual(data.isRegExp, true);
      assert.strictEqual(data.source, "test");
      assert.strictEqual(data.flags, "gi");
    });

    test("clones RegExp with special characters", async () => {
      const result = await context.eval(`
        const regex = /^[a-z]+\\d*$/m;
        const cloned = structuredClone(regex);
        JSON.stringify({ source: cloned.source, flags: cloned.flags })
      `);
      const data = JSON.parse(result as string);
      assert.strictEqual(data.source, "^[a-z]+\\d*$");
      assert.strictEqual(data.flags, "m");
    });
  });

  describe("Error", () => {
    test("clones Error", async () => {
      const result = await context.eval(`
        const error = new Error("test message");
        const cloned = structuredClone(error);
        JSON.stringify({
          same: error === cloned,
          isError: cloned instanceof Error,
          message: cloned.message,
          name: cloned.name
        })
      `);
      const data = JSON.parse(result as string);
      assert.strictEqual(data.same, false);
      assert.strictEqual(data.isError, true);
      assert.strictEqual(data.message, "test message");
      assert.strictEqual(data.name, "Error");
    });

    test("clones TypeError", async () => {
      const result = await context.eval(`
        const error = new TypeError("type error");
        const cloned = structuredClone(error);
        JSON.stringify({
          isTypeError: cloned instanceof TypeError,
          message: cloned.message,
          name: cloned.name
        })
      `);
      const data = JSON.parse(result as string);
      assert.strictEqual(data.isTypeError, true);
      assert.strictEqual(data.message, "type error");
      assert.strictEqual(data.name, "TypeError");
    });

    test("clones RangeError", async () => {
      const result = await context.eval(`
        const error = new RangeError("range error");
        const cloned = structuredClone(error);
        JSON.stringify({
          isRangeError: cloned instanceof RangeError,
          message: cloned.message
        })
      `);
      const data = JSON.parse(result as string);
      assert.strictEqual(data.isRangeError, true);
      assert.strictEqual(data.message, "range error");
    });

    test("clones Error with cause", async () => {
      const result = await context.eval(`
        const cause = new Error("cause error");
        const error = new Error("main error", { cause });
        const cloned = structuredClone(error);
        JSON.stringify({
          message: cloned.message,
          hasCause: cloned.cause !== undefined,
          causeSame: error.cause === cloned.cause,
          causeMessage: cloned.cause?.message
        })
      `);
      const data = JSON.parse(result as string);
      assert.strictEqual(data.message, "main error");
      assert.strictEqual(data.hasCause, true);
      assert.strictEqual(data.causeSame, false);
      assert.strictEqual(data.causeMessage, "cause error");
    });
  });

  describe("ArrayBuffer", () => {
    test("clones ArrayBuffer", async () => {
      const result = await context.eval(`
        const buffer = new ArrayBuffer(8);
        const view = new Uint8Array(buffer);
        view[0] = 1; view[1] = 2; view[2] = 3;
        const cloned = structuredClone(buffer);
        const clonedView = new Uint8Array(cloned);
        JSON.stringify({
          same: buffer === cloned,
          isArrayBuffer: cloned instanceof ArrayBuffer,
          length: cloned.byteLength,
          values: [clonedView[0], clonedView[1], clonedView[2]]
        })
      `);
      const data = JSON.parse(result as string);
      assert.strictEqual(data.same, false);
      assert.strictEqual(data.isArrayBuffer, true);
      assert.strictEqual(data.length, 8);
      assert.deepStrictEqual(data.values, [1, 2, 3]);
    });
  });

  describe("TypedArrays", () => {
    test("clones Uint8Array", async () => {
      const result = await context.eval(`
        const arr = new Uint8Array([1, 2, 3, 4]);
        const cloned = structuredClone(arr);
        JSON.stringify({
          same: arr === cloned,
          bufferSame: arr.buffer === cloned.buffer,
          isUint8Array: cloned instanceof Uint8Array,
          values: Array.from(cloned)
        })
      `);
      const data = JSON.parse(result as string);
      assert.strictEqual(data.same, false);
      assert.strictEqual(data.bufferSame, false);
      assert.strictEqual(data.isUint8Array, true);
      assert.deepStrictEqual(data.values, [1, 2, 3, 4]);
    });

    test("clones Int32Array", async () => {
      const result = await context.eval(`
        const arr = new Int32Array([-1, 0, 1, 2147483647]);
        const cloned = structuredClone(arr);
        JSON.stringify({
          isInt32Array: cloned instanceof Int32Array,
          values: Array.from(cloned)
        })
      `);
      const data = JSON.parse(result as string);
      assert.strictEqual(data.isInt32Array, true);
      assert.deepStrictEqual(data.values, [-1, 0, 1, 2147483647]);
    });

    test("clones Float64Array", async () => {
      const result = await context.eval(`
        const arr = new Float64Array([1.5, 2.5, 3.14159]);
        const cloned = structuredClone(arr);
        JSON.stringify({
          isFloat64Array: cloned instanceof Float64Array,
          values: Array.from(cloned)
        })
      `);
      const data = JSON.parse(result as string);
      assert.strictEqual(data.isFloat64Array, true);
      assert.deepStrictEqual(data.values, [1.5, 2.5, 3.14159]);
    });
  });

  describe("DataView", () => {
    test("clones DataView", async () => {
      const result = await context.eval(`
        const buffer = new ArrayBuffer(8);
        const view = new DataView(buffer);
        view.setInt32(0, 42);
        const cloned = structuredClone(view);
        JSON.stringify({
          same: view === cloned,
          bufferSame: view.buffer === cloned.buffer,
          isDataView: cloned instanceof DataView,
          byteLength: cloned.byteLength,
          value: cloned.getInt32(0)
        })
      `);
      const data = JSON.parse(result as string);
      assert.strictEqual(data.same, false);
      assert.strictEqual(data.bufferSame, false);
      assert.strictEqual(data.isDataView, true);
      assert.strictEqual(data.byteLength, 8);
      assert.strictEqual(data.value, 42);
    });
  });

  describe("Map", () => {
    test("clones Map", async () => {
      const result = await context.eval(`
        const map = new Map([["a", 1], ["b", 2]]);
        const cloned = structuredClone(map);
        JSON.stringify({
          same: map === cloned,
          isMap: cloned instanceof Map,
          size: cloned.size,
          a: cloned.get("a"),
          b: cloned.get("b")
        })
      `);
      const data = JSON.parse(result as string);
      assert.strictEqual(data.same, false);
      assert.strictEqual(data.isMap, true);
      assert.strictEqual(data.size, 2);
      assert.strictEqual(data.a, 1);
      assert.strictEqual(data.b, 2);
    });

    test("clones Map with object values", async () => {
      const result = await context.eval(`
        const obj = { x: 1 };
        const map = new Map([["key", obj]]);
        const cloned = structuredClone(map);
        const clonedObj = cloned.get("key");
        JSON.stringify({
          valueSame: obj === clonedObj,
          x: clonedObj.x
        })
      `);
      const data = JSON.parse(result as string);
      assert.strictEqual(data.valueSame, false);
      assert.strictEqual(data.x, 1);
    });
  });

  describe("Set", () => {
    test("clones Set", async () => {
      const result = await context.eval(`
        const set = new Set([1, 2, 3]);
        const cloned = structuredClone(set);
        JSON.stringify({
          same: set === cloned,
          isSet: cloned instanceof Set,
          size: cloned.size,
          has1: cloned.has(1),
          has2: cloned.has(2),
          has3: cloned.has(3)
        })
      `);
      const data = JSON.parse(result as string);
      assert.strictEqual(data.same, false);
      assert.strictEqual(data.isSet, true);
      assert.strictEqual(data.size, 3);
      assert.strictEqual(data.has1, true);
      assert.strictEqual(data.has2, true);
      assert.strictEqual(data.has3, true);
    });

    test("clones Set with object values", async () => {
      const result = await context.eval(`
        const obj = { x: 1 };
        const set = new Set([obj]);
        const cloned = structuredClone(set);
        const clonedValues = Array.from(cloned);
        JSON.stringify({
          valueSame: obj === clonedValues[0],
          x: clonedValues[0].x
        })
      `);
      const data = JSON.parse(result as string);
      assert.strictEqual(data.valueSame, false);
      assert.strictEqual(data.x, 1);
    });
  });

  describe("circular references", () => {
    test("handles self-referencing object", async () => {
      const result = await context.eval(`
        const obj = { name: "test" };
        obj.self = obj;
        const cloned = structuredClone(obj);
        JSON.stringify({
          same: obj === cloned,
          selfSame: cloned.self === cloned,
          name: cloned.name
        })
      `);
      const data = JSON.parse(result as string);
      assert.strictEqual(data.same, false);
      assert.strictEqual(data.selfSame, true);
      assert.strictEqual(data.name, "test");
    });

    test("handles circular reference in nested object", async () => {
      const result = await context.eval(`
        const a = { name: "a" };
        const b = { name: "b", ref: a };
        a.ref = b;
        const cloned = structuredClone(a);
        JSON.stringify({
          aName: cloned.name,
          bName: cloned.ref.name,
          circular: cloned.ref.ref === cloned
        })
      `);
      const data = JSON.parse(result as string);
      assert.strictEqual(data.aName, "a");
      assert.strictEqual(data.bName, "b");
      assert.strictEqual(data.circular, true);
    });

    test("handles circular reference in array", async () => {
      const result = await context.eval(`
        const arr = [1, 2];
        arr.push(arr);
        const cloned = structuredClone(arr);
        JSON.stringify({
          same: arr === cloned,
          selfRef: cloned[2] === cloned,
          values: [cloned[0], cloned[1]]
        })
      `);
      const data = JSON.parse(result as string);
      assert.strictEqual(data.same, false);
      assert.strictEqual(data.selfRef, true);
      assert.deepStrictEqual(data.values, [1, 2]);
    });

    test("handles circular reference in Map", async () => {
      const result = await context.eval(`
        const map = new Map();
        map.set("self", map);
        const cloned = structuredClone(map);
        JSON.stringify({
          same: map === cloned,
          selfRef: cloned.get("self") === cloned
        })
      `);
      const data = JSON.parse(result as string);
      assert.strictEqual(data.same, false);
      assert.strictEqual(data.selfRef, true);
    });

    test("handles circular reference in Set", async () => {
      const result = await context.eval(`
        const set = new Set();
        set.add(set);
        const cloned = structuredClone(set);
        const values = Array.from(cloned);
        JSON.stringify({
          same: set === cloned,
          selfRef: values[0] === cloned
        })
      `);
      const data = JSON.parse(result as string);
      assert.strictEqual(data.same, false);
      assert.strictEqual(data.selfRef, true);
    });
  });

  describe("non-cloneable types (throws DataCloneError)", () => {
    test("throws for Function", async () => {
      const result = await context.eval(`
        try {
          structuredClone(function() {});
          "no error";
        } catch (e) {
          JSON.stringify({ name: e.name, isDOMException: e instanceof DOMException })
        }
      `);
      const data = JSON.parse(result as string);
      assert.strictEqual(data.name, "DataCloneError");
      assert.strictEqual(data.isDOMException, true);
    });

    test("throws for arrow function", async () => {
      const result = await context.eval(`
        try {
          structuredClone(() => {});
          "no error";
        } catch (e) {
          e.name
        }
      `);
      assert.strictEqual(result, "DataCloneError");
    });

    test("throws for Symbol", async () => {
      const result = await context.eval(`
        try {
          structuredClone(Symbol("test"));
          "no error";
        } catch (e) {
          e.name
        }
      `);
      assert.strictEqual(result, "DataCloneError");
    });

    test("throws for WeakMap", async () => {
      const result = await context.eval(`
        try {
          structuredClone(new WeakMap());
          "no error";
        } catch (e) {
          e.name
        }
      `);
      assert.strictEqual(result, "DataCloneError");
    });

    test("throws for WeakSet", async () => {
      const result = await context.eval(`
        try {
          structuredClone(new WeakSet());
          "no error";
        } catch (e) {
          e.name
        }
      `);
      assert.strictEqual(result, "DataCloneError");
    });

    test("throws for nested function in object", async () => {
      const result = await context.eval(`
        try {
          structuredClone({ fn: () => {} });
          "no error";
        } catch (e) {
          e.name
        }
      `);
      assert.strictEqual(result, "DataCloneError");
    });

    test("throws for function in array", async () => {
      const result = await context.eval(`
        try {
          structuredClone([1, function() {}, 3]);
          "no error";
        } catch (e) {
          e.name
        }
      `);
      assert.strictEqual(result, "DataCloneError");
    });
  });

  describe("complex nested structures", () => {
    test("clones object with multiple types", async () => {
      const result = await context.eval(`
        const original = {
          str: "hello",
          num: 42,
          bool: true,
          nil: null,
          arr: [1, 2, 3],
          nested: { a: { b: 1 } },
          date: new Date("2024-01-01"),
          regex: /test/g,
          map: new Map([["x", 1]]),
          set: new Set([1, 2])
        };
        const cloned = structuredClone(original);
        JSON.stringify({
          str: cloned.str,
          num: cloned.num,
          bool: cloned.bool,
          nil: cloned.nil,
          arr: cloned.arr,
          nestedB: cloned.nested.a.b,
          dateTime: cloned.date.getTime(),
          regexSource: cloned.regex.source,
          mapX: cloned.map.get("x"),
          setHas1: cloned.set.has(1)
        })
      `);
      const data = JSON.parse(result as string);
      assert.strictEqual(data.str, "hello");
      assert.strictEqual(data.num, 42);
      assert.strictEqual(data.bool, true);
      assert.strictEqual(data.nil, null);
      assert.deepStrictEqual(data.arr, [1, 2, 3]);
      assert.strictEqual(data.nestedB, 1);
      assert.strictEqual(data.dateTime, new Date("2024-01-01").getTime());
      assert.strictEqual(data.regexSource, "test");
      assert.strictEqual(data.mapX, 1);
      assert.strictEqual(data.setHas1, true);
    });

    test("clones array of objects", async () => {
      const result = await context.eval(`
        const original = [
          { id: 1, name: "a" },
          { id: 2, name: "b" }
        ];
        const cloned = structuredClone(original);
        JSON.stringify({
          same: original === cloned,
          item0Same: original[0] === cloned[0],
          values: cloned
        })
      `);
      const data = JSON.parse(result as string);
      assert.strictEqual(data.same, false);
      assert.strictEqual(data.item0Same, false);
      assert.deepStrictEqual(data.values, [{ id: 1, name: "a" }, { id: 2, name: "b" }]);
    });
  });

  describe("structuredClone is a global", () => {
    test("structuredClone is defined on globalThis", async () => {
      const result = await context.eval(`typeof globalThis.structuredClone`);
      assert.strictEqual(result, "function");
    });

    test("structuredClone is a function", async () => {
      const result = await context.eval(`typeof structuredClone`);
      assert.strictEqual(result, "function");
    });
  });
});
