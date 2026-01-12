import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import ivm from "isolated-vm";
import { setupEncoding } from "./index.ts";

describe("@ricsam/isolate-encoding", () => {
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
});
