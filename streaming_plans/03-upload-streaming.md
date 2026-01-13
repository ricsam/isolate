# Plan 03: Upload Streaming (Native → Isolate)

**Status: ✅ Implemented**

## Overview

Implement streaming for Request bodies where native `ReadableStream` data flows chunk-by-chunk into the isolate without full buffering.

## Problem

Currently, when `dispatchRequest(request)` is called with a streaming body:
1. The entire body is consumed and buffered
2. Then sent to the isolate as a JSON-encoded byte array
3. The isolate handler receives the buffered body

This fails for large uploads (memory issues) and breaks streaming semantics.

## Solution

1. Create a `HostBackedReadableStream` in the isolate
2. Start background reader that pushes from native stream to host queue
3. Isolate's Request.body returns the host-backed stream
4. Handler code reads lazily from the stream

## Data Flow

```
Native Request.body (ReadableStream)
          │
          ▼
┌─────────────────────────────┐
│  startNativeStreamReader() │  Background async loop
│  - reader.read()           │
│  - Respect backpressure    │
│  - Push to host queue      │
└─────────────────────────────┘
          │
          ▼
┌─────────────────────────────┐
│  Host Stream Registry      │
│  queue: [chunk1, chunk2...] │
└─────────────────────────────┘
          │
          ▼
┌─────────────────────────────┐
│  Isolate Request.body      │
│  HostBackedReadableStream  │
│  - getReader().read()      │
│  - Pulls from host queue   │
└─────────────────────────────┘
          │
          ▼
    Handler Code
    await request.text()
    await request.arrayBuffer()
    await request.json()
```

## Implementation

### 1. Native Stream Reader Function

Add to `packages/fetch/src/stream-state.ts`:

```typescript
/**
 * Start reading from a native ReadableStream and push to host queue.
 * Respects backpressure by pausing when queue is full.
 *
 * @param nativeStream The native ReadableStream to read from
 * @param streamId The stream ID in the registry
 * @param registry The stream state registry
 * @returns Cleanup function to cancel the reader
 */
export function startNativeStreamReader(
  nativeStream: ReadableStream<Uint8Array>,
  streamId: number,
  registry: StreamStateRegistry
): () => void {
  let cancelled = false;
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;

  const CHUNK_SIZE = 64 * 1024; // 64KB chunks

  async function readLoop() {
    try {
      reader = nativeStream.getReader();

      while (!cancelled) {
        // Respect backpressure
        while (registry.isQueueFull(streamId) && !cancelled) {
          await new Promise(r => setTimeout(r, 1));
        }
        if (cancelled) break;

        const { done, value } = await reader.read();

        if (done) {
          registry.close(streamId);
          break;
        }

        if (value) {
          // Split large chunks into smaller pieces
          if (value.length > CHUNK_SIZE) {
            for (let offset = 0; offset < value.length; offset += CHUNK_SIZE) {
              const chunk = value.slice(offset, Math.min(offset + CHUNK_SIZE, value.length));
              registry.push(streamId, chunk);
            }
          } else {
            registry.push(streamId, value);
          }
        }
      }
    } catch (error) {
      registry.error(streamId, error);
    } finally {
      if (reader) {
        try {
          reader.releaseLock();
        } catch {}
      }
    }
  }

  // Start the read loop
  readLoop();

  // Return cleanup function
  return () => {
    cancelled = true;
    if (reader) {
      try {
        reader.cancel();
      } catch {}
    }
  };
}
```

### 2. Update dispatchRequest

Modify `dispatchRequest()` in `packages/fetch/src/index.ts`:

```typescript
async dispatchRequest(request: Request): Promise<Response> {
  // ... existing code to get serve handler ...

  let requestStreamId: number | null = null;
  let streamCleanup: (() => void) | null = null;

  // Handle streaming request body
  if (request.body) {
    // Create a stream in the registry for the request body
    requestStreamId = streamRegistry.create();

    // Start background reader
    streamCleanup = startNativeStreamReader(
      request.body,
      requestStreamId,
      streamRegistry
    );
  }

  try {
    // Create Request in isolate with stream ID
    const headersJson = JSON.stringify([...request.headers.entries()]);
    const requestInstanceId = context.evalSync(`
      (() => {
        const headers = new Headers(${headersJson});
        const streamId = ${requestStreamId};
        const request = Request._createWithStreamBody(
          "${request.url}",
          "${request.method}",
          headers,
          streamId
        );
        return request._getInstanceId();
      })()
    `);

    // Call serve handler
    const responseInstanceId = await context.eval(`
      (async () => {
        const request = Request._fromInstanceId(${requestInstanceId});
        const response = await __serveHandler(request);
        return response._getInstanceId();
      })()
    `, { promise: true });

    // ... convert response and return ...

  } finally {
    // Cleanup: cancel stream reader if still running
    if (streamCleanup) {
      streamCleanup();
    }
    // Delete stream from registry
    if (requestStreamId !== null) {
      streamRegistry.delete(requestStreamId);
    }
  }
}
```

### 3. Request Class Updates

Add static method to create Request with stream body:

```javascript
// In requestCode:
static _createWithStreamBody(url, method, headers, streamId) {
  const request = new Request(url, { method, headers });
  // Store stream ID for body getter
  request.#streamId = streamId;
  return request;
}

get body() {
  if (this.#streamId !== null) {
    return HostBackedReadableStream._fromStreamId(this.#streamId);
  }
  // Fallback to existing buffered body logic
  // ...
}
```

### 4. Body Consumption Methods

Update `text()`, `arrayBuffer()`, `json()`, `blob()` to consume streaming body:

```javascript
// In requestCode:
async text() {
  try {
    __Request_markBodyUsed(this.#instanceId);
  } catch (err) {
    throw __decodeError(err);
  }

  if (this.#streamId !== null) {
    // Consume streaming body
    const reader = this.body.getReader();
    const chunks = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }
    // Concatenate and decode
    const total = chunks.reduce((s, c) => s + c.length, 0);
    const result = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      result.set(chunk, offset);
      offset += chunk.length;
    }
    return new TextDecoder().decode(result);
  }

  // Fallback to host callback for buffered body
  return __Request_text(this.#instanceId);
}

async arrayBuffer() {
  try {
    __Request_markBodyUsed(this.#instanceId);
  } catch (err) {
    throw __decodeError(err);
  }

  if (this.#streamId !== null) {
    // Consume streaming body
    const reader = this.body.getReader();
    const chunks = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }
    // Concatenate
    const total = chunks.reduce((s, c) => s + c.length, 0);
    const result = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      result.set(chunk, offset);
      offset += chunk.length;
    }
    return result.buffer;
  }

  return __Request_arrayBuffer(this.#instanceId);
}

async json() {
  const text = await this.text();
  return JSON.parse(text);
}

async blob() {
  const buffer = await this.arrayBuffer();
  const contentType = this.headers.get('content-type') || '';
  return new Blob([buffer], { type: contentType });
}
```

## Testing

### Unit Tests

```typescript
describe("Upload Streaming", () => {
  test("streaming request body consumed via text()", async () => {
    // Create native streaming request
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

    const request = new Request("http://test/", {
      method: "POST",
      body: stream
    });

    // Setup serve handler
    ctx.context.evalSync(`
      serve({
        async fetch(request) {
          const text = await request.text();
          return new Response("Received: " + text);
        }
      });
    `);

    const response = await fetchHandle.dispatchRequest(request);
    expect(await response.text()).toBe("Received: Hello World Stream!");
  });

  test("streaming request body consumed via arrayBuffer()", async () => {
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

    const request = new Request("http://test/", {
      method: "POST",
      body: stream
    });

    ctx.context.evalSync(`
      serve({
        async fetch(request) {
          const buffer = await request.arrayBuffer();
          return new Response("Length: " + buffer.byteLength);
        }
      });
    `);

    const response = await fetchHandle.dispatchRequest(request);
    expect(await response.text()).toBe("Length: 10");
  });

  test("request.body returns ReadableStream for streaming uploads", async () => {
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("chunk1"));
        controller.enqueue(new TextEncoder().encode("chunk2"));
        controller.close();
      }
    });

    const request = new Request("http://test/", {
      method: "POST",
      body: stream
    });

    ctx.context.evalSync(`
      serve({
        async fetch(request) {
          const isStream = request.body instanceof ReadableStream ||
                          request.body instanceof HostBackedReadableStream;
          const reader = request.body.getReader();
          const chunks = [];
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            // Convert to string
            let str = "";
            for (let i = 0; i < value.length; i++) {
              str += String.fromCharCode(value[i]);
            }
            chunks.push(str);
          }
          return new Response("isStream: " + isStream + ", text: " + chunks.join(""));
        }
      });
    `);

    const response = await fetchHandle.dispatchRequest(request);
    expect(await response.text()).toBe("isStream: true, text: chunk1chunk2");
  });

  test("large streaming upload (1MB) with backpressure", async () => {
    const chunkSize = 64 * 1024; // 64KB
    const totalSize = 1024 * 1024; // 1MB
    let bytesGenerated = 0;

    const stream = new ReadableStream({
      pull(controller) {
        if (bytesGenerated < totalSize) {
          const size = Math.min(chunkSize, totalSize - bytesGenerated);
          controller.enqueue(new Uint8Array(size).fill(0x42));
          bytesGenerated += size;
        } else {
          controller.close();
        }
      }
    });

    const request = new Request("http://test/", {
      method: "POST",
      body: stream
    });

    ctx.context.evalSync(`
      serve({
        async fetch(request) {
          const buffer = await request.arrayBuffer();
          return new Response("Bytes: " + buffer.byteLength);
        }
      });
    `);

    const response = await fetchHandle.dispatchRequest(request);
    expect(await response.text()).toBe("Bytes: 1048576");
  });
});
```

## Verification

1. Small streaming uploads work correctly
2. Large (1MB+) uploads don't cause memory issues
3. Backpressure is respected (producer slows when queue full)
4. Cleanup happens on completion/error
5. All existing tests still pass

## Dependencies

- Plan 01: Stream State Registry
- Plan 02: Host-Backed ReadableStream

## Files Modified/Created

| File | Action |
|------|--------|
| `packages/fetch/src/stream-state.ts` | ✅ Modified - added `startNativeStreamReader` function |
| `packages/fetch/src/index.ts` | ✅ Modified - updated `RequestState` interface with `streamId` |
| `packages/fetch/src/index.ts` | ✅ Modified - added `__Request_getStreamId` callback |
| `packages/fetch/src/index.ts` | ✅ Modified - updated Request class (`body`, `text()`, `arrayBuffer()`) |
| `packages/fetch/src/index.ts` | ✅ Modified - updated `dispatchRequest` for streaming |
| `packages/fetch/src/request.test.ts` | ✅ Modified - updated test for `HostBackedReadableStream` |

## Notes

### Memory Efficiency

With this implementation:
- Native stream is read in 64KB chunks
- Chunks are pushed to host queue (max ~1MB when full)
- Isolate pulls chunks as needed
- Maximum memory overhead: ~1-2MB regardless of upload size

### Timeout Considerations

For very large uploads, the overall request might take a long time. Consider adding:
- Progress events
- Timeout handling
- Cancellation support

### Content-Length Header

When using streaming bodies:
- The Content-Length header may not be set (unknown size)
- `Transfer-Encoding: chunked` semantics apply
- Handler code should not rely on Content-Length for streaming uploads
