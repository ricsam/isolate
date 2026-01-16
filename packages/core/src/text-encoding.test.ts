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
      const result = await context.eval(`new TextEncoder().encoding`);
      assert.strictEqual(result, "utf-8");
    });

    test("accepts utf-8 encoding explicitly", async () => {
      const result = await context.eval(`new TextEncoder("utf-8").encoding`);
      assert.strictEqual(result, "utf-8");
    });

    test("throws RangeError for invalid encoding", async () => {
      const result = await context.eval(`
        try {
          new TextEncoder("latin1");
          "no error";
        } catch (e) {
          e.name;
        }
      `);
      assert.strictEqual(result, "RangeError");
    });
  });

  describe("encode()", () => {
    test("encodes ASCII string", async () => {
      const result = JSON.parse(await context.eval(`
        JSON.stringify(Array.from(new TextEncoder().encode("hello")))
      `) as string);
      assert.deepStrictEqual(result, [104, 101, 108, 108, 111]);
    });

    test("encodes UTF-8 2-byte character", async () => {
      const result = JSON.parse(await context.eval(`
        JSON.stringify(Array.from(new TextEncoder().encode("é")))
      `) as string);
      assert.deepStrictEqual(result, [0xC3, 0xA9]);
    });

    test("encodes UTF-8 3-byte character (Chinese)", async () => {
      const result = JSON.parse(await context.eval(`
        JSON.stringify(Array.from(new TextEncoder().encode("中")))
      `) as string);
      assert.deepStrictEqual(result, [0xE4, 0xB8, 0xAD]);
    });

    test("encodes emoji (4-byte surrogate pair)", async () => {
      const result = JSON.parse(await context.eval(`
        JSON.stringify(Array.from(new TextEncoder().encode("😀")))
      `) as string);
      assert.deepStrictEqual(result, [0xF0, 0x9F, 0x98, 0x80]);
    });

    test("returns Uint8Array", async () => {
      const result = await context.eval(`
        new TextEncoder().encode("test") instanceof Uint8Array
      `);
      assert.strictEqual(result, true);
    });

    test("returns empty Uint8Array for empty string", async () => {
      const result = await context.eval(`
        new TextEncoder().encode("").length
      `);
      assert.strictEqual(result, 0);
    });
  });

  describe("encodeInto()", () => {
    test("encodes into existing array", async () => {
      const result = await context.eval(`
        const dest = new Uint8Array(10);
        const { read, written } = new TextEncoder().encodeInto("hi", dest);
        JSON.stringify({ read, written, bytes: Array.from(dest.slice(0, written)) })
      `);
      const data = JSON.parse(result as string);
      assert.strictEqual(data.read, 2);
      assert.strictEqual(data.written, 2);
      assert.deepStrictEqual(data.bytes, [104, 105]);
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
      const result = await context.eval(`new TextDecoder().encoding`);
      assert.strictEqual(result, "utf-8");
    });

    test("throws RangeError for invalid encoding", async () => {
      const result = await context.eval(`
        try {
          new TextDecoder("latin1");
          "no error";
        } catch (e) {
          e.name;
        }
      `);
      assert.strictEqual(result, "RangeError");
    });

    test("has fatal property", async () => {
      const result = await context.eval(`
        new TextDecoder("utf-8", { fatal: true }).fatal
      `);
      assert.strictEqual(result, true);
    });

    test("has ignoreBOM property", async () => {
      const result = await context.eval(`
        new TextDecoder("utf-8", { ignoreBOM: true }).ignoreBOM
      `);
      assert.strictEqual(result, true);
    });
  });

  describe("decode()", () => {
    test("decodes ASCII bytes", async () => {
      const result = await context.eval(`
        new TextDecoder().decode(new Uint8Array([104, 101, 108, 108, 111]))
      `);
      assert.strictEqual(result, "hello");
    });

    test("decodes UTF-8 2-byte character", async () => {
      const result = await context.eval(`
        new TextDecoder().decode(new Uint8Array([0xC3, 0xA9]))
      `);
      assert.strictEqual(result, "é");
    });

    test("decodes UTF-8 3-byte character", async () => {
      const result = await context.eval(`
        new TextDecoder().decode(new Uint8Array([0xE4, 0xB8, 0xAD]))
      `);
      assert.strictEqual(result, "中");
    });

    test("decodes emoji (4-byte)", async () => {
      const result = await context.eval(`
        new TextDecoder().decode(new Uint8Array([0xF0, 0x9F, 0x98, 0x80]))
      `);
      assert.strictEqual(result, "😀");
    });

    test("returns empty string for empty input", async () => {
      const result = await context.eval(`
        new TextDecoder().decode(new Uint8Array([]))
      `);
      assert.strictEqual(result, "");
    });

    test("returns empty string for null/undefined input", async () => {
      const result = await context.eval(`
        new TextDecoder().decode()
      `);
      assert.strictEqual(result, "");
    });

    test("skips UTF-8 BOM by default", async () => {
      const result = await context.eval(`
        new TextDecoder().decode(new Uint8Array([0xEF, 0xBB, 0xBF, 104, 105]))
      `);
      assert.strictEqual(result, "hi");
    });

    test("keeps BOM with ignoreBOM: true", async () => {
      const result = await context.eval(`
        new TextDecoder("utf-8", { ignoreBOM: true })
          .decode(new Uint8Array([0xEF, 0xBB, 0xBF, 104, 105]))
      `);
      assert.strictEqual(result, "\uFEFFhi");
    });

    test("decodes ArrayBuffer", async () => {
      const result = await context.eval(`
        const arr = new Uint8Array([104, 105]);
        new TextDecoder().decode(arr.buffer)
      `);
      assert.strictEqual(result, "hi");
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
    const result = await context.eval(`
      const text = "Hello World";
      new TextDecoder().decode(new TextEncoder().encode(text))
    `);
    assert.strictEqual(result, "Hello World");
  });

  test("roundtrip with emoji", async () => {
    const result = await context.eval(`
      const text = "Hello 😀 World!";
      new TextDecoder().decode(new TextEncoder().encode(text))
    `);
    assert.strictEqual(result, "Hello 😀 World!");
  });

  test("roundtrip mixed languages", async () => {
    const result = await context.eval(`
      const text = "Hello 世界 مرحبا";
      new TextDecoder().decode(new TextEncoder().encode(text))
    `);
    assert.strictEqual(result, "Hello 世界 مرحبا");
  });
});

describe("TextEncoderStream", () => {
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
    test("creates stream with encoding property", async () => {
      const result = await context.eval(`new TextEncoderStream().encoding`);
      assert.strictEqual(result, "utf-8");
    });

    test("is instance of TransformStream", async () => {
      const result = await context.eval(`new TextEncoderStream() instanceof TransformStream`);
      assert.strictEqual(result, true);
    });
  });

  describe("streaming encode", () => {
    test("encodes ASCII string stream", async () => {
      const result = await context.eval(`
        (async () => {
          const stream = new ReadableStream({
            start(controller) {
              controller.enqueue("hello");
              controller.close();
            }
          });
          const encoded = stream.pipeThrough(new TextEncoderStream());
          const reader = encoded.getReader();
          const chunks = [];
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            chunks.push(Array.from(value));
          }
          return JSON.stringify(chunks);
        })()
      `, { promise: true });
      const chunks = JSON.parse(result as string);
      assert.deepStrictEqual(chunks, [[104, 101, 108, 108, 111]]);
    });

    test("encodes multiple chunks", async () => {
      const result = await context.eval(`
        (async () => {
          const stream = new ReadableStream({
            start(controller) {
              controller.enqueue("hello");
              controller.enqueue(" world");
              controller.close();
            }
          });
          const encoded = stream.pipeThrough(new TextEncoderStream());
          const reader = encoded.getReader();
          const chunks = [];
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            chunks.push(Array.from(value));
          }
          return JSON.stringify(chunks);
        })()
      `, { promise: true });
      const chunks = JSON.parse(result as string);
      assert.strictEqual(chunks.length, 2);
      assert.deepStrictEqual(chunks[0], [104, 101, 108, 108, 111]);
      assert.deepStrictEqual(chunks[1], [32, 119, 111, 114, 108, 100]);
    });

    test("encodes UTF-8 multi-byte characters", async () => {
      const result = await context.eval(`
        (async () => {
          const stream = new ReadableStream({
            start(controller) {
              controller.enqueue("中");
              controller.close();
            }
          });
          const encoded = stream.pipeThrough(new TextEncoderStream());
          const reader = encoded.getReader();
          const chunks = [];
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            chunks.push(Array.from(value));
          }
          return JSON.stringify(chunks);
        })()
      `, { promise: true });
      const chunks = JSON.parse(result as string);
      assert.deepStrictEqual(chunks, [[0xE4, 0xB8, 0xAD]]);
    });

    test("returns Uint8Array chunks", async () => {
      const result = await context.eval(`
        (async () => {
          const stream = new ReadableStream({
            start(controller) {
              controller.enqueue("test");
              controller.close();
            }
          });
          const encoded = stream.pipeThrough(new TextEncoderStream());
          const reader = encoded.getReader();
          const { value } = await reader.read();
          return value instanceof Uint8Array;
        })()
      `, { promise: true });
      assert.strictEqual(result, true);
    });

    test("handles surrogate pairs split across chunks", async () => {
      const result = await context.eval(`
        (async () => {
          // Emoji 😀 is \\uD83D\\uDE00
          const highSurrogate = "\\uD83D";
          const lowSurrogate = "\\uDE00";
          const stream = new ReadableStream({
            start(controller) {
              controller.enqueue(highSurrogate);
              controller.enqueue(lowSurrogate);
              controller.close();
            }
          });
          const encoded = stream.pipeThrough(new TextEncoderStream());
          const reader = encoded.getReader();
          const chunks = [];
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            chunks.push(...Array.from(value));
          }
          return JSON.stringify(chunks);
        })()
      `, { promise: true });
      const bytes = JSON.parse(result as string);
      // Should encode as the emoji bytes: [0xF0, 0x9F, 0x98, 0x80]
      assert.deepStrictEqual(bytes, [0xF0, 0x9F, 0x98, 0x80]);
    });

    test("handles lone high surrogate at end of stream", async () => {
      const result = await context.eval(`
        (async () => {
          // Lone high surrogate should be replaced with replacement char
          const highSurrogate = "\\uD83D";
          const stream = new ReadableStream({
            start(controller) {
              controller.enqueue("a" + highSurrogate);
              controller.close();
            }
          });
          const encoded = stream.pipeThrough(new TextEncoderStream());
          const reader = encoded.getReader();
          const chunks = [];
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            chunks.push(...Array.from(value));
          }
          return JSON.stringify(chunks);
        })()
      `, { promise: true });
      const bytes = JSON.parse(result as string);
      // 'a' is 97, replacement char U+FFFD in UTF-8 is [0xEF, 0xBF, 0xBD]
      assert.deepStrictEqual(bytes, [97, 0xEF, 0xBF, 0xBD]);
    });
  });
});

describe("TextDecoderStream", () => {
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
    test("creates stream with default utf-8 encoding", async () => {
      const result = await context.eval(`new TextDecoderStream().encoding`);
      assert.strictEqual(result, "utf-8");
    });

    test("is instance of TransformStream", async () => {
      const result = await context.eval(`new TextDecoderStream() instanceof TransformStream`);
      assert.strictEqual(result, true);
    });

    test("throws RangeError for invalid encoding", async () => {
      const result = await context.eval(`
        try {
          new TextDecoderStream("latin1");
          "no error";
        } catch (e) {
          e.name;
        }
      `);
      assert.strictEqual(result, "RangeError");
    });

    test("has fatal property", async () => {
      const result = await context.eval(`
        new TextDecoderStream("utf-8", { fatal: true }).fatal
      `);
      assert.strictEqual(result, true);
    });

    test("has ignoreBOM property", async () => {
      const result = await context.eval(`
        new TextDecoderStream("utf-8", { ignoreBOM: true }).ignoreBOM
      `);
      assert.strictEqual(result, true);
    });
  });

  describe("streaming decode", () => {
    test("decodes ASCII byte stream", async () => {
      const result = await context.eval(`
        (async () => {
          const stream = new ReadableStream({
            start(controller) {
              controller.enqueue(new Uint8Array([104, 101, 108, 108, 111]));
              controller.close();
            }
          });
          const decoded = stream.pipeThrough(new TextDecoderStream());
          const reader = decoded.getReader();
          const chunks = [];
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            chunks.push(value);
          }
          return chunks.join("");
        })()
      `, { promise: true });
      assert.strictEqual(result, "hello");
    });

    test("decodes multiple chunks", async () => {
      const result = await context.eval(`
        (async () => {
          const stream = new ReadableStream({
            start(controller) {
              controller.enqueue(new Uint8Array([104, 101, 108, 108, 111]));
              controller.enqueue(new Uint8Array([32, 119, 111, 114, 108, 100]));
              controller.close();
            }
          });
          const decoded = stream.pipeThrough(new TextDecoderStream());
          const reader = decoded.getReader();
          const chunks = [];
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            chunks.push(value);
          }
          return chunks.join("");
        })()
      `, { promise: true });
      assert.strictEqual(result, "hello world");
    });

    test("decodes UTF-8 multi-byte characters", async () => {
      const result = await context.eval(`
        (async () => {
          const stream = new ReadableStream({
            start(controller) {
              controller.enqueue(new Uint8Array([0xE4, 0xB8, 0xAD]));
              controller.close();
            }
          });
          const decoded = stream.pipeThrough(new TextDecoderStream());
          const reader = decoded.getReader();
          const chunks = [];
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            chunks.push(value);
          }
          return chunks.join("");
        })()
      `, { promise: true });
      assert.strictEqual(result, "中");
    });

    test("returns string chunks", async () => {
      const result = await context.eval(`
        (async () => {
          const stream = new ReadableStream({
            start(controller) {
              controller.enqueue(new Uint8Array([104, 105]));
              controller.close();
            }
          });
          const decoded = stream.pipeThrough(new TextDecoderStream());
          const reader = decoded.getReader();
          const { value } = await reader.read();
          return typeof value;
        })()
      `, { promise: true });
      assert.strictEqual(result, "string");
    });

    test("handles multi-byte UTF-8 sequence split across chunks", async () => {
      const result = await context.eval(`
        (async () => {
          // Chinese character 中 is [0xE4, 0xB8, 0xAD] - split into chunks
          const stream = new ReadableStream({
            start(controller) {
              controller.enqueue(new Uint8Array([0xE4]));
              controller.enqueue(new Uint8Array([0xB8, 0xAD]));
              controller.close();
            }
          });
          const decoded = stream.pipeThrough(new TextDecoderStream());
          const reader = decoded.getReader();
          const chunks = [];
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            chunks.push(value);
          }
          return chunks.join("");
        })()
      `, { promise: true });
      assert.strictEqual(result, "中");
    });

    test("handles 4-byte UTF-8 sequence split across chunks", async () => {
      const result = await context.eval(`
        (async () => {
          // Emoji 😀 is [0xF0, 0x9F, 0x98, 0x80] - split across 3 chunks
          const stream = new ReadableStream({
            start(controller) {
              controller.enqueue(new Uint8Array([0xF0]));
              controller.enqueue(new Uint8Array([0x9F, 0x98]));
              controller.enqueue(new Uint8Array([0x80]));
              controller.close();
            }
          });
          const decoded = stream.pipeThrough(new TextDecoderStream());
          const reader = decoded.getReader();
          const chunks = [];
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            chunks.push(value);
          }
          return chunks.join("");
        })()
      `, { promise: true });
      assert.strictEqual(result, "😀");
    });

    test("handles ArrayBuffer input", async () => {
      const result = await context.eval(`
        (async () => {
          const stream = new ReadableStream({
            start(controller) {
              const arr = new Uint8Array([104, 105]);
              controller.enqueue(arr.buffer);
              controller.close();
            }
          });
          const decoded = stream.pipeThrough(new TextDecoderStream());
          const reader = decoded.getReader();
          const { value } = await reader.read();
          return value;
        })()
      `, { promise: true });
      assert.strictEqual(result, "hi");
    });
  });
});

describe("TextEncoderStream/TextDecoderStream roundtrip", () => {
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

  test("roundtrip ASCII stream", async () => {
    const result = await context.eval(`
      (async () => {
        const text = "Hello World";
        const stream = new ReadableStream({
          start(controller) {
            controller.enqueue(text);
            controller.close();
          }
        });
        const roundtrip = stream
          .pipeThrough(new TextEncoderStream())
          .pipeThrough(new TextDecoderStream());
        const reader = roundtrip.getReader();
        const chunks = [];
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
        }
        return chunks.join("");
      })()
    `, { promise: true });
    assert.strictEqual(result, "Hello World");
  });

  test("roundtrip with emoji stream", async () => {
    const result = await context.eval(`
      (async () => {
        const text = "Hello 😀 World!";
        const stream = new ReadableStream({
          start(controller) {
            controller.enqueue(text);
            controller.close();
          }
        });
        const roundtrip = stream
          .pipeThrough(new TextEncoderStream())
          .pipeThrough(new TextDecoderStream());
        const reader = roundtrip.getReader();
        const chunks = [];
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
        }
        return chunks.join("");
      })()
    `, { promise: true });
    assert.strictEqual(result, "Hello 😀 World!");
  });

  test("roundtrip mixed languages stream", async () => {
    const result = await context.eval(`
      (async () => {
        const text = "Hello 世界 مرحبا";
        const stream = new ReadableStream({
          start(controller) {
            controller.enqueue(text);
            controller.close();
          }
        });
        const roundtrip = stream
          .pipeThrough(new TextEncoderStream())
          .pipeThrough(new TextDecoderStream());
        const reader = roundtrip.getReader();
        const chunks = [];
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
        }
        return chunks.join("");
      })()
    `, { promise: true });
    assert.strictEqual(result, "Hello 世界 مرحبا");
  });

  test("roundtrip multiple chunks", async () => {
    const result = await context.eval(`
      (async () => {
        const stream = new ReadableStream({
          start(controller) {
            controller.enqueue("Hello ");
            controller.enqueue("世界 ");
            controller.enqueue("😀");
            controller.close();
          }
        });
        const roundtrip = stream
          .pipeThrough(new TextEncoderStream())
          .pipeThrough(new TextDecoderStream());
        const reader = roundtrip.getReader();
        const chunks = [];
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
        }
        return chunks.join("");
      })()
    `, { promise: true });
    assert.strictEqual(result, "Hello 世界 😀");
  });
});
