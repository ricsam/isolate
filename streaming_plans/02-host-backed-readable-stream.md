# Plan 02: Host-Backed ReadableStream

## Overview

Create a `ReadableStream` implementation in the isolate that delegates to the host-side stream state registry. This enables true lazy streaming where data is pulled chunk-by-chunk.

## Problem

The current `Response.body` returns a one-shot `ReadableStream` that enqueues the entire body at once:

```javascript
// Current implementation (line 570-582)
get body() {
  const instanceId = this.#instanceId;
  return new ReadableStream({
    start(controller) {
      const buffer = __Response_arrayBuffer(instanceId);
      if (buffer.byteLength > 0) {
        controller.enqueue(new Uint8Array(buffer));
      }
      controller.close();
    }
  });
}
```

This buffers the entire body in memory before streaming begins.

## Solution

Create a `HostBackedReadableStream` class that:
1. Is backed by a stream ID in the host registry
2. Uses `pull()` to fetch chunks lazily from the host
3. Supports backpressure via queue size checking
4. Properly handles close and error states

## Implementation

### Isolate-Side Code

Add to `packages/fetch/src/index.ts` as a new injected code block:

```javascript
const hostBackedStreamCode = `
(function() {
  // Internal state storage
  const _streamIds = new WeakMap();

  /**
   * A ReadableStream backed by host-side state.
   * Data is pulled lazily chunk-by-chunk.
   */
  class HostBackedReadableStream {
    constructor(streamId) {
      if (streamId === undefined) {
        // Create a new stream in the host
        streamId = __Stream_create();
      }
      _streamIds.set(this, streamId);
    }

    _getStreamId() {
      return _streamIds.get(this);
    }

    /**
     * Get a reader for this stream (WHATWG API)
     */
    getReader() {
      const streamId = this._getStreamId();
      let released = false;

      return {
        read: async () => {
          if (released) {
            throw new TypeError("Reader has been released");
          }
          // Pull from host (blocks until data available)
          const resultJson = __Stream_pull_ref.applySyncPromise(undefined, [streamId]);
          const result = JSON.parse(resultJson);

          if (result.done) {
            return { done: true, value: undefined };
          }
          return { done: false, value: new Uint8Array(result.value) };
        },

        releaseLock: () => {
          released = true;
        },

        get closed() {
          // Return a Promise that resolves when stream closes
          // For simplicity, we don't implement this fully yet
          return new Promise(() => {});
        },

        cancel: async (reason) => {
          __Stream_error(streamId, String(reason || "cancelled"));
        }
      };
    }

    /**
     * Cancel the stream (WHATWG API)
     */
    async cancel(reason) {
      __Stream_error(this._getStreamId(), String(reason || "cancelled"));
    }

    /**
     * Pipe to a WritableStream (WHATWG API - simplified)
     */
    async pipeTo(destination, options = {}) {
      const reader = this.getReader();
      const writer = destination.getWriter();

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          await writer.write(value);
        }
        await writer.close();
      } catch (error) {
        await writer.abort(error);
        throw error;
      } finally {
        reader.releaseLock();
        writer.releaseLock();
      }
    }

    /**
     * Tee into two streams (WHATWG API)
     */
    tee() {
      const streamId = this._getStreamId();
      const stream1Id = __Stream_create();
      const stream2Id = __Stream_create();

      // Background task to read and duplicate
      (async () => {
        const reader = this.getReader();
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) {
              __Stream_close(stream1Id);
              __Stream_close(stream2Id);
              break;
            }
            __Stream_push(stream1Id, Array.from(value));
            __Stream_push(stream2Id, Array.from(value));
          }
        } catch (error) {
          __Stream_error(stream1Id, String(error));
          __Stream_error(stream2Id, String(error));
        }
      })();

      return [
        new HostBackedReadableStream(stream1Id),
        new HostBackedReadableStream(stream2Id)
      ];
    }

    /**
     * Check if stream is locked (WHATWG API)
     */
    get locked() {
      // Simplified: always return false
      // Full implementation would track reader state
      return false;
    }
  }

  // Static method to create from an existing stream ID
  HostBackedReadableStream._fromStreamId = function(streamId) {
    return new HostBackedReadableStream(streamId);
  };

  // Make available globally
  globalThis.HostBackedReadableStream = HostBackedReadableStream;

  // Helper to check if something is a HostBackedReadableStream
  globalThis.__isHostBackedReadableStream = function(obj) {
    return obj instanceof HostBackedReadableStream;
  };
})();
`;
```

### Integration with Response.body

Update `Response.body` getter to return `HostBackedReadableStream`:

```javascript
// In responseCode:
get body() {
  // Check if we have a streaming body
  const streamId = __Response_getStreamId(this.#instanceId);
  if (streamId !== null) {
    // Return host-backed stream for lazy reading
    return HostBackedReadableStream._fromStreamId(streamId);
  }

  // Fallback: create one-shot stream from buffered body
  const instanceId = this.#instanceId;
  const buffer = __Response_arrayBuffer(instanceId);
  const streamId2 = __Stream_create();

  if (buffer.byteLength > 0) {
    __Stream_push(streamId2, Array.from(new Uint8Array(buffer)));
  }
  __Stream_close(streamId2);

  return HostBackedReadableStream._fromStreamId(streamId2);
}
```

### Host-Side Response State Extension

Add `streamId` to `ResponseState`:

```typescript
interface ResponseState {
  // ... existing fields ...
  streamId: number | null;  // For streaming bodies
}
```

Add callback to get stream ID:

```typescript
global.setSync(
  "__Response_getStreamId",
  new ivm.Callback((instanceId: number) => {
    const state = stateMap.get(instanceId) as ResponseState | undefined;
    return state?.streamId ?? null;
  })
);
```

## Testing

### Unit Tests

```typescript
describe("HostBackedReadableStream", () => {
  test("read returns chunks from host queue", async () => {
    // Create stream and push data from host
    const streamId = ctx.context.evalSync("__Stream_create()");
    streamRegistry.push(streamId, new Uint8Array([1, 2, 3]));
    streamRegistry.push(streamId, new Uint8Array([4, 5, 6]));
    streamRegistry.close(streamId);

    const result = await ctx.context.eval(`
      (async () => {
        const stream = HostBackedReadableStream._fromStreamId(${streamId});
        const reader = stream.getReader();
        const chunks = [];
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(Array.from(value));
        }
        return JSON.stringify(chunks);
      })()
    `, { promise: true });

    expect(JSON.parse(result)).toEqual([[1, 2, 3], [4, 5, 6]]);
  });

  test("read blocks until data available", async () => {
    const streamId = ctx.context.evalSync("__Stream_create()");

    // Start read (will wait)
    const readPromise = ctx.context.eval(`
      (async () => {
        const stream = HostBackedReadableStream._fromStreamId(${streamId});
        const reader = stream.getReader();
        const { done, value } = await reader.read();
        return JSON.stringify({ done, value: Array.from(value || []) });
      })()
    `, { promise: true });

    // Push after delay
    await new Promise(r => setTimeout(r, 10));
    streamRegistry.push(streamId, new Uint8Array([7, 8, 9]));

    const result = await readPromise;
    expect(JSON.parse(result)).toEqual({ done: false, value: [7, 8, 9] });
  });

  test("tee creates two independent streams", async () => {
    const streamId = ctx.context.evalSync("__Stream_create()");

    // Setup tee
    const result = await ctx.context.eval(`
      (async () => {
        const stream = HostBackedReadableStream._fromStreamId(${streamId});
        const [stream1, stream2] = stream.tee();

        const reader1 = stream1.getReader();
        const reader2 = stream2.getReader();

        // Read from both (will wait for data)
        const [r1, r2] = await Promise.all([
          reader1.read(),
          reader2.read()
        ]);

        return JSON.stringify({
          r1: { done: r1.done, value: Array.from(r1.value || []) },
          r2: { done: r2.done, value: Array.from(r2.value || []) }
        });
      })()
    `, { promise: true });

    // Push to original stream (will be duplicated to both tee'd streams)
    streamRegistry.push(streamId, new Uint8Array([1, 2, 3]));

    // Note: In practice, this test is complex due to async timing
    // The implementation uses background async duplication
  });
});
```

## Verification

1. `Response.body.getReader().read()` returns chunks lazily
2. Large responses don't buffer entirely in memory
3. `tee()` creates working duplicate streams
4. `cancel()` properly signals error to host

## Dependencies

- Plan 01: Stream State Registry

## Files Modified/Created

| File | Action |
|------|--------|
| `packages/fetch/src/index.ts` | Modify - add `hostBackedStreamCode` |
| `packages/fetch/src/index.ts` | Modify - update `Response.body` getter |
| `packages/fetch/src/index.ts` | Modify - add `__Response_getStreamId` callback |
| `packages/fetch/src/host-backed-stream.test.ts` | Create |

## Notes

### Why Not Use Existing ReadableStream?

The existing `ReadableStream` from `@ricsam/isolate-core` is a pure-JS implementation that works entirely within the isolate. For streaming across the boundary, we need:

1. Host-side state for the queue (so native code can push)
2. Async pull that blocks the isolate (using `applySyncPromise`)

### Compatibility with Existing ReadableStream

Code can still create pure-JS `ReadableStream` instances for in-isolate use. The `HostBackedReadableStream` is specifically for cross-boundary streaming.

### Future Enhancement: Unified Interface

A future enhancement could make `ReadableStream` automatically choose the appropriate implementation:
- When created with `underlyingSource`, use pure-JS
- When created from host stream ID, use host-backed

This would make the API more seamless for users.
