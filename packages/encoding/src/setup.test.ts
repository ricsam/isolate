import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import ivm from "isolated-vm";
import { setupEncoding } from "./index.ts";

// TextEncoder/TextDecoder polyfill for Buffer tests (normally provided by core package)
const textEncodingCode = `
(function() {
  class TextEncoder {
    constructor(encoding = 'utf-8') {
      const normalizedEncoding = String(encoding).toLowerCase().trim();
      if (normalizedEncoding !== 'utf-8' && normalizedEncoding !== 'utf8') {
        throw new RangeError('TextEncoder only supports UTF-8 encoding');
      }
    }
    encode(input) {
      const str = String(input ?? '');
      const bytes = [];
      for (let i = 0; i < str.length; i++) {
        let codePoint = str.codePointAt(i);
        if (codePoint === undefined) break;
        if (codePoint > 0xFFFF) i++;
        if (codePoint < 0x80) {
          bytes.push(codePoint);
        } else if (codePoint < 0x800) {
          bytes.push(0xC0 | (codePoint >> 6), 0x80 | (codePoint & 0x3F));
        } else if (codePoint < 0x10000) {
          bytes.push(0xE0 | (codePoint >> 12), 0x80 | ((codePoint >> 6) & 0x3F), 0x80 | (codePoint & 0x3F));
        } else {
          bytes.push(0xF0 | (codePoint >> 18), 0x80 | ((codePoint >> 12) & 0x3F), 0x80 | ((codePoint >> 6) & 0x3F), 0x80 | (codePoint & 0x3F));
        }
      }
      return new Uint8Array(bytes);
    }
    get encoding() { return 'utf-8'; }
  }
  class TextDecoder {
    #encoding; #fatal; #ignoreBOM;
    constructor(encoding = 'utf-8', options = {}) {
      const normalizedEncoding = String(encoding).toLowerCase().trim();
      if (normalizedEncoding !== 'utf-8' && normalizedEncoding !== 'utf8') {
        throw new RangeError('TextDecoder only supports UTF-8 encoding');
      }
      this.#encoding = 'utf-8';
      this.#fatal = Boolean(options.fatal);
      this.#ignoreBOM = Boolean(options.ignoreBOM);
    }
    decode(input) {
      if (!input) return '';
      let bytes;
      if (input instanceof ArrayBuffer) bytes = new Uint8Array(input);
      else if (ArrayBuffer.isView(input)) bytes = new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
      else throw new TypeError('Input must be ArrayBuffer or ArrayBufferView');
      let result = '';
      let i = 0;
      while (i < bytes.length) {
        let codePoint;
        const byte1 = bytes[i++];
        if (byte1 < 0x80) {
          codePoint = byte1;
        } else if ((byte1 & 0xE0) === 0xC0) {
          const byte2 = bytes[i++] ?? 0;
          codePoint = ((byte1 & 0x1F) << 6) | (byte2 & 0x3F);
        } else if ((byte1 & 0xF0) === 0xE0) {
          const byte2 = bytes[i++] ?? 0;
          const byte3 = bytes[i++] ?? 0;
          codePoint = ((byte1 & 0x0F) << 12) | ((byte2 & 0x3F) << 6) | (byte3 & 0x3F);
        } else if ((byte1 & 0xF8) === 0xF0) {
          const byte2 = bytes[i++] ?? 0;
          const byte3 = bytes[i++] ?? 0;
          const byte4 = bytes[i++] ?? 0;
          codePoint = ((byte1 & 0x07) << 18) | ((byte2 & 0x3F) << 12) | ((byte3 & 0x3F) << 6) | (byte4 & 0x3F);
        } else {
          codePoint = 0xFFFD;
        }
        result += String.fromCodePoint(codePoint);
      }
      return result;
    }
    get encoding() { return this.#encoding; }
    get fatal() { return this.#fatal; }
    get ignoreBOM() { return this.#ignoreBOM; }
  }
  globalThis.TextEncoder = TextEncoder;
  globalThis.TextDecoder = TextDecoder;
})();
`;

describe("@ricsam/isolate-encoding", () => {
  let isolate: ivm.Isolate;
  let context: ivm.Context;

  beforeEach(async () => {
    isolate = new ivm.Isolate();
    context = await isolate.createContext();
    // Setup TextEncoder/TextDecoder for Buffer tests
    context.evalSync(textEncodingCode);
  });

  afterEach(() => {
    context.release();
    isolate.dispose();
  });

  describe("btoa", () => {
    test("encodes string to base64", async () => {
      await setupEncoding(context);
      const result = await context.eval(`btoa("hello")`);
      assert.strictEqual(result, "aGVsbG8=");
    });

    test("handles empty string", async () => {
      await setupEncoding(context);
      const result = await context.eval(`btoa("")`);
      assert.strictEqual(result, "");
    });

    test("handles Latin-1 characters", async () => {
      await setupEncoding(context);
      // Test with Latin-1 extended characters (char codes 128-255)
      const result = await context.eval(`btoa("café")`);
      // café uses é which is Latin-1 (char code 233)
      assert.strictEqual(result, "Y2Fm6Q==");
    });

    test("throws on characters outside Latin-1 range", async () => {
      await setupEncoding(context);
      await assert.rejects(
        async () => {
          await context.eval(`btoa("hello 世界")`);
        },
        {
          name: "InvalidCharacterError",
        }
      );
    });

    test("converts non-string arguments to string", async () => {
      await setupEncoding(context);
      const result = await context.eval(`btoa(123)`);
      assert.strictEqual(result, "MTIz");
    });
  });

  describe("atob", () => {
    test("decodes base64 to string", async () => {
      await setupEncoding(context);
      const result = await context.eval(`atob("aGVsbG8=")`);
      assert.strictEqual(result, "hello");
    });

    test("handles empty string", async () => {
      await setupEncoding(context);
      const result = await context.eval(`atob("")`);
      assert.strictEqual(result, "");
    });

    test("throws on invalid base64", async () => {
      await setupEncoding(context);
      await assert.rejects(
        async () => {
          await context.eval(`atob("not valid base64!@#")`);
        },
        {
          name: "InvalidCharacterError",
        }
      );
    });

    test("handles input without padding", async () => {
      await setupEncoding(context);
      // "aGVsbG8" is "hello" without the = padding
      const result = await context.eval(`atob("aGVsbG8")`);
      assert.strictEqual(result, "hello");
    });

    test("ignores whitespace in input", async () => {
      await setupEncoding(context);
      const result = await context.eval(`atob("aGVs bG8=")`);
      assert.strictEqual(result, "hello");
    });
  });

  describe("roundtrip", () => {
    test("btoa and atob are inverse operations", async () => {
      await setupEncoding(context);
      const testStrings = [
        "hello",
        "Hello World!",
        "test123",
        "a",
        "ab",
        "abc",
        "",
      ];

      for (const str of testStrings) {
        const result = await context.eval(
          `atob(btoa(${JSON.stringify(str)}))`
        );
        assert.strictEqual(result, str, `Roundtrip failed for: ${str}`);
      }
    });

    test("handles binary data roundtrip", async () => {
      await setupEncoding(context);
      // Create a string with all Latin-1 bytes
      const result = await context.eval(`
        const bytes = [];
        for (let i = 0; i < 256; i++) {
          bytes.push(String.fromCharCode(i));
        }
        const str = bytes.join('');
        atob(btoa(str)) === str;
      `);
      assert.strictEqual(result, true);
    });
  });

  describe("Buffer.from", () => {
    test("creates buffer from string (utf8)", async () => {
      await setupEncoding(context);
      const result = await context.eval(`
        const buf = Buffer.from("hello");
        Array.from(buf).join(",");
      `);
      assert.strictEqual(result, "104,101,108,108,111");
    });

    test("creates buffer from base64 string", async () => {
      await setupEncoding(context);
      const result = await context.eval(`
        const buf = Buffer.from("aGVsbG8=", "base64");
        buf.toString("utf8");
      `);
      assert.strictEqual(result, "hello");
    });

    test("creates buffer from hex string", async () => {
      await setupEncoding(context);
      const result = await context.eval(`
        const buf = Buffer.from("68656c6c6f", "hex");
        buf.toString("utf8");
      `);
      assert.strictEqual(result, "hello");
    });

    test("creates buffer from array", async () => {
      await setupEncoding(context);
      const result = await context.eval(`
        const buf = Buffer.from([104, 101, 108, 108, 111]);
        buf.toString();
      `);
      assert.strictEqual(result, "hello");
    });
  });

  describe("Buffer.alloc", () => {
    test("allocates zero-filled buffer", async () => {
      await setupEncoding(context);
      const result = await context.eval(`
        const buf = Buffer.alloc(5);
        Array.from(buf).join(",");
      `);
      assert.strictEqual(result, "0,0,0,0,0");
    });

    test("allocates buffer with fill", async () => {
      await setupEncoding(context);
      const result = await context.eval(`
        const buf = Buffer.alloc(5, 1);
        Array.from(buf).join(",");
      `);
      assert.strictEqual(result, "1,1,1,1,1");
    });
  });

  describe("Buffer.concat", () => {
    test("concatenates buffers", async () => {
      await setupEncoding(context);
      const result = await context.eval(`
        const buf1 = Buffer.from("hel");
        const buf2 = Buffer.from("lo");
        Buffer.concat([buf1, buf2]).toString();
      `);
      assert.strictEqual(result, "hello");
    });
  });

  describe("Buffer.isBuffer", () => {
    test("returns true for Buffer", async () => {
      await setupEncoding(context);
      const result = await context.eval(`Buffer.isBuffer(Buffer.from("test"))`);
      assert.strictEqual(result, true);
    });

    test("returns false for Uint8Array", async () => {
      await setupEncoding(context);
      const result = await context.eval(`Buffer.isBuffer(new Uint8Array(5))`);
      assert.strictEqual(result, false);
    });
  });

  describe("Buffer.toString", () => {
    test("converts to base64", async () => {
      await setupEncoding(context);
      const result = await context.eval(`Buffer.from("hello").toString("base64")`);
      assert.strictEqual(result, "aGVsbG8=");
    });

    test("converts to hex", async () => {
      await setupEncoding(context);
      const result = await context.eval(`Buffer.from("hello").toString("hex")`);
      assert.strictEqual(result, "68656c6c6f");
    });
  });

  describe("Buffer.slice", () => {
    test("returns a Buffer", async () => {
      await setupEncoding(context);
      const result = await context.eval(`
        const buf = Buffer.from("hello");
        Buffer.isBuffer(buf.slice(1, 4));
      `);
      assert.strictEqual(result, true);
    });

    test("slices correctly", async () => {
      await setupEncoding(context);
      const result = await context.eval(`Buffer.from("hello").slice(1, 4).toString()`);
      assert.strictEqual(result, "ell");
    });
  });

  describe("Buffer roundtrip", () => {
    test("utf8 roundtrip", async () => {
      await setupEncoding(context);
      const result = await context.eval(`
        const original = "hello world";
        Buffer.from(original).toString() === original;
      `);
      assert.strictEqual(result, true);
    });

    test("base64 roundtrip", async () => {
      await setupEncoding(context);
      const result = await context.eval(`
        const original = "hello world";
        const encoded = Buffer.from(original).toString("base64");
        Buffer.from(encoded, "base64").toString() === original;
      `);
      assert.strictEqual(result, true);
    });

    test("hex roundtrip", async () => {
      await setupEncoding(context);
      const result = await context.eval(`
        const original = "hello world";
        const encoded = Buffer.from(original).toString("hex");
        Buffer.from(encoded, "hex").toString() === original;
      `);
      assert.strictEqual(result, true);
    });

    test("handles unicode", async () => {
      await setupEncoding(context);
      const result = await context.eval(`Buffer.from("hello 世界").toString()`);
      assert.strictEqual(result, "hello 世界");
    });
  });
});
