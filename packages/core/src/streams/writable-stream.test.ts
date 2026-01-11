import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import ivm from "isolated-vm";
import { setupCore, clearAllInstanceState, cleanupUnmarshaledHandles } from "../index.ts";

describe("WritableStream", () => {
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
    test("creates a WritableStream", async () => {
      const result = await context.eval(`
        const stream = new WritableStream();
        stream instanceof WritableStream
      `);
      assert.strictEqual(result, true);
    });

    test("WritableStream is a function", async () => {
      const result = await context.eval(`
        typeof WritableStream === 'function'
      `);
      assert.strictEqual(result, true);
    });
  });

  describe("locked property", () => {
    test("is false initially", async () => {
      const result = await context.eval(`
        const stream = new WritableStream();
        stream.locked
      `);
      assert.strictEqual(result, false);
    });

    test("becomes true when writer is acquired", async () => {
      const result = await context.eval(`
        const stream = new WritableStream();
        const writer = stream.getWriter();
        stream.locked
      `);
      assert.strictEqual(result, true);
    });
  });

  describe("getWriter()", () => {
    test("returns a WritableStreamDefaultWriter", async () => {
      const result = await context.eval(`
        const stream = new WritableStream();
        const writer = stream.getWriter();
        writer instanceof WritableStreamDefaultWriter
      `);
      assert.strictEqual(result, true);
    });

    test("throws if stream is already locked", async () => {
      const result = await context.eval(`
        const stream = new WritableStream();
        stream.getWriter();
        try {
          stream.getWriter();
          'no error';
        } catch (e) {
          e instanceof TypeError ? 'TypeError' : 'other';
        }
      `);
      assert.strictEqual(result, "TypeError");
    });
  });

  describe("close()", () => {
    test("closes the stream", async () => {
      const result = await context.eval(`
        (async () => {
          const stream = new WritableStream();
          await stream.close();
          return 'closed';
        })()
      `, { promise: true });
      assert.strictEqual(result, "closed");
    });
  });

  describe("abort()", () => {
    test("aborts the stream", async () => {
      const result = await context.eval(`
        (async () => {
          const stream = new WritableStream();
          await stream.abort('reason');
          return 'aborted';
        })()
      `, { promise: true });
      assert.strictEqual(result, "aborted");
    });
  });
});

describe("WritableStreamDefaultWriter", () => {
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

  describe("write()", () => {
    test("writes chunks to the stream", async () => {
      const result = await context.eval(`
        (async () => {
          const chunks = [];
          const stream = new WritableStream({
            write(chunk) {
              chunks.push(chunk);
            }
          });
          const writer = stream.getWriter();
          await writer.write('chunk1');
          await writer.write('chunk2');
          return JSON.stringify(chunks);
        })()
      `, { promise: true });
      assert.deepStrictEqual(JSON.parse(result as string), ["chunk1", "chunk2"]);
    });
  });

  describe("close()", () => {
    test("closes the writer and stream", async () => {
      const result = await context.eval(`
        (async () => {
          let closed = false;
          const stream = new WritableStream({
            close() {
              closed = true;
            }
          });
          const writer = stream.getWriter();
          await writer.close();
          return closed;
        })()
      `, { promise: true });
      assert.strictEqual(result, true);
    });
  });

  describe("releaseLock()", () => {
    test("releases the lock on the stream", async () => {
      const result = await context.eval(`
        const stream = new WritableStream();
        const writer = stream.getWriter();
        const lockedBefore = stream.locked;
        writer.releaseLock();
        const lockedAfter = stream.locked;
        JSON.stringify({ lockedBefore, lockedAfter })
      `);
      const data = JSON.parse(result as string);
      assert.strictEqual(data.lockedBefore, true);
      assert.strictEqual(data.lockedAfter, false);
    });
  });
});
