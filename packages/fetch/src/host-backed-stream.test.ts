import { test, describe, beforeEach, afterEach, it } from "node:test";
import assert from "node:assert";
import ivm from "isolated-vm";
import {
  setupFetch,
  clearAllInstanceState,
  type FetchHandle,
} from "./index.ts";
import { setupTimers, type TimersHandle } from "@ricsam/isolate-timers";
import { clearStreamRegistryForContext } from "./stream-state.ts";

describe("HostBackedReadableStream", () => {
  let isolate: ivm.Isolate;
  let context: ivm.Context;
  let fetchHandle: FetchHandle;
  let timersHandle: TimersHandle;

  beforeEach(async () => {
    isolate = new ivm.Isolate();
    context = await isolate.createContext();
    clearAllInstanceState();
    timersHandle = await setupTimers(context);
    fetchHandle = await setupFetch(context);
  });

  afterEach(async () => {
    fetchHandle.dispose();
    timersHandle.dispose();
    clearStreamRegistryForContext(context);
    context.release();
    isolate.dispose();
  });

  describe("creation", () => {
    it("creates a stream with a valid stream ID", () => {
      const result = context.evalSync(`
        const stream = new HostBackedReadableStream();
        const streamId = stream._getStreamId();
        JSON.stringify({
          hasStreamId: typeof streamId === "number",
          streamIdPositive: streamId > 0
        })
      `);
      const data = JSON.parse(result as string) as {
        hasStreamId: boolean;
        streamIdPositive: boolean;
      };
      assert.strictEqual(data.hasStreamId, true);
      assert.strictEqual(data.streamIdPositive, true);
    });

    it("each stream gets a unique ID", () => {
      const result = context.evalSync(`
        const stream1 = new HostBackedReadableStream();
        const stream2 = new HostBackedReadableStream();
        const stream3 = new HostBackedReadableStream();
        JSON.stringify({
          id1: stream1._getStreamId(),
          id2: stream2._getStreamId(),
          id3: stream3._getStreamId()
        })
      `);
      const data = JSON.parse(result as string) as {
        id1: number;
        id2: number;
        id3: number;
      };
      assert.notStrictEqual(data.id1, data.id2);
      assert.notStrictEqual(data.id2, data.id3);
      assert.notStrictEqual(data.id1, data.id3);
    });
  });

  describe("getReader", () => {
    it("returns a reader object", () => {
      const result = context.evalSync(`
        const stream = new HostBackedReadableStream();
        const reader = stream.getReader();
        JSON.stringify({
          hasReader: reader != null,
          hasReadMethod: typeof reader.read === "function",
          hasCancelMethod: typeof reader.cancel === "function",
          hasReleaseLockMethod: typeof reader.releaseLock === "function"
        })
      `);
      const data = JSON.parse(result as string) as {
        hasReader: boolean;
        hasReadMethod: boolean;
        hasCancelMethod: boolean;
        hasReleaseLockMethod: boolean;
      };
      assert.strictEqual(data.hasReader, true);
      assert.strictEqual(data.hasReadMethod, true);
      assert.strictEqual(data.hasCancelMethod, true);
      assert.strictEqual(data.hasReleaseLockMethod, true);
    });

    it("has locked property that tracks reader state", () => {
      const result = context.evalSync(`
        const stream = new HostBackedReadableStream();
        const before = stream.locked;
        const reader = stream.getReader();
        const after = stream.locked;
        JSON.stringify({ before, after, hasLocked: "locked" in stream })
      `);
      const data = JSON.parse(result as string) as {
        before: boolean;
        after: boolean;
        hasLocked: boolean;
      };
      assert.strictEqual(data.hasLocked, true);
      // WHATWG spec: locked is false before getting reader, true after
      assert.strictEqual(data.before, false);
      assert.strictEqual(data.after, true);
    });

    it("throws when getting multiple readers (WHATWG spec behavior)", () => {
      // Per WHATWG spec, getting a reader on a locked stream should throw
      const result = context.evalSync(`
        try {
          const stream = new HostBackedReadableStream();
          const reader1 = stream.getReader();
          const reader2 = stream.getReader();
          JSON.stringify({ threw: false });
        } catch (e) {
          JSON.stringify({
            threw: true,
            isTypeError: e instanceof TypeError,
            message: e.message
          });
        }
      `);
      const data = JSON.parse(result as string) as {
        threw: boolean;
        isTypeError?: boolean;
        message?: string;
      };
      assert.strictEqual(data.threw, true);
      assert.strictEqual(data.isTypeError, true);
    });
  });

  describe("read", () => {
    it("returns chunks pushed to stream", async () => {
      const result = await context.eval(
        `
        (async () => {
          const stream = new HostBackedReadableStream();
          const streamId = stream._getStreamId();

          // Push data to the stream
          __Stream_push(streamId, Array.from(new TextEncoder().encode("hello")));
          __Stream_close(streamId);

          const reader = stream.getReader();
          const { value, done } = await reader.read();

          return JSON.stringify({
            text: new TextDecoder().decode(value),
            done
          });
        })()
      `,
        { promise: true }
      );
      const data = JSON.parse(result as string) as { text: string; done: boolean };
      assert.strictEqual(data.text, "hello");
      assert.strictEqual(data.done, false);
    });

    it("returns done when stream closes", async () => {
      const result = await context.eval(
        `
        (async () => {
          const stream = new HostBackedReadableStream();
          const streamId = stream._getStreamId();

          __Stream_close(streamId);

          const reader = stream.getReader();
          const { done } = await reader.read();

          return JSON.stringify({ done });
        })()
      `,
        { promise: true }
      );
      const data = JSON.parse(result as string) as { done: boolean };
      assert.strictEqual(data.done, true);
    });

    it("returns all queued chunks before done", async () => {
      const result = await context.eval(
        `
        (async () => {
          const stream = new HostBackedReadableStream();
          const streamId = stream._getStreamId();

          // Push multiple chunks
          __Stream_push(streamId, Array.from(new TextEncoder().encode("a")));
          __Stream_push(streamId, Array.from(new TextEncoder().encode("b")));
          __Stream_push(streamId, Array.from(new TextEncoder().encode("c")));
          __Stream_close(streamId);

          const reader = stream.getReader();
          const chunks = [];
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            chunks.push(new TextDecoder().decode(value));
          }

          return JSON.stringify({ chunks });
        })()
      `,
        { promise: true }
      );
      const data = JSON.parse(result as string) as { chunks: string[] };
      assert.deepStrictEqual(data.chunks, ["a", "b", "c"]);
    });

    it("throws on errored stream", async () => {
      await assert.rejects(
        context.eval(
          `
          (async () => {
            const stream = new HostBackedReadableStream();
            const streamId = stream._getStreamId();

            __Stream_error(streamId, "Stream failed");

            const reader = stream.getReader();
            await reader.read();
          })()
        `,
          { promise: true }
        )
      );
    });

  });

  describe("cancel", () => {
    it("cancel returns a promise", async () => {
      const result = await context.eval(
        `
        (async () => {
          const stream = new HostBackedReadableStream();
          const reader = stream.getReader();
          const cancelResult = await reader.cancel();
          return JSON.stringify({ cancelResult: cancelResult === undefined });
        })()
      `,
        { promise: true }
      );
      const data = JSON.parse(result as string) as { cancelResult: boolean };
      assert.strictEqual(data.cancelResult, true);
    });
  });

  describe("releaseLock", () => {
    it("releaseLock prevents further reads from that reader", async () => {
      await assert.rejects(
        context.eval(
          `
          (async () => {
            const stream = new HostBackedReadableStream();
            const streamId = stream._getStreamId();
            __Stream_push(streamId, Array.from(new TextEncoder().encode("test")));
            __Stream_close(streamId);

            const reader = stream.getReader();
            reader.releaseLock();

            // Should throw after releaseLock
            await reader.read();
          })()
        `,
          { promise: true }
        ),
        { message: "Reader has been released" }
      );
    });

    it("can get new reader after releaseLock", async () => {
      const result = await context.eval(
        `
        (async () => {
          const stream = new HostBackedReadableStream();
          const streamId = stream._getStreamId();
          __Stream_push(streamId, Array.from(new TextEncoder().encode("test")));
          __Stream_close(streamId);

          const reader1 = stream.getReader();
          reader1.releaseLock();

          const reader2 = stream.getReader();
          const { value, done } = await reader2.read();

          return JSON.stringify({
            text: new TextDecoder().decode(value),
            done,
            areDifferentReaders: reader1 !== reader2
          });
        })()
      `,
        { promise: true }
      );
      const data = JSON.parse(result as string) as {
        text: string;
        done: boolean;
        areDifferentReaders: boolean;
      };
      assert.strictEqual(data.text, "test");
      assert.strictEqual(data.done, false);
      assert.strictEqual(data.areDifferentReaders, true);
    });
  });

  describe("integration with Request", () => {
    it("Request.body is a HostBackedReadableStream", () => {
      const result = context.evalSync(`
        const request = new Request("http://test/", {
          method: "POST",
          body: "test body"
        });
        JSON.stringify({
          isHostBackedStream: request.body instanceof HostBackedReadableStream,
          hasGetReader: typeof request.body.getReader === "function"
        })
      `);
      const data = JSON.parse(result as string) as {
        isHostBackedStream: boolean;
        hasGetReader: boolean;
      };
      assert.strictEqual(data.isHostBackedStream, true);
      assert.strictEqual(data.hasGetReader, true);
    });

    it("can read Request.body via stream reader", async () => {
      const result = await context.eval(
        `
        (async () => {
          const request = new Request("http://test/", {
            method: "POST",
            body: "hello world"
          });

          const reader = request.body.getReader();
          const chunks = [];
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            chunks.push(new TextDecoder().decode(value));
          }

          return JSON.stringify({ text: chunks.join("") });
        })()
      `,
        { promise: true }
      );
      const data = JSON.parse(result as string) as { text: string };
      assert.strictEqual(data.text, "hello world");
    });
  });

  describe("async iteration", () => {
    it("supports Symbol.asyncIterator", () => {
      const result = context.evalSync(`
        const stream = new HostBackedReadableStream();
        typeof stream[Symbol.asyncIterator] === 'function'
      `);
      assert.strictEqual(result, true);
    });

    it("for await...of iterates over chunks", async () => {
      const result = await context.eval(
        `
        (async () => {
          const stream = new HostBackedReadableStream();
          const streamId = stream._getStreamId();

          __Stream_push(streamId, Array.from(new TextEncoder().encode("a")));
          __Stream_push(streamId, Array.from(new TextEncoder().encode("b")));
          __Stream_push(streamId, Array.from(new TextEncoder().encode("c")));
          __Stream_close(streamId);

          const chunks = [];
          for await (const chunk of stream) {
            chunks.push(new TextDecoder().decode(chunk));
          }
          return JSON.stringify(chunks);
        })()
      `,
        { promise: true }
      );
      assert.deepStrictEqual(JSON.parse(result as string), ["a", "b", "c"]);
    });

    it("releases lock after async iteration completes", async () => {
      const result = await context.eval(
        `
        (async () => {
          const stream = new HostBackedReadableStream();
          const streamId = stream._getStreamId();
          __Stream_push(streamId, Array.from(new TextEncoder().encode("x")));
          __Stream_close(streamId);

          for await (const chunk of stream) {
            // consume
          }
          return stream.locked;
        })()
      `,
        { promise: true }
      );
      assert.strictEqual(result, false);
    });

    it("propagates errors during async iteration", async () => {
      await assert.rejects(
        context.eval(
          `
          (async () => {
            const stream = new HostBackedReadableStream();
            const streamId = stream._getStreamId();
            __Stream_error(streamId, "iteration error");

            for await (const chunk of stream) {
              // should throw
            }
          })()
        `,
          { promise: true }
        )
      );
    });
  });
});
