/**
 * Tests for WritableStreamDefaultWriter.releaseLock() behavior
 * Verifies fix for Issue 6 - stream writer release should not reject
 * already-settled closed promise
 */

import { test, describe } from "node:test";
import assert from "node:assert";
import ivm from "isolated-vm";
import { setupCore } from "./index.ts";

describe("WritableStreamDefaultWriter.releaseLock()", () => {
  test("releaseLock() after close() does not reject closed promise", async () => {
    const isolate = new ivm.Isolate();
    const context = await isolate.createContext();

    const coreHandle = await setupCore(context);

    try {
      const resultJson = await context.eval(
        `
        (async () => {
          const chunks = [];
          const stream = new WritableStream({
            write(chunk) {
              chunks.push(chunk);
            }
          });

          const writer = stream.getWriter();

          let closedResolved = false;
          let closedRejected = false;

          writer.closed
            .then(() => { closedResolved = true; })
            .catch(() => { closedRejected = true; });

          await writer.write("test");
          await writer.close();

          // Yield for microtasks so the closed promise settles
          await Promise.resolve();

          // This should not reject the already-resolved closed promise
          writer.releaseLock();

          // Yield for any potential rejection microtask
          await Promise.resolve();

          return JSON.stringify({
            closedResolved,
            closedRejected,
            chunksLength: chunks.length,
            firstChunk: chunks[0],
          });
        })()
        `,
        { promise: true }
      );

      const result = JSON.parse(resultJson);
      assert.strictEqual(result.closedResolved, true, "closed should have resolved");
      assert.strictEqual(result.closedRejected, false, "closed should not have been rejected");
      assert.strictEqual(result.chunksLength, 1, "Should have one chunk");
      assert.strictEqual(result.firstChunk, "test", "Data should have been written");
    } finally {
      coreHandle.dispose();
      isolate.dispose();
    }
  });

  test("releaseLock() before close() rejects closed promise", async () => {
    const isolate = new ivm.Isolate();
    const context = await isolate.createContext();

    const coreHandle = await setupCore(context);

    try {
      const resultJson = await context.eval(
        `
        (async () => {
          const stream = new WritableStream({
            write(chunk) {}
          });

          const writer = stream.getWriter();

          let closedResolved = false;
          let closedRejected = false;
          let rejectError = null;

          writer.closed
            .then(() => { closedResolved = true; })
            .catch((e) => {
              closedRejected = true;
              rejectError = e.message;
            });

          // Release without closing
          writer.releaseLock();

          // Yield multiple microtask ticks for the rejection to propagate
          // through the stream internals
          await Promise.resolve();
          await Promise.resolve();
          await Promise.resolve();

          return JSON.stringify({
            closedResolved,
            closedRejected,
            rejectError,
          });
        })()
        `,
        { promise: true }
      );

      const result = JSON.parse(resultJson);
      assert.strictEqual(result.closedResolved, false, "closed should not have resolved");
      assert.strictEqual(result.closedRejected, true, "closed should have been rejected");
      assert.ok(result.rejectError.includes("released"), "Error should mention release");
    } finally {
      coreHandle.dispose();
      isolate.dispose();
    }
  });

  test("pipeTo() completes successfully with releaseLock() in finally", async () => {
    const isolate = new ivm.Isolate();
    const context = await isolate.createContext();

    const coreHandle = await setupCore(context);

    try {
      const resultJson = await context.eval(
        `
        (async () => {
          let chunksCount = 0;
          let lastChunk = "";
          const readable = new ReadableStream({
            start(controller) {
              controller.enqueue("chunk1");
              controller.enqueue("chunk2");
              controller.close();
            }
          });

          const writable = new WritableStream({
            write(chunk) {
              chunksCount++;
              lastChunk = chunk;
            }
          });

          // pipeTo internally uses getWriter/releaseLock
          await readable.pipeTo(writable);

          return JSON.stringify({ chunksCount, lastChunk });
        })()
        `,
        { promise: true }
      );

      const result = JSON.parse(resultJson);
      assert.strictEqual(result.chunksCount, 2, "Should have written 2 chunks");
      assert.strictEqual(result.lastChunk, "chunk2", "Last chunk should be chunk2");
    } finally {
      coreHandle.dispose();
      isolate.dispose();
    }
  });

  test("releaseLock() after abort() does not re-reject closed promise", async () => {
    const isolate = new ivm.Isolate();
    const context = await isolate.createContext();

    const coreHandle = await setupCore(context);

    try {
      const resultJson = await context.eval(
        `
        (async () => {
          const stream = new WritableStream({
            write(chunk) {}
          });

          const writer = stream.getWriter();

          let rejectionCount = 0;
          let lastRejectReason = null;

          writer.closed.catch((e) => {
            rejectionCount++;
            lastRejectReason = e instanceof Error ? e.message : String(e);
          });

          await writer.abort(new Error("test abort"));

          // Yield for any rejection microtask from abort
          await Promise.resolve();

          const rejectionCountAfterAbort = rejectionCount;

          // This should not cause a new rejection
          writer.releaseLock();

          // Yield for any potential re-rejection microtask
          await Promise.resolve();

          return JSON.stringify({
            rejectionCountAfterAbort,
            finalRejectionCount: rejectionCount,
            // If there was any rejection, verify it wasn't "released"
            lastRejectReason,
          });
        })()
        `,
        { promise: true }
      );

      const result = JSON.parse(resultJson);
      // The key assertion: releaseLock() should not cause additional rejections
      assert.strictEqual(
        result.finalRejectionCount,
        result.rejectionCountAfterAbort,
        "releaseLock() should not cause additional rejection after abort()"
      );
      // If there was a rejection, it should not be "released" message
      if (result.lastRejectReason) {
        assert.ok(
          !result.lastRejectReason.includes("released"),
          "If rejected, should not be from releaseLock()"
        );
      }
    } finally {
      coreHandle.dispose();
      isolate.dispose();
    }
  });

  test("TransformStream pipeTo works correctly", async () => {
    const isolate = new ivm.Isolate();
    const context = await isolate.createContext();

    const coreHandle = await setupCore(context);

    try {
      const resultJson = await context.eval(
        `
        (async () => {
          let resultsCount = 0;
          let lastResult = "";

          // Create a transform stream that uppercases text
          const transform = new TransformStream({
            transform(chunk, controller) {
              controller.enqueue(chunk.toUpperCase());
            }
          });

          // Create source and sink
          const source = new ReadableStream({
            start(controller) {
              controller.enqueue("hello");
              controller.enqueue("world");
              controller.close();
            }
          });

          const sink = new WritableStream({
            write(chunk) {
              resultsCount++;
              lastResult = chunk;
            }
          });

          // Pipe through transform
          await source
            .pipeThrough(transform)
            .pipeTo(sink);

          return JSON.stringify({ resultsCount, lastResult });
        })()
        `,
        { promise: true }
      );

      const result = JSON.parse(resultJson);
      assert.strictEqual(result.resultsCount, 2, "Should have 2 results");
      assert.strictEqual(result.lastResult, "WORLD", "Last result should be uppercased");
    } finally {
      coreHandle.dispose();
      isolate.dispose();
    }
  });
});
