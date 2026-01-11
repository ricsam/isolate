import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import ivm from "isolated-vm";
import { setupCore, clearAllInstanceState, cleanupUnmarshaledHandles } from "./index.ts";

describe("TextEncoder", () => {
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

  describe("constructor", () => {
    test("creates encoder with default utf-8 encoding", async () => {
      // TODO: Implement test
      // const result = await context.eval(`new TextEncoder().encoding`);
      // assert.strictEqual(result, "utf-8");
    });

    test("accepts utf-8 encoding explicitly", async () => {
      // TODO: Implement test
      // const result = await context.eval(`new TextEncoder("utf-8").encoding`);
      // assert.strictEqual(result, "utf-8");
    });

    test("throws RangeError for invalid encoding", async () => {
      // TODO: Implement test
      // const result = await context.eval(`
      //   try {
      //     new TextEncoder("latin1");
      //     "no error";
      //   } catch (e) {
      //     e.name;
      //   }
      // `);
      // assert.strictEqual(result, "RangeError");
    });
  });

  describe("encode()", () => {
    test("encodes ASCII string", async () => {
      // TODO: Implement test
      // const result = await context.eval(`
      //   Array.from(new TextEncoder().encode("hello"))
      // `);
      // assert.deepStrictEqual(result, [104, 101, 108, 108, 111]);
    });

    test("encodes UTF-8 2-byte character", async () => {
      // TODO: Implement test
      // const result = await context.eval(`
      //   Array.from(new TextEncoder().encode("é"))
      // `);
      // assert.deepStrictEqual(result, [0xC3, 0xA9]);
    });

    test("encodes UTF-8 3-byte character (Chinese)", async () => {
      // TODO: Implement test
      // const result = await context.eval(`
      //   Array.from(new TextEncoder().encode("中"))
      // `);
      // assert.deepStrictEqual(result, [0xE4, 0xB8, 0xAD]);
    });

    test("encodes emoji (4-byte surrogate pair)", async () => {
      // TODO: Implement test
      // const result = await context.eval(`
      //   Array.from(new TextEncoder().encode("😀"))
      // `);
      // assert.deepStrictEqual(result, [0xF0, 0x9F, 0x98, 0x80]);
    });

    test("returns Uint8Array", async () => {
      // TODO: Implement test
      // const result = await context.eval(`
      //   new TextEncoder().encode("test") instanceof Uint8Array
      // `);
      // assert.strictEqual(result, true);
    });

    test("returns empty Uint8Array for empty string", async () => {
      // TODO: Implement test
      // const result = await context.eval(`
      //   new TextEncoder().encode("").length
      // `);
      // assert.strictEqual(result, 0);
    });
  });

  describe("encodeInto()", () => {
    test("encodes into existing array", async () => {
      // TODO: Implement test
      // const result = await context.eval(`
      //   const dest = new Uint8Array(10);
      //   const { read, written } = new TextEncoder().encodeInto("hi", dest);
      //   JSON.stringify({ read, written, bytes: Array.from(dest.slice(0, written)) })
      // `);
      // const data = JSON.parse(result as string);
      // assert.strictEqual(data.read, 2);
      // assert.strictEqual(data.written, 2);
      // assert.deepStrictEqual(data.bytes, [104, 105]);
    });
  });
});

describe("TextDecoder", () => {
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

  describe("constructor", () => {
    test("creates decoder with default utf-8 encoding", async () => {
      // TODO: Implement test
      // const result = await context.eval(`new TextDecoder().encoding`);
      // assert.strictEqual(result, "utf-8");
    });

    test("throws RangeError for invalid encoding", async () => {
      // TODO: Implement test
      // const result = await context.eval(`
      //   try {
      //     new TextDecoder("latin1");
      //     "no error";
      //   } catch (e) {
      //     e.name;
      //   }
      // `);
      // assert.strictEqual(result, "RangeError");
    });

    test("has fatal property", async () => {
      // TODO: Implement test
      // const result = await context.eval(`
      //   new TextDecoder("utf-8", { fatal: true }).fatal
      // `);
      // assert.strictEqual(result, true);
    });

    test("has ignoreBOM property", async () => {
      // TODO: Implement test
      // const result = await context.eval(`
      //   new TextDecoder("utf-8", { ignoreBOM: true }).ignoreBOM
      // `);
      // assert.strictEqual(result, true);
    });
  });

  describe("decode()", () => {
    test("decodes ASCII bytes", async () => {
      // TODO: Implement test
      // const result = await context.eval(`
      //   new TextDecoder().decode(new Uint8Array([104, 101, 108, 108, 111]))
      // `);
      // assert.strictEqual(result, "hello");
    });

    test("decodes UTF-8 2-byte character", async () => {
      // TODO: Implement test
      // const result = await context.eval(`
      //   new TextDecoder().decode(new Uint8Array([0xC3, 0xA9]))
      // `);
      // assert.strictEqual(result, "é");
    });

    test("decodes UTF-8 3-byte character", async () => {
      // TODO: Implement test
      // const result = await context.eval(`
      //   new TextDecoder().decode(new Uint8Array([0xE4, 0xB8, 0xAD]))
      // `);
      // assert.strictEqual(result, "中");
    });

    test("decodes emoji (4-byte)", async () => {
      // TODO: Implement test
      // const result = await context.eval(`
      //   new TextDecoder().decode(new Uint8Array([0xF0, 0x9F, 0x98, 0x80]))
      // `);
      // assert.strictEqual(result, "😀");
    });

    test("returns empty string for empty input", async () => {
      // TODO: Implement test
      // const result = await context.eval(`
      //   new TextDecoder().decode(new Uint8Array([]))
      // `);
      // assert.strictEqual(result, "");
    });

    test("returns empty string for null/undefined input", async () => {
      // TODO: Implement test
      // const result = await context.eval(`
      //   new TextDecoder().decode()
      // `);
      // assert.strictEqual(result, "");
    });

    test("skips UTF-8 BOM by default", async () => {
      // TODO: Implement test
      // const result = await context.eval(`
      //   new TextDecoder().decode(new Uint8Array([0xEF, 0xBB, 0xBF, 104, 105]))
      // `);
      // assert.strictEqual(result, "hi");
    });

    test("keeps BOM with ignoreBOM: true", async () => {
      // TODO: Implement test
      // const result = await context.eval(`
      //   new TextDecoder("utf-8", { ignoreBOM: true })
      //     .decode(new Uint8Array([0xEF, 0xBB, 0xBF, 104, 105]))
      // `);
      // assert.strictEqual(result, "\uFEFFhi");
    });

    test("decodes ArrayBuffer", async () => {
      // TODO: Implement test
      // const result = await context.eval(`
      //   const arr = new Uint8Array([104, 105]);
      //   new TextDecoder().decode(arr.buffer)
      // `);
      // assert.strictEqual(result, "hi");
    });
  });
});

describe("TextEncoder/TextDecoder roundtrip", () => {
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

  test("roundtrip ASCII", async () => {
    // TODO: Implement test
    // const result = await context.eval(`
    //   const text = "Hello World";
    //   new TextDecoder().decode(new TextEncoder().encode(text))
    // `);
    // assert.strictEqual(result, "Hello World");
  });

  test("roundtrip with emoji", async () => {
    // TODO: Implement test
    // const result = await context.eval(`
    //   const text = "Hello 😀 World!";
    //   new TextDecoder().decode(new TextEncoder().encode(text))
    // `);
    // assert.strictEqual(result, "Hello 😀 World!");
  });

  test("roundtrip mixed languages", async () => {
    // TODO: Implement test
    // const result = await context.eval(`
    //   const text = "Hello 世界 مرحبا";
    //   new TextDecoder().decode(new TextEncoder().encode(text))
    // `);
    // assert.strictEqual(result, "Hello 世界 مرحبا");
  });
});
