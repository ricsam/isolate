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
        // Catch the closed rejection that happens on releaseLock
        writer.closed.catch(() => {});
        writer.releaseLock();
        const lockedAfter = stream.locked;
        JSON.stringify({ lockedBefore, lockedAfter })
      `);
      const data = JSON.parse(result as string);
      assert.strictEqual(data.lockedBefore, true);
      assert.strictEqual(data.lockedAfter, false);
    });
  });

  describe("closed property", () => {
    test("closed is a promise", async () => {
      const result = await context.eval(`
        const stream = new WritableStream();
        const writer = stream.getWriter();
        writer.closed instanceof Promise
      `);
      assert.strictEqual(result, true);
    });

    test("closed resolves when writer.close() is called", async () => {
      const result = await context.eval(`
        (async () => {
          const stream = new WritableStream();
          const writer = stream.getWriter();
          const closePromise = writer.close();
          await writer.closed;
          return 'closed resolved';
        })()
      `, { promise: true });
      assert.strictEqual(result, "closed resolved");
    });

    test("closed resolves after underlying sink close completes", async () => {
      const result = await context.eval(`
        (async () => {
          let closeCalled = false;
          const stream = new WritableStream({
            close() {
              closeCalled = true;
            }
          });
          const writer = stream.getWriter();
          await writer.close();
          await writer.closed;
          return closeCalled;
        })()
      `, { promise: true });
      assert.strictEqual(result, true);
    });

    test("closed rejects when releaseLock() is called", async () => {
      const result = await context.eval(`
        (async () => {
          const stream = new WritableStream();
          const writer = stream.getWriter();
          const closedPromise = writer.closed;
          writer.releaseLock();
          try {
            await closedPromise;
            return 'no error';
          } catch (e) {
            return e instanceof TypeError ? 'TypeError' : 'other error';
          }
        })()
      `, { promise: true });
      assert.strictEqual(result, "TypeError");
    });
  });

  test("WritableStreamDefaultWriter is a function", async () => {
    const result = await context.eval(`typeof WritableStreamDefaultWriter`);
    assert.strictEqual(result, "function");
  });

  test("getWriter returns WritableStreamDefaultWriter instance", async () => {
    const result = await context.eval(`
      const stream = new WritableStream({ write(chunk) {} });
      const writer = stream.getWriter();
      writer instanceof WritableStreamDefaultWriter
    `);
    assert.strictEqual(result, true);
  });

  test("getWriter sets stream.locked to true", async () => {
    const result = await context.eval(`
      const stream = new WritableStream({ write(chunk) {} });
      stream.getWriter();
      stream.locked
    `);
    assert.strictEqual(result, true);
  });

  test("getWriter throws if stream is already locked", async () => {
    const result = await context.eval(`
      const stream = new WritableStream({ write(chunk) {} });
      stream.getWriter();
      try {
        stream.getWriter();
        "should have thrown";
      } catch (e) {
        e.message.includes("locked") ? "correct" : e.message;
      }
    `);
    assert.strictEqual(result, "correct");
  });

  test("can write via stream writer", async () => {
    const result = await context.eval(`
      (async () => {
        const chunks = [];
        const stream = new WritableStream({
          write(chunk) { chunks.push(chunk); }
        });
        const writer = stream.getWriter();
        await writer.write("hello");
        await writer.write("world");
        await writer.close();
        return JSON.stringify(chunks);
      })()
    `, { promise: true });
    assert.deepStrictEqual(JSON.parse(result as string), ["hello", "world"]);
  });

  test("writer.releaseLock unlocks the stream", async () => {
    const result = await context.eval(`
      const stream = new WritableStream({ write(chunk) {} });
      const writer = stream.getWriter();
      // Catch the closed rejection that happens on releaseLock
      writer.closed.catch(() => {});
      writer.releaseLock();
      stream.locked
    `);
    assert.strictEqual(result, false);
  });
});

describe("WritableStream error handling", () => {
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

  test("sink.write() throwing synchronously rejects write promise", async () => {
    const result = await context.eval(`
      (async () => {
        const stream = new WritableStream({
          write(chunk) {
            throw new Error("sync write error");
          }
        });
        const writer = stream.getWriter();
        try {
          await writer.write("data");
          return "no error";
        } catch (e) {
          return "caught: " + e.message;
        }
      })()
    `, { promise: true });
    assert.strictEqual(result, "caught: sync write error");
  });

  test("sink.write() returning rejected promise rejects write promise", async () => {
    const result = await context.eval(`
      (async () => {
        const stream = new WritableStream({
          write(chunk) {
            return new Promise((_, reject) => reject(new Error("async write error")));
          }
        });
        const writer = stream.getWriter();
        try {
          await writer.write("data");
          return "no error";
        } catch (e) {
          return "error caught";
        }
      })()
    `, { promise: true });
    assert.strictEqual(result, "error caught");
  });

  test("controller.error() sets stream to errored state", async () => {
    const result = await context.eval(`
      (async () => {
        let savedController;
        const stream = new WritableStream({
          start(controller) {
            savedController = controller;
          },
          write(chunk) {}
        });
        const writer = stream.getWriter();

        await writer.write("first");
        savedController.error(new Error("controller error"));

        try {
          await writer.write("second");
          return "no error";
        } catch (e) {
          return "subsequent writes fail";
        }
      })()
    `, { promise: true });
    assert.strictEqual(result, "subsequent writes fail");
  });

  test("writes after error are rejected", async () => {
    const result = await context.eval(`
      (async () => {
        const stream = new WritableStream({
          write(chunk) {
            throw new Error("first write fails");
          }
        });
        const writer = stream.getWriter();

        try {
          await writer.write("first");
        } catch (e) {}

        try {
          await writer.write("second");
          return "second write succeeded unexpectedly";
        } catch (e) {
          return "second write rejected";
        }
      })()
    `, { promise: true });
    assert.strictEqual(result, "second write rejected");
  });

  test("abort rejects pending writes", async () => {
    const result = await context.eval(`
      (async () => {
        const stream = new WritableStream({
          write(chunk) {
            return new Promise(() => {}); // Never resolves
          }
        });
        const writer = stream.getWriter();

        const writePromise = writer.write("data").catch(e => "write rejected");
        await writer.abort(new Error("aborted"));

        return await writePromise;
      })()
    `, { promise: true });
    assert.strictEqual(result, "write rejected");
  });

  test("close waits for pending writes to complete", async () => {
    const result = await context.eval(`
      (async () => {
        const log = [];
        const stream = new WritableStream({
          write(chunk) {
            log.push("write:" + chunk);
          }
        });
        const writer = stream.getWriter();
        await writer.write("a");
        await writer.write("b");
        await writer.close();
        log.push("closed");
        return JSON.stringify(log);
      })()
    `, { promise: true });
    assert.deepStrictEqual(JSON.parse(result as string), ["write:a", "write:b", "closed"]);
  });
});
