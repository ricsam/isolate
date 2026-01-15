/**
 * Upload Streaming Tests
 *
 * Tests for streaming request bodies from native (Node.js) to isolate.
 *
 * Note: These tests may generate warnings about async activity after test ends.
 * This is a known limitation in the stream cleanup code (stream-state.ts) where
 * the native stream reader cancel operation is not properly awaited. The tests
 * themselves pass correctly - the warnings are informational only.
 */
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

describe("Upload Streaming", () => {
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

  afterEach(() => {
    fetchHandle.dispose();
    timersHandle.dispose();
    clearStreamRegistryForContext(context);
    context.release();
    isolate.dispose();
  });

  it("request.text() consumes streaming body", async () => {
    context.evalSync(`
      serve({
        async fetch(request) {
          const text = await request.text();
          return new Response("Received: " + text);
        }
      });
    `);

    const chunks = ["Hello ", "World ", "Stream!"];
    let index = 0;
    const stream = new ReadableStream({
      pull(controller) {
        if (index < chunks.length) {
          controller.enqueue(new TextEncoder().encode(chunks[index++]));
        } else {
          controller.close();
        }
      },
    });

    const request = new Request("http://test/", {
      method: "POST",
      body: stream,
      // @ts-expect-error Node.js requires duplex for streaming bodies
      duplex: "half",
    });
    const response = await fetchHandle.dispatchRequest(request);
    assert.strictEqual(await response.text(), "Received: Hello World Stream!");
  });

  it("request.json() consumes streaming JSON body", async () => {
    context.evalSync(`
      serve({
        async fetch(request) {
          const data = await request.json();
          return Response.json({ received: data });
        }
      });
    `);

    const jsonParts = ['{"foo":', '"bar",', '"num":', "42}"];
    let index = 0;
    const stream = new ReadableStream({
      pull(controller) {
        if (index < jsonParts.length) {
          controller.enqueue(new TextEncoder().encode(jsonParts[index++]));
        } else {
          controller.close();
        }
      },
    });

    const request = new Request("http://test/", {
      method: "POST",
      body: stream,
      headers: { "Content-Type": "application/json" },
      // @ts-expect-error Node.js requires duplex for streaming bodies
      duplex: "half",
    });

    const response = await fetchHandle.dispatchRequest(request);
    const json = (await response.json()) as { received: { foo: string; num: number } };
    assert.deepStrictEqual(json.received, { foo: "bar", num: 42 });
  });

  it("request.arrayBuffer() consumes streaming body", async () => {
    context.evalSync(`
      serve({
        async fetch(request) {
          const buffer = await request.arrayBuffer();
          return new Response("Length: " + buffer.byteLength);
        }
      });
    `);

    const data = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    let offset = 0;
    const stream = new ReadableStream({
      pull(controller) {
        if (offset < data.length) {
          controller.enqueue(data.slice(offset, offset + 3));
          offset += 3;
        } else {
          controller.close();
        }
      },
    });

    const request = new Request("http://test/", {
      method: "POST",
      body: stream,
      // @ts-expect-error Node.js requires duplex for streaming bodies
      duplex: "half",
    });
    const response = await fetchHandle.dispatchRequest(request);
    assert.strictEqual(await response.text(), "Length: 10");
  });

  it("request.body is readable stream for streaming uploads", async () => {
    context.evalSync(`
      serve({
        async fetch(request) {
          const isStream = request.body instanceof HostBackedReadableStream;
          if (!isStream) {
            return new Response("Not a stream: " + typeof request.body);
          }

          const reader = request.body.getReader();
          const chunks = [];
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            chunks.push(new TextDecoder().decode(value));
          }

          return new Response("isStream: true, text: " + chunks.join(""));
        }
      });
    `);

    let count = 0;
    const stream = new ReadableStream({
      pull(controller) {
        if (count < 3) {
          controller.enqueue(new TextEncoder().encode(`chunk${count}`));
          count++;
        } else {
          controller.close();
        }
      },
    });

    const request = new Request("http://test/", {
      method: "POST",
      body: stream,
      // @ts-expect-error Node.js requires duplex for streaming bodies
      duplex: "half",
    });
    const response = await fetchHandle.dispatchRequest(request);
    assert.strictEqual(
      await response.text(),
      "isStream: true, text: chunk0chunk1chunk2"
    );
  });

  it("large streaming upload (1MB) with backpressure", async () => {
    context.evalSync(`
      serve({
        async fetch(request) {
          const buffer = await request.arrayBuffer();
          return new Response("Bytes: " + buffer.byteLength);
        }
      });
    `);

    const chunkSize = 64 * 1024;
    const totalSize = 1024 * 1024;
    let generated = 0;

    const stream = new ReadableStream({
      pull(controller) {
        if (generated < totalSize) {
          const size = Math.min(chunkSize, totalSize - generated);
          controller.enqueue(new Uint8Array(size).fill(0x42));
          generated += size;
        } else {
          controller.close();
        }
      },
    });

    const request = new Request("http://test/", {
      method: "POST",
      body: stream,
      // @ts-expect-error Node.js requires duplex for streaming bodies
      duplex: "half",
    });
    const response = await fetchHandle.dispatchRequest(request);
    assert.strictEqual(await response.text(), "Bytes: 1048576");
  });

  it("streaming upload with multiple small chunks", async () => {
    context.evalSync(`
      serve({
        async fetch(request) {
          const reader = request.body.getReader();
          let chunkCount = 0;
          let totalBytes = 0;

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            chunkCount++;
            totalBytes += value.length;
          }

          return Response.json({ chunkCount, totalBytes });
        }
      });
    `);

    let chunksSent = 0;
    const numChunks = 10;
    const stream = new ReadableStream({
      pull(controller) {
        if (chunksSent < numChunks) {
          controller.enqueue(new Uint8Array([chunksSent]));
          chunksSent++;
        } else {
          controller.close();
        }
      },
    });

    const request = new Request("http://test/", {
      method: "POST",
      body: stream,
      // @ts-expect-error Node.js requires duplex for streaming bodies
      duplex: "half",
    });
    const response = await fetchHandle.dispatchRequest(request);
    const result = (await response.json()) as { chunkCount: number; totalBytes: number };
    assert.strictEqual(result.chunkCount, 10);
    assert.strictEqual(result.totalBytes, 10);
  });

  it("handles empty streaming body", async () => {
    context.evalSync(`
      serve({
        async fetch(request) {
          const text = await request.text();
          return new Response("Empty: " + (text.length === 0));
        }
      });
    `);

    const stream = new ReadableStream({
      start(controller) {
        controller.close();
      },
    });

    const request = new Request("http://test/", {
      method: "POST",
      body: stream,
      // @ts-expect-error Node.js requires duplex for streaming bodies
      duplex: "half",
    });
    const response = await fetchHandle.dispatchRequest(request);
    assert.strictEqual(await response.text(), "Empty: true");
  });

  it("binary data is preserved in streaming upload", async () => {
    context.evalSync(`
      serve({
        async fetch(request) {
          const buffer = await request.arrayBuffer();
          const bytes = new Uint8Array(buffer);
          const sum = bytes.reduce((a, b) => a + b, 0);
          return Response.json({
            length: buffer.byteLength,
            sum: sum
          });
        }
      });
    `);

    // Create specific binary data
    const data = new Uint8Array([0x00, 0xff, 0x80, 0x01, 0xfe]);
    let sent = false;
    const stream = new ReadableStream({
      pull(controller) {
        if (!sent) {
          controller.enqueue(data);
          sent = true;
        } else {
          controller.close();
        }
      },
    });

    const request = new Request("http://test/", {
      method: "POST",
      body: stream,
      // @ts-expect-error Node.js requires duplex for streaming bodies
      duplex: "half",
    });
    const response = await fetchHandle.dispatchRequest(request);
    const result = (await response.json()) as { length: number; sum: number };
    assert.strictEqual(result.length, 5);
    // 0x00 + 0xff + 0x80 + 0x01 + 0xfe = 0 + 255 + 128 + 1 + 254 = 638
    assert.strictEqual(result.sum, 638);
  });

  it("request with non-streaming body still works", async () => {
    context.evalSync(`
      serve({
        async fetch(request) {
          const text = await request.text();
          return new Response("Got: " + text);
        }
      });
    `);

    const request = new Request("http://test/", {
      method: "POST",
      body: "non-streaming body",
    });
    const response = await fetchHandle.dispatchRequest(request);
    assert.strictEqual(await response.text(), "Got: non-streaming body");
  });
});
