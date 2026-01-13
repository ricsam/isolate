# Plan 04: Download Streaming (Isolate → Native)

## Overview

Implement streaming for Response bodies where isolate-generated `ReadableStream` data flows chunk-by-chunk to native code without full buffering.

## Problem

Currently, when an isolate handler returns a Response with a body:
1. The entire body is buffered in the isolate
2. Converted to a byte array
3. Sent to host via callback
4. Host creates native Response with buffered body

This fails for large responses (memory issues) and breaks streaming semantics.

## Solution

1. Detect when Response has a `ReadableStream` body
2. Create a host stream ID for the response body
3. Return a native `ReadableStream` that polls the isolate's stream
4. Isolate pushes chunks to the host queue as they're generated

## Data Flow

```
Isolate Handler
new Response(new ReadableStream({...}))
          │
          ▼
┌─────────────────────────────┐
│  Response Constructor      │
│  - Detect ReadableStream   │
│  - Create host stream ID   │
│  - Store streamId in state │
└─────────────────────────────┘
          │
          ▼
┌─────────────────────────────┐
│  dispatchRequest returns   │
│  - Gets streamId from state│
│  - Creates native stream   │
└─────────────────────────────┘
          │
          ▼
┌─────────────────────────────┐
│  Native ReadableStream     │
│  - pull() reads from queue │
│  - Triggers isolate code   │
│  - Gets chunks lazily      │
└─────────────────────────────┘
          │
          ▼
    Native Consumer
    response.body.getReader()
    await response.text()
```

## Implementation

### 1. Response with ReadableStream Body

Update Response constructor to handle ReadableStream:

```javascript
// In responseCode:
class Response {
  #instanceId;
  #headers;
  #streamId = null;  // NEW: for streaming bodies
  #bodyStream = null; // NEW: reference to the original stream

  constructor(body, init = {}) {
    // Handle internal construction from instance ID
    if (typeof body === 'number' && init === null) {
      this.#instanceId = body;
      this.#headers = new Headers(__Response_get_headers(body));
      this.#streamId = __Response_getStreamId(body);
      return;
    }

    // Check if body is a ReadableStream
    if (body instanceof ReadableStream || body instanceof HostBackedReadableStream) {
      // Create a host stream for this response
      this.#streamId = __Stream_create();
      this.#bodyStream = body;

      // Start background task to pump from source stream to host queue
      this._startStreamPump();

      // Create Response state with null body but with stream ID
      const status = init.status ?? 200;
      const statusText = init.statusText ?? '';
      const headers = new Headers(init.headers);
      const headersArray = Array.from(headers.entries());

      this.#instanceId = __Response_constructStreaming(
        this.#streamId,
        status,
        statusText,
        headersArray
      );
      this.#headers = headers;
      return;
    }

    // ... existing non-streaming body handling ...
    const bodyBytes = __prepareBody(body);
    const status = init.status ?? 200;
    const statusText = init.statusText ?? '';
    const headers = new Headers(init.headers);
    const headersArray = Array.from(headers.entries());

    this.#instanceId = __Response_construct(bodyBytes, status, statusText, headersArray);
    this.#headers = headers;
  }

  async _startStreamPump() {
    if (!this.#bodyStream) return;

    try {
      const reader = this.#bodyStream.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          __Stream_close(this.#streamId);
          break;
        }
        if (value) {
          // Push chunk to host queue
          __Stream_push(this.#streamId, Array.from(value));
        }
      }
    } catch (error) {
      __Stream_error(this.#streamId, String(error));
    }
  }

  // ... rest of Response class ...
}
```

### 2. Host-Side Streaming Response State

Add new response constructor for streaming:

```typescript
// In setupResponse():
global.setSync(
  "__Response_constructStreaming",
  new ivm.Callback(
    (
      streamId: number,
      status: number,
      statusText: string,
      headers: [string, string][]
    ) => {
      const instanceId = nextInstanceId++;
      const state: ResponseState = {
        status,
        statusText,
        headers,
        body: null,  // No buffered body
        bodyUsed: false,
        type: "default",
        url: "",
        redirected: false,
        streamId,  // NEW: stream ID for streaming body
      };
      stateMap.set(instanceId, state);
      return instanceId;
    }
  )
);
```

### 3. Native Stream Creation from Isolate Stream

Add function to create native `ReadableStream` that polls isolate stream:

```typescript
// In packages/fetch/src/stream-state.ts:

/**
 * Create a native ReadableStream that reads from a host stream registry.
 * This is used for Response streaming from isolate to native.
 */
export function createNativeStreamFromRegistry(
  streamId: number,
  registry: StreamStateRegistry,
  context: ivm.Context
): ReadableStream<Uint8Array> {
  let done = false;

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      while (!done) {
        // Execute pending jobs in isolate to allow stream pump to run
        try {
          // Note: isolated-vm doesn't have executePendingJobs
          // Instead, we rely on async operations naturally yielding
        } catch {}

        try {
          const result = await registry.pull(streamId);

          if (result.done) {
            controller.close();
            done = true;
            return;
          }

          controller.enqueue(result.value);
          return;
        } catch (error) {
          controller.error(error);
          done = true;
          return;
        }
      }
    },

    cancel() {
      done = true;
      registry.error(streamId, new Error("Stream cancelled by consumer"));
    }
  });
}
```

### 4. Update dispatchRequest for Streaming Response

```typescript
// In dispatchRequest():
async dispatchRequest(request: Request): Promise<Response> {
  // ... handle request ...

  // Get response instance ID
  const responseInstanceId = await context.eval(`
    (async () => {
      const request = Request._fromInstanceId(${requestInstanceId});
      const response = await __serveHandler(request);
      return response._getInstanceId();
    })()
  `, { promise: true }) as number;

  // Get response state
  const state = stateMap.get(responseInstanceId) as ResponseState;
  if (!state) {
    throw new Error("Response state not found");
  }

  // Check if response has streaming body
  if (state.streamId !== null) {
    // Create native stream from registry
    const nativeStream = createNativeStreamFromRegistry(
      state.streamId,
      streamRegistry,
      context
    );

    return new Response(nativeStream, {
      status: state.status,
      statusText: state.statusText,
      headers: state.headers,
    });
  }

  // Fallback: buffered body
  const body = state.body
    ? new Uint8Array(state.body).buffer
    : null;

  return new Response(body, {
    status: state.status,
    statusText: state.statusText,
    headers: state.headers,
  });
}
```

### 5. Isolate Async Execution Handling

The challenge with isolated-vm is that we need to keep the isolate running while the stream pump pushes data. This requires careful handling:

```typescript
// In dispatchRequest(), after calling serve handler:

// For streaming responses, we need to continue pumping the isolate
// while the native consumer reads from the stream
if (state.streamId !== null) {
  // Create a promise that resolves when stream is done
  const streamDonePromise = new Promise<void>((resolve, reject) => {
    const checkDone = () => {
      const streamState = streamRegistry.get(state.streamId!);
      if (!streamState || streamState.closed || streamState.errored) {
        resolve();
        return;
      }
      // Continue checking (with timeout to prevent busy-wait)
      setTimeout(checkDone, 10);
    };
    checkDone();
  });

  // Create native stream that also pumps isolate
  const nativeStream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      // Check if there's pending work in isolate
      // This is where we'd pump the event loop if we could

      try {
        const result = await streamRegistry.pull(state.streamId!);
        if (result.done) {
          controller.close();
          return;
        }
        controller.enqueue(result.value);
      } catch (error) {
        controller.error(error);
      }
    }
  });

  return new Response(nativeStream, { ... });
}
```

### Alternative Approach: Tick-Based Pumping

Since isolated-vm doesn't have `executePendingJobs`, we can use the timer tick mechanism:

```typescript
// Modified stream pump in isolate (using setTimeout):
async _startStreamPump() {
  if (!this.#bodyStream) return;

  const reader = this.#bodyStream.getReader();
  const streamId = this.#streamId;

  const pumpChunk = async () => {
    try {
      const { done, value } = await reader.read();
      if (done) {
        __Stream_close(streamId);
        return;
      }
      if (value) {
        __Stream_push(streamId, Array.from(value));
      }
      // Schedule next pump via setTimeout (will be processed by tick)
      setTimeout(pumpChunk, 0);
    } catch (error) {
      __Stream_error(streamId, String(error));
    }
  };

  // Start pumping
  setTimeout(pumpChunk, 0);
}
```

On host side, use `tick()` to process timers:

```typescript
// In dispatchRequest or dedicated pump loop:
const tickInterval = setInterval(async () => {
  await runtime.tick(0);
}, 1);

// Clean up when stream is done
streamDonePromise.then(() => {
  clearInterval(tickInterval);
});
```

## Testing

### Unit Tests

```typescript
describe("Download Streaming", () => {
  test("Response with ReadableStream body streams to native", async () => {
    ctx.context.evalSync(`
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
      new Request("http://test/")
    );

    // Read via native stream
    const reader = response.body!.getReader();
    const chunks: string[] = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(new TextDecoder().decode(value));
    }

    expect(chunks).toEqual(["chunk1", "chunk2"]);
  });

  test("delayed streaming response works", async () => {
    ctx.context.evalSync(`
      serve({
        async fetch(request) {
          let count = 0;
          const stream = new ReadableStream({
            async pull(controller) {
              if (count < 3) {
                await new Promise(r => setTimeout(r, 10));
                controller.enqueue(
                  new TextEncoder().encode("delayed" + count)
                );
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
      new Request("http://test/")
    );

    const text = await response.text();
    expect(text).toBe("delayed0delayed1delayed2");
  });

  test("large streaming response (1MB) doesn't buffer entirely", async () => {
    ctx.context.evalSync(`
      serve({
        async fetch(request) {
          const chunkSize = 64 * 1024;
          const totalSize = 1024 * 1024;
          let bytesWritten = 0;

          const stream = new ReadableStream({
            pull(controller) {
              if (bytesWritten < totalSize) {
                const size = Math.min(chunkSize, totalSize - bytesWritten);
                controller.enqueue(new Uint8Array(size).fill(0x41));
                bytesWritten += size;
              } else {
                controller.close();
              }
            }
          });

          return new Response(stream, {
            headers: { "Content-Length": String(totalSize) }
          });
        }
      });
    `);

    const response = await fetchHandle.dispatchRequest(
      new Request("http://test/")
    );

    // Count bytes via streaming (don't buffer in test)
    const reader = response.body!.getReader();
    let totalBytes = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.length;
    }

    expect(totalBytes).toBe(1024 * 1024);
  });

  test("stream error propagates to native consumer", async () => {
    ctx.context.evalSync(`
      serve({
        async fetch(request) {
          let count = 0;
          const stream = new ReadableStream({
            pull(controller) {
              if (count < 2) {
                controller.enqueue(new TextEncoder().encode("ok" + count));
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
      new Request("http://test/")
    );

    const reader = response.body!.getReader();

    // First two chunks should succeed
    await reader.read(); // ok0
    await reader.read(); // ok1

    // Third read should fail
    await expect(reader.read()).rejects.toThrow();
  });
});
```

## Verification

1. Simple streaming responses work
2. Delayed (async) streaming responses work
3. Large responses don't cause memory issues
4. Errors propagate correctly
5. Stream cancellation works
6. Timer tick mechanism properly drives stream pump

## Dependencies

- Plan 01: Stream State Registry
- Plan 02: Host-Backed ReadableStream
- Plan 03: Upload Streaming (for bidirectional streaming tests)

## Files Modified/Created

| File | Action |
|------|--------|
| `packages/fetch/src/index.ts` | Modify - update Response constructor |
| `packages/fetch/src/index.ts` | Modify - add `__Response_constructStreaming` |
| `packages/fetch/src/index.ts` | Modify - update `dispatchRequest` |
| `packages/fetch/src/stream-state.ts` | Modify - add `createNativeStreamFromRegistry` |
| `packages/fetch/src/download-streaming.test.ts` | Create |

## Notes

### The Tick Challenge

The main challenge is keeping the isolate running to pump the stream. Options:

1. **Tick-based**: Use `setTimeout` in isolate, `tick()` on host
2. **Polling-based**: Host periodically calls into isolate
3. **Hybrid**: Combination of both

The tick-based approach is recommended as it matches existing timer patterns.

### Memory Efficiency

With this implementation:
- Isolate generates chunks on-demand (pull-based)
- Chunks are queued in host registry (max ~1MB)
- Native consumer reads chunks as needed
- No full buffering of response body

### Content-Length

For streaming responses:
- Content-Length may be known (set by handler)
- Or unknown (Transfer-Encoding: chunked semantics)
- Native Response handles this correctly
