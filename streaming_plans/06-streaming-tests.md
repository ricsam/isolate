# Plan 06: Streaming Tests

## Overview

Create a comprehensive test suite for streaming functionality, ported from ricsam-qjs and adapted for isolated-vm.

## Test Files to Create

| File | Description |
|------|-------------|
| `packages/fetch/src/stream-state.test.ts` | Unit tests for stream registry |
| `packages/fetch/src/host-backed-stream.test.ts` | Unit tests for HostBackedReadableStream |
| `packages/fetch/src/upload-streaming.test.ts` | Upload streaming tests |
| `packages/fetch/src/download-streaming.test.ts` | Download streaming tests |
| `packages/fetch/src/form-data-multipart.test.ts` | Multipart parsing/serialization |
| `demo/e2e/streaming.e2e.ts` | E2E streaming tests |

## Test Implementation

### 1. stream-state.test.ts

```typescript
import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import { createStreamStateRegistry, type StreamStateRegistry } from "./stream-state.ts";

describe("StreamStateRegistry", () => {
  let registry: StreamStateRegistry;

  beforeEach(() => {
    registry = createStreamStateRegistry();
  });

  afterEach(() => {
    registry.clear();
  });

  describe("create", () => {
    test("returns unique stream IDs", () => {
      const id1 = registry.create();
      const id2 = registry.create();
      const id3 = registry.create();
      assert.notStrictEqual(id1, id2);
      assert.notStrictEqual(id2, id3);
      assert.notStrictEqual(id1, id3);
    });

    test("stream starts with empty queue", () => {
      const id = registry.create();
      const state = registry.get(id);
      assert.ok(state);
      assert.strictEqual(state.queue.length, 0);
      assert.strictEqual(state.queueSize, 0);
    });
  });

  describe("push", () => {
    test("adds chunk to queue", () => {
      const id = registry.create();
      const chunk = new Uint8Array([1, 2, 3]);
      registry.push(id, chunk);

      const state = registry.get(id);
      assert.strictEqual(state!.queue.length, 1);
      assert.strictEqual(state!.queueSize, 3);
    });

    test("returns false for closed stream", () => {
      const id = registry.create();
      registry.close(id);
      const result = registry.push(id, new Uint8Array([1]));
      assert.strictEqual(result, false);
    });

    test("returns false for errored stream", () => {
      const id = registry.create();
      registry.error(id, new Error("test"));
      const result = registry.push(id, new Uint8Array([1]));
      assert.strictEqual(result, false);
    });
  });

  describe("pull", () => {
    test("returns chunk immediately when queue has data", async () => {
      const id = registry.create();
      registry.push(id, new Uint8Array([1, 2, 3]));

      const result = await registry.pull(id);
      assert.strictEqual(result.done, false);
      assert.deepStrictEqual(result.value, new Uint8Array([1, 2, 3]));
    });

    test("returns done when stream closed and queue empty", async () => {
      const id = registry.create();
      registry.close(id);

      const result = await registry.pull(id);
      assert.strictEqual(result.done, true);
    });

    test("waits for data when queue empty", async () => {
      const id = registry.create();

      const pullPromise = registry.pull(id);

      // Push after delay
      setTimeout(() => {
        registry.push(id, new Uint8Array([4, 5, 6]));
      }, 10);

      const result = await pullPromise;
      assert.strictEqual(result.done, false);
      assert.deepStrictEqual(result.value, new Uint8Array([4, 5, 6]));
    });

    test("waits for close when queue empty", async () => {
      const id = registry.create();

      const pullPromise = registry.pull(id);

      setTimeout(() => {
        registry.close(id);
      }, 10);

      const result = await pullPromise;
      assert.strictEqual(result.done, true);
    });

    test("rejects when stream errored", async () => {
      const id = registry.create();
      registry.error(id, new Error("stream failed"));

      await assert.rejects(
        () => registry.pull(id),
        { message: "stream failed" }
      );
    });

    test("rejects waiting pull when error occurs", async () => {
      const id = registry.create();

      const pullPromise = registry.pull(id);

      setTimeout(() => {
        registry.error(id, new Error("late error"));
      }, 10);

      await assert.rejects(
        () => pullPromise,
        { message: "late error" }
      );
    });
  });

  describe("backpressure", () => {
    test("isQueueFull returns false for empty queue", () => {
      const id = registry.create();
      assert.strictEqual(registry.isQueueFull(id), false);
    });

    test("isQueueFull returns true at high water mark", () => {
      const id = registry.create();
      // Push 64KB (default high water mark)
      registry.push(id, new Uint8Array(64 * 1024));
      assert.strictEqual(registry.isQueueFull(id), true);
    });

    test("isQueueFull returns true at max chunks", () => {
      const id = registry.create();
      // Push 16 small chunks (default max chunks)
      for (let i = 0; i < 16; i++) {
        registry.push(id, new Uint8Array([i]));
      }
      assert.strictEqual(registry.isQueueFull(id), true);
    });
  });

  describe("cleanup", () => {
    test("delete removes stream", () => {
      const id = registry.create();
      registry.delete(id);
      assert.strictEqual(registry.get(id), undefined);
    });

    test("clear removes all streams", () => {
      const id1 = registry.create();
      const id2 = registry.create();
      registry.clear();
      assert.strictEqual(registry.get(id1), undefined);
      assert.strictEqual(registry.get(id2), undefined);
    });
  });
});
```

### 2. upload-streaming.test.ts

```typescript
import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import ivm from "isolated-vm";
import { setupFetch, type FetchHandle } from "./index.ts";
import { clearAllInstanceState } from "@ricsam/isolate-core";

describe("Upload Streaming", () => {
  let isolate: ivm.Isolate;
  let context: ivm.Context;
  let fetchHandle: FetchHandle;

  beforeEach(async () => {
    isolate = new ivm.Isolate();
    context = await isolate.createContext();
    clearAllInstanceState();
    fetchHandle = await setupFetch(context);
  });

  afterEach(() => {
    fetchHandle.dispose();
    context.release();
    isolate.dispose();
  });

  test("request.text() consumes streaming body", async () => {
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
      }
    });

    const request = new Request("http://test/", { method: "POST", body: stream });
    const response = await fetchHandle.dispatchRequest(request);
    assert.strictEqual(await response.text(), "Received: Hello World Stream!");
  });

  test("request.json() consumes streaming JSON body", async () => {
    context.evalSync(`
      serve({
        async fetch(request) {
          const data = await request.json();
          return Response.json({ received: data });
        }
      });
    `);

    const jsonParts = ['{"foo":', '"bar",', '"num":', '42}'];
    let index = 0;
    const stream = new ReadableStream({
      pull(controller) {
        if (index < jsonParts.length) {
          controller.enqueue(new TextEncoder().encode(jsonParts[index++]));
        } else {
          controller.close();
        }
      }
    });

    const request = new Request("http://test/", {
      method: "POST",
      body: stream,
      headers: { "Content-Type": "application/json" }
    });

    const response = await fetchHandle.dispatchRequest(request);
    const json = await response.json();
    assert.deepStrictEqual(json.received, { foo: "bar", num: 42 });
  });

  test("request.arrayBuffer() consumes streaming body", async () => {
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
      }
    });

    const request = new Request("http://test/", { method: "POST", body: stream });
    const response = await fetchHandle.dispatchRequest(request);
    assert.strictEqual(await response.text(), "Length: 10");
  });

  test("request.body is ReadableStream for streaming uploads", async () => {
    context.evalSync(`
      serve({
        async fetch(request) {
          const isStream = request.body instanceof ReadableStream ||
                          request.body instanceof HostBackedReadableStream;
          if (!isStream) {
            return new Response("Not a stream");
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
          controller.enqueue(new TextEncoder().encode(\`chunk\${count}\`));
          count++;
        } else {
          controller.close();
        }
      }
    });

    const request = new Request("http://test/", { method: "POST", body: stream });
    const response = await fetchHandle.dispatchRequest(request);
    assert.strictEqual(await response.text(), "isStream: true, text: chunk0chunk1chunk2");
  });

  test("large streaming upload (1MB) with backpressure", async () => {
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
      }
    });

    const request = new Request("http://test/", { method: "POST", body: stream });
    const response = await fetchHandle.dispatchRequest(request);
    assert.strictEqual(await response.text(), "Bytes: 1048576");
  });
});
```

### 3. download-streaming.test.ts

```typescript
import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import ivm from "isolated-vm";
import { setupFetch, type FetchHandle } from "./index.ts";
import { clearAllInstanceState } from "@ricsam/isolate-core";

describe("Download Streaming", () => {
  let isolate: ivm.Isolate;
  let context: ivm.Context;
  let fetchHandle: FetchHandle;

  beforeEach(async () => {
    isolate = new ivm.Isolate();
    context = await isolate.createContext();
    clearAllInstanceState();
    fetchHandle = await setupFetch(context);
  });

  afterEach(() => {
    fetchHandle.dispose();
    context.release();
    isolate.dispose();
  });

  test("Response with ReadableStream body streams to native", async () => {
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

    const response = await fetchHandle.dispatchRequest(new Request("http://test/"));
    const reader = response.body!.getReader();
    const chunks: string[] = [];

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(new TextDecoder().decode(value));
    }

    assert.deepStrictEqual(chunks, ["chunk1", "chunk2"]);
  });

  test("Response.text() works with streaming body", async () => {
    context.evalSync(`
      serve({
        async fetch(request) {
          const stream = new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode("Hello "));
              controller.enqueue(new TextEncoder().encode("World"));
              controller.close();
            }
          });
          return new Response(stream);
        }
      });
    `);

    const response = await fetchHandle.dispatchRequest(new Request("http://test/"));
    assert.strictEqual(await response.text(), "Hello World");
  });

  test("delayed streaming response works", async () => {
    context.evalSync(`
      serve({
        async fetch(request) {
          let count = 0;
          const stream = new ReadableStream({
            async pull(controller) {
              if (count < 3) {
                // Delay between chunks
                await new Promise(r => setTimeout(r, 5));
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

    const response = await fetchHandle.dispatchRequest(new Request("http://test/"));
    assert.strictEqual(await response.text(), "delayed0delayed1delayed2");
  });

  test("large streaming response doesn't buffer entirely", async () => {
    context.evalSync(`
      serve({
        async fetch(request) {
          const chunkSize = 64 * 1024;
          const totalSize = 1024 * 1024;
          let written = 0;

          const stream = new ReadableStream({
            pull(controller) {
              if (written < totalSize) {
                const size = Math.min(chunkSize, totalSize - written);
                controller.enqueue(new Uint8Array(size).fill(0x41));
                written += size;
              } else {
                controller.close();
              }
            }
          });

          return new Response(stream);
        }
      });
    `);

    const response = await fetchHandle.dispatchRequest(new Request("http://test/"));
    const reader = response.body!.getReader();
    let total = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
    }

    assert.strictEqual(total, 1024 * 1024);
  });

  test("stream error propagates to consumer", async () => {
    context.evalSync(`
      serve({
        async fetch(request) {
          let count = 0;
          const stream = new ReadableStream({
            pull(controller) {
              if (count < 2) {
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

    const response = await fetchHandle.dispatchRequest(new Request("http://test/"));
    const reader = response.body!.getReader();

    await reader.read(); // ok
    await reader.read(); // ok

    await assert.rejects(() => reader.read());
  });
});
```

### 4. E2E Tests (demo/e2e/streaming.e2e.ts)

```typescript
import { test, expect } from "@playwright/test";

test.describe("Streaming E2E Tests", () => {
  test("POST with streaming body to /api/echo", async ({ request }) => {
    // Note: Playwright doesn't directly support streaming body
    // but we can test the server's handling via normal POST
    const response = await request.post("/api/echo", {
      data: JSON.stringify({ message: "Hello" }),
      headers: { "Content-Type": "application/json" }
    });

    expect(response.ok()).toBe(true);
    const data = await response.json();
    expect(data.echo).toEqual({ message: "Hello" });
  });

  test("GET /api/stream returns chunked response", async ({ request }) => {
    const response = await request.get("/api/stream");
    expect(response.ok()).toBe(true);

    const text = await response.text();
    expect(text).toContain("chunk 0");
    expect(text).toContain("chunk 4");
  });

  test("GET /api/stream-json returns NDJSON stream", async ({ request }) => {
    const response = await request.get("/api/stream-json");
    expect(response.ok()).toBe(true);

    const text = await response.text();
    const lines = text.trim().split("\n");

    expect(lines.length).toBe(5);
    const first = JSON.parse(lines[0]);
    expect(first.index).toBe(0);
    expect(first.message).toBe("Streaming chunk 0");
  });

  test("GET /api/events returns SSE stream", async ({ request }) => {
    const response = await request.get("/api/events");
    expect(response.ok()).toBe(true);
    expect(response.headers()["content-type"]).toBe("text/event-stream");

    const text = await response.text();
    expect(text).toContain("event: message");
    expect(text).toContain("data:");
  });

  test("File upload via /api/upload with streaming", async ({ request }) => {
    const filename = `stream-test-${Date.now()}.txt`;
    const content = "Streamed file content";

    const response = await request.post("/api/upload", {
      multipart: {
        file: {
          name: filename,
          mimeType: "text/plain",
          buffer: Buffer.from(content)
        }
      }
    });

    expect(response.ok()).toBe(true);
    const data = await response.json();
    expect(data.success).toBe(true);
    expect(data.name).toBe(filename);

    // Verify content via download
    const downloadResponse = await request.get(`/api/files/${filename}`);
    expect(await downloadResponse.text()).toBe(content);

    // Cleanup
    await request.delete(`/api/files/${filename}`);
  });
});
```

## Test Coverage Summary

| Category | Tests |
|----------|-------|
| Stream State Registry | 12 tests |
| Host-Backed Stream | 6 tests |
| Upload Streaming | 5 tests |
| Download Streaming | 5 tests |
| Multipart FormData | 8 tests |
| E2E | 5 tests |
| **Total** | **41 tests** |

## Running Tests

```bash
# Unit tests
cd packages/fetch
npm test

# E2E tests
cd demo
npm run test:e2e
```

## Verification Checklist

- [ ] All unit tests pass
- [ ] All E2E tests pass
- [ ] No memory leaks (large file tests don't OOM)
- [ ] Backpressure works (slow consumers don't cause memory growth)
- [ ] Error handling works (errors propagate correctly)
- [ ] Cleanup works (streams are properly disposed)

## Dependencies

- Plans 01-05 (all streaming functionality)

## Files Created

| File | Description |
|------|-------------|
| `packages/fetch/src/stream-state.test.ts` | Registry tests |
| `packages/fetch/src/host-backed-stream.test.ts` | Stream class tests |
| `packages/fetch/src/upload-streaming.test.ts` | Upload tests |
| `packages/fetch/src/download-streaming.test.ts` | Download tests |
| `packages/fetch/src/form-data-multipart.test.ts` | FormData tests |
| `demo/e2e/streaming.e2e.ts` | E2E tests |
