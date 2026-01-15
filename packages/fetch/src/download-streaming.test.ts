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

describe("Download Streaming", () => {
  let isolate: ivm.Isolate;
  let context: ivm.Context;
  let fetchHandle: FetchHandle;
  let timersHandle: TimersHandle;

  beforeEach(async () => {
    isolate = new ivm.Isolate();
    context = await isolate.createContext();
    clearAllInstanceState();

    // Setup timers first (needed for setTimeout in stream pump)
    timersHandle = await setupTimers(context);

    // Then setup fetch
    fetchHandle = await setupFetch(context);
  });

  afterEach(async () => {
    fetchHandle.dispose();
    timersHandle.dispose();
    clearStreamRegistryForContext(context);
    context.release();
    isolate.dispose();
  });

  it("Response with ReadableStream body (sync start) streams to native", async () => {
    context.evalSync(`
      serve({
        async fetch(request) {
          const stream = new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode("chunk1"));
              controller.enqueue(new TextEncoder().encode("chunk2"));
              controller.close();
            }
          });
          return new Response(stream);
        }
      });
    `);

    const response = await fetchHandle.dispatchRequest(
      new Request("http://test/"),
      {}
    );

    const text = await response.text();
    assert.strictEqual(text, "chunk1chunk2");
  });

  it("Response with ReadableStream body (pull-based) streams to native", async () => {
    context.evalSync(`
      serve({
        async fetch(request) {
          let count = 0;
          const stream = new ReadableStream({
            pull(controller) {
              if (count < 3) {
                controller.enqueue(new TextEncoder().encode("chunk" + count));
                count++;
              } else {
                controller.close();
              }
            }
          });
          return new Response(stream);
        }
      });
    `);

    const response = await fetchHandle.dispatchRequest(
      new Request("http://test/"),
      {}
    );

    const text = await response.text();
    assert.strictEqual(text, "chunk0chunk1chunk2");
  });

  it("Response with HostBackedReadableStream body streams to native", async () => {
    context.evalSync(`
      serve({
        async fetch(request) {
          // Create a HostBackedReadableStream manually
          const stream = new HostBackedReadableStream();
          const streamId = stream._getStreamId();

          // Push data directly to the stream
          __Stream_push(streamId, Array.from(new TextEncoder().encode("host")));
          __Stream_push(streamId, Array.from(new TextEncoder().encode("backed")));
          __Stream_close(streamId);

          return new Response(stream);
        }
      });
    `);

    const response = await fetchHandle.dispatchRequest(
      new Request("http://test/"),
      {}
    );

    const text = await response.text();
    assert.strictEqual(text, "hostbacked");
  });

  it("delayed streaming response with setTimeout works", async () => {
    context.evalSync(`
      serve({
        async fetch(request) {
          let count = 0;
          const stream = new ReadableStream({
            async pull(controller) {
              if (count < 3) {
                await new Promise(r => setTimeout(r, 10));
                controller.enqueue(new TextEncoder().encode("delayed" + count));
                count++;
              } else {
                controller.close();
              }
            }
          });
          return new Response(stream);
        }
      });
    `);

    const response = await fetchHandle.dispatchRequest(
      new Request("http://test/"),
      {}
    );

    const text = await response.text();
    assert.strictEqual(text, "delayed0delayed1delayed2");
  });

  it("streaming response preserves headers", async () => {
    context.evalSync(`
      serve({
        async fetch(request) {
          const stream = new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode("test"));
              controller.close();
            }
          });
          return new Response(stream, {
            status: 201,
            statusText: "Created",
            headers: {
              "Content-Type": "text/plain",
              "X-Custom": "value"
            }
          });
        }
      });
    `);

    const response = await fetchHandle.dispatchRequest(
      new Request("http://test/"),
      {}
    );

    assert.strictEqual(response.status, 201);
    assert.strictEqual(response.headers.get("Content-Type"), "text/plain");
    assert.strictEqual(response.headers.get("X-Custom"), "value");
    assert.strictEqual(await response.text(), "test");
  });

  it("stream error propagates to native consumer", async () => {
    context.evalSync(`
      serve({
        async fetch(request) {
          let count = 0;
          const stream = new ReadableStream({
            pull(controller) {
              if (count < 1) {
                controller.enqueue(new TextEncoder().encode("ok"));
                count++;
              } else {
                controller.error(new Error("Stream failed"));
              }
            }
          });
          return new Response(stream);
        }
      });
    `);

    const response = await fetchHandle.dispatchRequest(
      new Request("http://test/"),
      {}
    );

    // The first chunk should be readable
    const reader = response.body!.getReader();
    const firstRead = await reader.read();
    assert.strictEqual(firstRead.done, false);
    assert.deepStrictEqual(
      new TextDecoder().decode(firstRead.value),
      "ok"
    );

    // Second read should throw
    await assert.rejects(reader.read());
  });

  it("multiple chunks read sequentially", async () => {
    context.evalSync(`
      serve({
        async fetch(request) {
          const stream = new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode("a"));
              controller.enqueue(new TextEncoder().encode("b"));
              controller.enqueue(new TextEncoder().encode("c"));
              controller.close();
            }
          });
          return new Response(stream);
        }
      });
    `);

    const response = await fetchHandle.dispatchRequest(
      new Request("http://test/"),
      {}
    );

    const reader = response.body!.getReader();
    const chunks: string[] = [];

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(new TextDecoder().decode(value));
    }

    assert.deepStrictEqual(chunks, ["a", "b", "c"]);
  });

  it("non-streaming response still works", async () => {
    context.evalSync(`
      serve({
        async fetch(request) {
          return new Response("buffered response");
        }
      });
    `);

    const response = await fetchHandle.dispatchRequest(
      new Request("http://test/")
    );

    assert.strictEqual(await response.text(), "buffered response");
  });

  it("Response.json() still works", async () => {
    context.evalSync(`
      serve({
        async fetch(request) {
          return Response.json({ hello: "world" });
        }
      });
    `);

    const response = await fetchHandle.dispatchRequest(
      new Request("http://test/")
    );

    const data = await response.json();
    assert.deepStrictEqual(data, { hello: "world" });
  });
});
