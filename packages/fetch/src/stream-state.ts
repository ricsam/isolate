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
  pull(
    streamId: number
  ): Promise<{ value: Uint8Array; done: false } | { done: true }>;

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

  /** Cancel a stream and call its cleanup function */
  cancel(streamId: number): void;

  /** Register a cleanup function for a stream */
  setCleanup(streamId: number, cleanup: () => Promise<void>): void;
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
  const cleanups = new Map<number, () => Promise<void>>();
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

    async pull(
      streamId: number
    ): Promise<{ value: Uint8Array; done: false } | { done: true }> {
      const state = streams.get(streamId);
      if (!state) {
        return { done: true };
      }

      // If queue has data, return it first (even if stream is errored)
      if (state.queue.length > 0) {
        const chunk = state.queue.shift()!;
        state.queueSize -= chunk.length;
        return { value: chunk, done: false };
      }

      // If errored (and queue is empty), throw
      if (state.errored) {
        throw state.errorValue;
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
      return (
        state.queueSize >= HIGH_WATER_MARK ||
        state.queue.length >= MAX_QUEUE_CHUNKS
      );
    },

    delete(streamId: number): void {
      const state = streams.get(streamId);
      if (state && state.pullWaiting && state.pullReject) {
        state.pullReject(new Error("Stream deleted"));
      }
      streams.delete(streamId);
      cleanups.delete(streamId);
    },

    clear(): void {
      for (const [streamId] of streams) {
        this.delete(streamId);
      }
    },

    cancel(streamId: number): void {
      this.close(streamId);
      const cleanup = cleanups.get(streamId);
      if (cleanup) {
        cleanup().catch(() => {});
        cleanups.delete(streamId);
      }
    },

    setCleanup(streamId: number, cleanup: () => Promise<void>): void {
      cleanups.set(streamId, cleanup);
    },
  };
}

// ============================================================================
// Context-Scoped Registry
// ============================================================================

const contextRegistries = new WeakMap<ivm.Context, StreamStateRegistry>();

export function getStreamRegistryForContext(
  context: ivm.Context
): StreamStateRegistry {
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

// ============================================================================
// Native Stream Reader
// ============================================================================

/**
 * Start reading from a native ReadableStream and push to host queue.
 * Respects backpressure by pausing when queue is full.
 *
 * @param nativeStream The native ReadableStream to read from
 * @param streamId The stream ID in the registry
 * @param registry The stream state registry
 * @returns Async cleanup function to cancel the reader
 */
export function startNativeStreamReader(
  nativeStream: ReadableStream<Uint8Array>,
  streamId: number,
  registry: StreamStateRegistry
): () => Promise<void> {
  let cancelled = false;
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  let readLoopPromise: Promise<void> | null = null;

  const CHUNK_SIZE = 64 * 1024; // 64KB max chunk size

  async function readLoop() {
    try {
      reader = nativeStream.getReader();

      while (!cancelled) {
        // Respect backpressure - wait if queue is full
        while (registry.isQueueFull(streamId) && !cancelled) {
          await new Promise((resolve) => setTimeout(resolve, 1));
        }
        if (cancelled) break;

        const { done, value } = await reader.read();

        if (done) {
          registry.close(streamId);
          break;
        }

        if (value) {
          // Split large chunks to maintain granularity
          if (value.length > CHUNK_SIZE) {
            for (let offset = 0; offset < value.length; offset += CHUNK_SIZE) {
              const chunk = value.slice(
                offset,
                Math.min(offset + CHUNK_SIZE, value.length)
              );
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
        } catch {
          // Ignore release errors
        }
      }
    }
  }

  // Start the read loop and save the promise
  readLoopPromise = readLoop();

  // Return async cleanup function
  return async () => {
    cancelled = true;
    if (reader) {
      try {
        await reader.cancel();
      } catch {
        // Ignore cancel errors
      }
    }
    // Wait for read loop to finish
    if (readLoopPromise) {
      try {
        await readLoopPromise;
      } catch {
        // Ignore read loop errors during cleanup
      }
    }
  };
}
