/**
 * Host-side Blob bodies.
 *
 * Blob and File contents live on the host, never in the isolate heap. A blob
 * body is a list of segments: in-memory bytes, or byte ranges of a lazily read
 * source such as a disk-backed file snapshot. Slicing and composing blobs only
 * rearranges segments; bytes are read on demand, in bounded chunks, by the
 * process that owns the source.
 *
 * Nothing in this module is exposed to sandbox code: the isolate only sees
 * numeric instance ids that are resolved against per-context state maps.
 */

import type ivm from "@ricsam/isolated-vm";

/**
 * A lazily read byte source, for example a file snapshot. Sources must not
 * hold OS resources (file descriptors) while idle: every `stream()` call opens
 * what it needs and releases it when the stream ends, errors, or is cancelled.
 */
export interface BlobByteSource {
  /** Total size of the source snapshot in bytes. */
  readonly size: number;
  /** Stream bytes `[start, end)`. Must yield exactly `end - start` bytes. */
  stream(
    start: number,
    end: number,
    signal: AbortSignal,
  ): ReadableStream<Uint8Array> | Promise<ReadableStream<Uint8Array>>;
  /**
   * Present when another host owns the bytes and can serve them itself. A
   * response body made of exactly one such segment is passed to that host as a
   * capability instead of being read.
   */
  readonly passthrough?: { readonly token: string };
}

export type BlobSegment =
  | { readonly kind: "bytes"; readonly bytes: Uint8Array }
  | {
      readonly kind: "source";
      readonly source: BlobByteSource;
      readonly start: number;
      readonly end: number;
    };

export interface BlobBody {
  readonly segments: readonly BlobSegment[];
  readonly size: number;
  readonly type: string;
}

/** Chunk size for chunks copied into the isolate. */
export const DEFAULT_BLOB_CHUNK_SIZE = 64 * 1024;
/** Chunk size for host-side consumers (for example response bodies). */
export const DEFAULT_HOST_BLOB_CHUNK_SIZE = 256 * 1024;
/** Default limit for `text()`/`arrayBuffer()` on lazily read blobs. */
export const DEFAULT_MAX_BLOB_MATERIALIZE_BYTES = 32 * 1024 * 1024;
/** Default limit for concurrently open lazily read blob streams per context. */
export const DEFAULT_MAX_OPEN_BLOB_READERS = 64;

export interface BlobLimits {
  /** Largest lazily read blob that `text()`/`arrayBuffer()`/`bytes()` may copy into the isolate. */
  maxMaterializeBytes: number;
  /** Maximum concurrently open streams over lazily read blobs. */
  maxOpenReaders: number;
  /** Maximum chunk size copied into the isolate per read. */
  chunkSize: number;
}

const DEFAULT_LIMITS: BlobLimits = {
  maxMaterializeBytes: DEFAULT_MAX_BLOB_MATERIALIZE_BYTES,
  maxOpenReaders: DEFAULT_MAX_OPEN_BLOB_READERS,
  chunkSize: DEFAULT_BLOB_CHUNK_SIZE,
};

const blobLimits = new WeakMap<ivm.Context, BlobLimits>();

export function configureBlobLimits(context: ivm.Context, limits: Partial<BlobLimits>): void {
  const current = getBlobLimits(context);
  blobLimits.set(context, {
    maxMaterializeBytes: positiveInteger(limits.maxMaterializeBytes) ?? current.maxMaterializeBytes,
    maxOpenReaders: positiveInteger(limits.maxOpenReaders) ?? current.maxOpenReaders,
    chunkSize: positiveInteger(limits.chunkSize) ?? current.chunkSize,
  });
}

export function getBlobLimits(context: ivm.Context): BlobLimits {
  return blobLimits.get(context) ?? DEFAULT_LIMITS;
}

function positiveInteger(value: number | undefined): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return undefined;
  }
  return Math.floor(value);
}

function createNamedError(name: string, message: string): Error {
  const error = new Error(message);
  error.name = name;
  return error;
}

function createAbortError(reason?: unknown): Error {
  if (reason instanceof Error) {
    return reason;
  }
  return createNamedError(
    "AbortError",
    typeof reason === "string" ? reason : "The operation was aborted",
  );
}

function createSourceMismatchError(): Error {
  return createNamedError(
    "NotReadableError",
    "The file could not be read: its contents no longer match the opened snapshot",
  );
}

export function getSegmentsSize(segments: readonly BlobSegment[]): number {
  let size = 0;
  for (const segment of segments) {
    size += segment.kind === "bytes" ? segment.bytes.byteLength : segment.end - segment.start;
  }
  return size;
}

export function hasSourceSegments(segments: readonly BlobSegment[]): boolean {
  return segments.some((segment) => segment.kind === "source");
}

/**
 * Normalize segments: drop empty segments and merge adjacent in-memory bytes.
 */
export function normalizeSegments(segments: readonly BlobSegment[]): BlobSegment[] {
  const result: BlobSegment[] = [];
  let pendingBytes: Uint8Array[] = [];

  const flushBytes = () => {
    if (pendingBytes.length === 0) return;
    if (pendingBytes.length === 1) {
      result.push({ kind: "bytes", bytes: pendingBytes[0]! });
    } else {
      result.push({ kind: "bytes", bytes: concatChunks(pendingBytes) });
    }
    pendingBytes = [];
  };

  for (const segment of segments) {
    if (segment.kind === "bytes") {
      if (segment.bytes.byteLength > 0) {
        pendingBytes.push(segment.bytes);
      }
      continue;
    }
    if (segment.end <= segment.start) {
      continue;
    }
    flushBytes();
    result.push(segment);
  }
  flushBytes();
  return result;
}

/**
 * Narrow segments to the byte range `[start, end)` without reading anything.
 */
export function sliceSegments(
  segments: readonly BlobSegment[],
  start: number,
  end: number,
): BlobSegment[] {
  const result: BlobSegment[] = [];
  let offset = 0;
  for (const segment of segments) {
    const length = segment.kind === "bytes" ? segment.bytes.byteLength : segment.end - segment.start;
    const segmentStart = offset;
    const segmentEnd = offset + length;
    offset = segmentEnd;

    const from = Math.max(start, segmentStart);
    const to = Math.min(end, segmentEnd);
    if (to <= from) {
      continue;
    }

    if (segment.kind === "bytes") {
      result.push({
        kind: "bytes",
        bytes: segment.bytes.subarray(from - segmentStart, to - segmentStart),
      });
    } else {
      result.push({
        kind: "source",
        source: segment.source,
        start: segment.start + (from - segmentStart),
        end: segment.start + (to - segmentStart),
      });
    }
  }
  return result;
}

function concatChunks(chunks: readonly Uint8Array[]): Uint8Array {
  let total = 0;
  for (const chunk of chunks) total += chunk.byteLength;
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

/**
 * Concatenate in-memory segments. Throws if the blob has lazily read segments.
 */
export function concatByteSegments(segments: readonly BlobSegment[]): Uint8Array {
  const chunks: Uint8Array[] = [];
  for (const segment of segments) {
    if (segment.kind !== "bytes") {
      throw new TypeError(
        "Disk-backed files cannot be read synchronously; use await blob.arrayBuffer() or blob.stream().",
      );
    }
    chunks.push(segment.bytes);
  }
  return concatChunks(chunks);
}

/**
 * Return an ArrayBuffer containing exactly the bytes of `chunk`, copying only
 * when the view does not cover its whole buffer (for example pooled Buffers).
 */
export function toExactArrayBuffer(chunk: Uint8Array): ArrayBuffer {
  if (
    chunk.byteOffset === 0 &&
    chunk.byteLength === chunk.buffer.byteLength &&
    chunk.buffer instanceof ArrayBuffer
  ) {
    return chunk.buffer;
  }
  return chunk.slice().buffer as ArrayBuffer;
}

export interface BlobBodyStreamOptions {
  /** Maximum size of chunks produced from in-memory segments. */
  chunkSize?: number;
  /** Aborts the stream and every source stream it opened. */
  signal?: AbortSignal;
}

/**
 * Create a host-side stream over blob segments.
 *
 * The stream is lazy (`highWaterMark: 0`): no source is opened until the
 * consumer pulls, and at most one source stream is open at a time. Source
 * streams are cancelled when the consumer cancels, errors, or aborts.
 */
export function createBlobBodyStream(
  segments: readonly BlobSegment[],
  options: BlobBodyStreamOptions = {},
): ReadableStream<Uint8Array> {
  const chunkSize = positiveInteger(options.chunkSize) ?? DEFAULT_HOST_BLOB_CHUNK_SIZE;
  const abortController = new AbortController();
  let index = 0;
  let bytesOffset = 0;
  let current: { reader: ReadableStreamDefaultReader<Uint8Array>; remaining: number } | null = null;
  let finished = false;

  const onExternalAbort = () => {
    abortController.abort(createAbortError(options.signal?.reason));
    void releaseCurrent(options.signal?.reason);
  };

  const finish = () => {
    if (finished) return;
    finished = true;
    options.signal?.removeEventListener("abort", onExternalAbort);
  };

  const releaseCurrent = async (reason?: unknown) => {
    const active = current;
    current = null;
    if (active) {
      await active.reader.cancel(reason).catch(() => {});
    }
  };

  if (options.signal?.aborted) {
    abortController.abort(createAbortError(options.signal.reason));
  } else {
    options.signal?.addEventListener("abort", onExternalAbort, { once: true });
  }

  return new ReadableStream<Uint8Array>(
    {
      async pull(controller) {
        try {
          while (true) {
            if (abortController.signal.aborted) {
              throw createAbortError(abortController.signal.reason);
            }
            if (index >= segments.length) {
              finish();
              controller.close();
              return;
            }

            const segment = segments[index]!;
            if (segment.kind === "bytes") {
              if (bytesOffset >= segment.bytes.byteLength) {
                index += 1;
                bytesOffset = 0;
                continue;
              }
              const end = Math.min(segment.bytes.byteLength, bytesOffset + chunkSize);
              // Copy so consumers can never mutate the immutable blob bytes.
              const chunk = segment.bytes.slice(bytesOffset, end);
              bytesOffset = end;
              controller.enqueue(chunk);
              return;
            }

            if (!current) {
              const stream = await segment.source.stream(
                segment.start,
                segment.end,
                abortController.signal,
              );
              if (abortController.signal.aborted) {
                await stream.cancel().catch(() => {});
                throw createAbortError(abortController.signal.reason);
              }
              current = { reader: stream.getReader(), remaining: segment.end - segment.start };
            }

            const active = current;
            const { done, value } = await active.reader.read();
            if (abortController.signal.aborted) {
              throw createAbortError(abortController.signal.reason);
            }
            if (done) {
              if (active.remaining !== 0) {
                throw createSourceMismatchError();
              }
              current = null;
              index += 1;
              continue;
            }
            if (!value || value.byteLength === 0) {
              continue;
            }
            if (value.byteLength > active.remaining) {
              throw createSourceMismatchError();
            }
            active.remaining -= value.byteLength;
            controller.enqueue(value);
            return;
          }
        } catch (error) {
          finish();
          if (!abortController.signal.aborted) {
            abortController.abort(error);
          }
          await releaseCurrent(error);
          controller.error(error);
        }
      },
      async cancel(reason) {
        finish();
        if (!abortController.signal.aborted) {
          abortController.abort(createAbortError(reason));
        }
        await releaseCurrent(reason);
      },
    },
    { highWaterMark: 0 },
  );
}

export interface ReadBlobBodyOptions {
  /** Maximum number of bytes that may be materialized. */
  maxBytes: number;
  signal?: AbortSignal;
}

/**
 * Materialize a blob body into one buffer. This is an explicit, size-limited
 * operation used by `text()`, `arrayBuffer()`, and friends.
 */
export async function readBlobBody(
  segments: readonly BlobSegment[],
  options: ReadBlobBodyOptions,
): Promise<Uint8Array> {
  const size = getSegmentsSize(segments);
  if (!hasSourceSegments(segments)) {
    return concatByteSegments(segments);
  }
  if (size > options.maxBytes) {
    throw new RangeError(
      `Cannot read ${size} bytes into the isolate: the limit for disk-backed files is ${options.maxBytes} bytes. ` +
        "Use blob.stream() or return the file in a Response instead.",
    );
  }

  const result = new Uint8Array(size);
  let offset = 0;
  const reader = createBlobBodyStream(segments, { signal: options.signal }).getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (offset + value.byteLength > size) {
        throw createSourceMismatchError();
      }
      result.set(value, offset);
      offset += value.byteLength;
    }
  } catch (error) {
    await reader.cancel(error).catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
  if (offset !== size) {
    throw createSourceMismatchError();
  }
  return result;
}

// ============================================================================
// Isolate stream reader sessions
// ============================================================================

interface BlobReaderSession {
  reader: ReadableStreamDefaultReader<Uint8Array>;
  pending: Uint8Array | null;
  /** Counts toward the open-reader limit (reads lazily backed segments). */
  limited: boolean;
}

const readerSessions = new WeakMap<ivm.Context, Map<number, BlobReaderSession>>();
let nextReaderId = 1;

function getReaderSessions(context: ivm.Context): Map<number, BlobReaderSession> {
  let sessions = readerSessions.get(context);
  if (!sessions) {
    sessions = new Map();
    readerSessions.set(context, sessions);
  }
  return sessions;
}

/** Number of open isolate streams over lazily read blobs (for diagnostics and tests). */
export function getOpenBlobReaderCount(context: ivm.Context): number {
  let count = 0;
  for (const session of readerSessions.get(context)?.values() ?? []) {
    if (session.limited) count += 1;
  }
  return count;
}

/**
 * Open a reader session for an isolate-side `blob.stream()`.
 */
export function openBlobReader(context: ivm.Context, segments: readonly BlobSegment[]): number {
  const limits = getBlobLimits(context);
  const sessions = getReaderSessions(context);
  const limited = hasSourceSegments(segments);
  if (limited && getOpenBlobReaderCount(context) >= limits.maxOpenReaders) {
    throw new RangeError(
      `Too many open file streams (limit ${limits.maxOpenReaders}). Finish or cancel existing streams first.`,
    );
  }

  const readerId = nextReaderId++;
  sessions.set(readerId, {
    reader: createBlobBodyStream(segments, { chunkSize: limits.chunkSize }).getReader(),
    pending: null,
    limited,
  });
  return readerId;
}

/**
 * Read the next chunk (at most `chunkSize` bytes) of a reader session.
 * Resolves `null` at the end of the blob; the session is then closed.
 */
export async function readBlobReader(
  context: ivm.Context,
  readerId: number,
): Promise<Uint8Array | null> {
  const session = readerSessions.get(context)?.get(readerId);
  if (!session) {
    throw new TypeError("The blob stream has been closed");
  }

  const chunkSize = getBlobLimits(context).chunkSize;
  let chunk = session.pending;
  session.pending = null;

  if (!chunk) {
    let result: ReadableStreamReadResult<Uint8Array>;
    try {
      result = await session.reader.read();
    } catch (error) {
      closeBlobReader(context, readerId);
      throw error;
    }
    if (result.done) {
      closeBlobReader(context, readerId);
      return null;
    }
    chunk = result.value;
  }

  if (chunk.byteLength > chunkSize) {
    session.pending = chunk.subarray(chunkSize);
    chunk = chunk.subarray(0, chunkSize);
  }
  return chunk;
}

export function closeBlobReader(context: ivm.Context, readerId: number): void {
  const sessions = readerSessions.get(context);
  const session = sessions?.get(readerId);
  if (!session) {
    return;
  }
  sessions!.delete(readerId);
  session.pending = null;
  void session.reader.cancel().catch(() => {});
}

/** Close every reader session of a context (runtime disposal). */
export function closeAllBlobReaders(context: ivm.Context): void {
  const sessions = readerSessions.get(context);
  if (!sessions) {
    return;
  }
  for (const readerId of Array.from(sessions.keys())) {
    closeBlobReader(context, readerId);
  }
  readerSessions.delete(context);
}
