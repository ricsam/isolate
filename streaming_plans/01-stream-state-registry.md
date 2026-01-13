# Plan 01: Stream State Registry

> **Status: ✅ COMPLETE**
>
> Implemented in `packages/fetch/src/stream-state.ts` with 28 passing unit tests.

## Overview

Create a host-side registry to manage stream state (queues, flags, waiters) that can be accessed synchronously from both host and isolate code.

## Problem

The isolate cannot directly access JavaScript object internals. To implement streaming, we need a shared state mechanism where:
- Host can push chunks to a queue
- Isolate can pull chunks from the queue (blocking if empty)
- Both sides can check/set closed/error states

## Solution

Create a `StreamStateRegistry` that:
1. Stores stream state by numeric ID (like existing instance state pattern)
2. Provides sync callbacks for isolate to interact with state
3. Provides async primitives for blocking operations

## Implementation

### File: `packages/fetch/src/stream-state.ts` (new file)

```typescript
import ivm from "isolated-vm";

// ============================================================================
// Types
// ============================================================================

export interface StreamState {
  /** Buffered chunks waiting to be read */
  queue: Uint8Array[];

  /** Total bytes in queue (for backpressure) */
  queueSize: number;

  /** Stream has been closed (no more data) */
  closed: boolean;

  /** Stream encountered an error */
  errored: boolean;

  /** The error value if errored */
  errorValue: unknown;

  /** A pull is waiting for data */
  pullWaiting: boolean;

  /** Resolve function for waiting pull */
  pullResolve: ((chunk: Uint8Array | null) => void) | null;

  /** Reject function for waiting pull */
  pullReject: ((error: unknown) => void) | null;
}

export interface StreamStateRegistry {
  /** Create a new stream and return its ID */
  create(): number;

  /** Get stream state by ID */
  get(streamId: number): StreamState | undefined;

  /** Push a chunk to the stream's queue */
  push(streamId: number, chunk: Uint8Array): boolean;

  /** Pull a chunk from the stream (returns Promise that resolves when data available) */
  pull(streamId: number): Promise<{ value: Uint8Array; done: false } | { done: true }>;

  /** Close the stream (no more data) */
  close(streamId: number): void;

  /** Error the stream */
  error(streamId: number, errorValue: unknown): void;

  /** Check if stream queue is above high-water mark */
  isQueueFull(streamId: number): boolean;

  /** Delete stream state (cleanup) */
  delete(streamId: number): void;

  /** Clear all streams (context cleanup) */
  clear(): void;
}

// ============================================================================
// Constants
// ============================================================================

/** Maximum bytes to buffer before backpressure kicks in */
export const HIGH_WATER_MARK = 64 * 1024; // 64KB

/** Maximum number of chunks in queue */
export const MAX_QUEUE_CHUNKS = 16;

// ============================================================================
// Implementation
// ============================================================================

export function createStreamStateRegistry(): StreamStateRegistry {
  const streams = new Map<number, StreamState>();
  let nextStreamId = 1;

  return {
    create(): number {
      const streamId = nextStreamId++;
      streams.set(streamId, {
        queue: [],
        queueSize: 0,
        closed: false,
        errored: false,
        errorValue: undefined,
        pullWaiting: false,
        pullResolve: null,
        pullReject: null,
      });
      return streamId;
    },

    get(streamId: number): StreamState | undefined {
      return streams.get(streamId);
    },

    push(streamId: number, chunk: Uint8Array): boolean {
      const state = streams.get(streamId);
      if (!state) return false;
      if (state.closed || state.errored) return false;

      // If a pull is waiting, deliver directly
      if (state.pullWaiting && state.pullResolve) {
        state.pullWaiting = false;
        const resolve = state.pullResolve;
        state.pullResolve = null;
        state.pullReject = null;
        resolve(chunk);
        return true;
      }

      // Otherwise queue the chunk
      state.queue.push(chunk);
      state.queueSize += chunk.length;
      return true;
    },

    async pull(streamId: number): Promise<{ value: Uint8Array; done: false } | { done: true }> {
      const state = streams.get(streamId);
      if (!state) {
        return { done: true };
      }

      // If errored, throw
      if (state.errored) {
        throw state.errorValue;
      }

      // If queue has data, return immediately
      if (state.queue.length > 0) {
        const chunk = state.queue.shift()!;
        state.queueSize -= chunk.length;
        return { value: chunk, done: false };
      }

      // If closed and queue empty, we're done
      if (state.closed) {
        return { done: true };
      }

      // Wait for data
      return new Promise((resolve, reject) => {
        state.pullWaiting = true;
        state.pullResolve = (chunk) => {
          if (chunk === null) {
            resolve({ done: true });
          } else {
            resolve({ value: chunk, done: false });
          }
        };
        state.pullReject = reject;
      });
    },

    close(streamId: number): void {
      const state = streams.get(streamId);
      if (!state) return;

      state.closed = true;

      // If a pull is waiting, resolve with done
      if (state.pullWaiting && state.pullResolve) {
        state.pullWaiting = false;
        const resolve = state.pullResolve;
        state.pullResolve = null;
        state.pullReject = null;
        resolve(null);
      }
    },

    error(streamId: number, errorValue: unknown): void {
      const state = streams.get(streamId);
      if (!state) return;

      state.errored = true;
      state.errorValue = errorValue;

      // If a pull is waiting, reject it
      if (state.pullWaiting && state.pullReject) {
        state.pullWaiting = false;
        const reject = state.pullReject;
        state.pullResolve = null;
        state.pullReject = null;
        reject(errorValue);
      }
    },

    isQueueFull(streamId: number): boolean {
      const state = streams.get(streamId);
      if (!state) return true;
      return state.queueSize >= HIGH_WATER_MARK || state.queue.length >= MAX_QUEUE_CHUNKS;
    },

    delete(streamId: number): void {
      const state = streams.get(streamId);
      if (state && state.pullWaiting && state.pullReject) {
        state.pullReject(new Error("Stream deleted"));
      }
      streams.delete(streamId);
    },

    clear(): void {
      for (const [streamId] of streams) {
        this.delete(streamId);
      }
    },
  };
}

// ============================================================================
// Context-Scoped Registry
// ============================================================================

const contextRegistries = new WeakMap<ivm.Context, StreamStateRegistry>();

export function getStreamRegistryForContext(context: ivm.Context): StreamStateRegistry {
  let registry = contextRegistries.get(context);
  if (!registry) {
    registry = createStreamStateRegistry();
    contextRegistries.set(context, registry);
  }
  return registry;
}

export function clearStreamRegistryForContext(context: ivm.Context): void {
  const registry = contextRegistries.get(context);
  if (registry) {
    registry.clear();
    contextRegistries.delete(context);
  }
}
```

### Host Callbacks Registration

> **Note:** This section shows the integration with `setupFetch()`. This was implemented in Plan 02 as `setupStreamCallbacks()`.

In `setupFetch()`, register callbacks for isolate access:

```typescript
import { getStreamRegistryForContext } from "./stream-state.ts";

// In setupFetch():
const streamRegistry = getStreamRegistryForContext(context);
const global = context.global;

// Create a new stream (returns stream ID)
global.setSync(
  "__Stream_create",
  new ivm.Callback(() => {
    return streamRegistry.create();
  })
);

// Push chunk to stream (sync, for host-side use)
global.setSync(
  "__Stream_push",
  new ivm.Callback((streamId: number, chunkArray: number[]) => {
    const chunk = new Uint8Array(chunkArray);
    return streamRegistry.push(streamId, chunk);
  })
);

// Pull chunk from stream (async, blocks until data available)
const pullRef = new ivm.Reference(async (streamId: number) => {
  const result = await streamRegistry.pull(streamId);
  if (result.done) {
    return JSON.stringify({ done: true });
  }
  return JSON.stringify({ done: false, value: Array.from(result.value) });
});
global.setSync("__Stream_pull_ref", pullRef);

// Close stream (sync)
global.setSync(
  "__Stream_close",
  new ivm.Callback((streamId: number) => {
    streamRegistry.close(streamId);
  })
);

// Error stream (sync)
global.setSync(
  "__Stream_error",
  new ivm.Callback((streamId: number, message: string) => {
    streamRegistry.error(streamId, new Error(message));
  })
);

// Check if queue is full (for backpressure)
global.setSync(
  "__Stream_isQueueFull",
  new ivm.Callback((streamId: number) => {
    return streamRegistry.isQueueFull(streamId);
  })
);
```

## Testing

### Unit Tests

```typescript
import { createStreamStateRegistry } from "./stream-state.ts";

describe("StreamStateRegistry", () => {
  test("create returns unique IDs", () => {
    const registry = createStreamStateRegistry();
    const id1 = registry.create();
    const id2 = registry.create();
    expect(id1).not.toBe(id2);
  });

  test("push and pull work synchronously when data available", async () => {
    const registry = createStreamStateRegistry();
    const streamId = registry.create();

    registry.push(streamId, new Uint8Array([1, 2, 3]));
    const result = await registry.pull(streamId);

    expect(result.done).toBe(false);
    expect(result.value).toEqual(new Uint8Array([1, 2, 3]));
  });

  test("pull waits for data when queue empty", async () => {
    const registry = createStreamStateRegistry();
    const streamId = registry.create();

    // Start pull (will wait)
    const pullPromise = registry.pull(streamId);

    // Push after delay
    setTimeout(() => {
      registry.push(streamId, new Uint8Array([4, 5, 6]));
    }, 10);

    const result = await pullPromise;
    expect(result.done).toBe(false);
    expect(result.value).toEqual(new Uint8Array([4, 5, 6]));
  });

  test("close resolves waiting pull with done", async () => {
    const registry = createStreamStateRegistry();
    const streamId = registry.create();

    const pullPromise = registry.pull(streamId);
    registry.close(streamId);

    const result = await pullPromise;
    expect(result.done).toBe(true);
  });

  test("error rejects waiting pull", async () => {
    const registry = createStreamStateRegistry();
    const streamId = registry.create();

    const pullPromise = registry.pull(streamId);
    registry.error(streamId, new Error("test error"));

    await expect(pullPromise).rejects.toThrow("test error");
  });

  test("isQueueFull respects high water mark", () => {
    const registry = createStreamStateRegistry();
    const streamId = registry.create();

    expect(registry.isQueueFull(streamId)).toBe(false);

    // Push 64KB (at high water mark)
    registry.push(streamId, new Uint8Array(64 * 1024));
    expect(registry.isQueueFull(streamId)).toBe(true);
  });
});
```

## Verification

1. All unit tests pass
2. Memory doesn't grow unbounded when pushing without pulling
3. Cleanup works correctly (no dangling promises/callbacks)

## Dependencies

None - this is the foundation layer.

## Files Modified/Created

| File | Action | Status |
|------|--------|--------|
| `packages/fetch/src/stream-state.ts` | Create | ✅ Done |
| `packages/fetch/src/stream-state.test.ts` | Create | ✅ Done |

## Implementation Notes

The implementation follows the spec exactly. Key exports:
- `createStreamStateRegistry()` - Factory for standalone registry
- `getStreamRegistryForContext(context)` - Get context-scoped registry
- `clearStreamRegistryForContext(context)` - Cleanup for context
- `HIGH_WATER_MARK` (64KB) and `MAX_QUEUE_CHUNKS` (16) constants

The host callbacks registration (shown in this plan) was implemented as part of Plan 02 in `setupStreamCallbacks()` function.
