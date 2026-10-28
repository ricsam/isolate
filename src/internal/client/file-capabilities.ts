/**
 * Client-side file capabilities.
 *
 * When sandbox code opens a file through bindings that can stream byte ranges
 * (`stat()` + `readFileStream()`), the client — which owns the disk — mints an
 * opaque capability token for the file snapshot. The daemon only ever holds
 * that token: it uses it to read bounded chunks on demand, and passes it back
 * unchanged when the sandbox returns the file in a Response so that the client
 * streams the bytes itself.
 *
 * Tokens are sealed with an HMAC key that is private to one runtime's
 * bindings. A token that was forged, tampered with, minted for another
 * runtime, or minted before the runtime's bindings were replaced fails
 * verification. Sandbox code never sees tokens.
 */

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { withRequestContext } from "../../bridge/request-context.ts";

/** Largest chunk the daemon may request in one `readFileChunk` call. */
export const MAX_FILE_CHUNK_BYTES = 4 * 1024 * 1024;

const TOKEN_FORMAT_VERSION = 1;

export interface FileCapability {
  /** Path in the runtime's file bindings namespace. */
  path: string;
  /** Snapshot size in bytes. */
  size: number;
  /** Snapshot version reported by `stat()`, if any. */
  version?: string;
  /** Modification time reported by `stat()`. */
  lastModified: number;
}

export interface FileCapabilityAuthority {
  /** Mint a sealed token for a file snapshot. */
  mint(capability: FileCapability): string;
  /** Verify a token minted by this authority. Throws if it is not valid. */
  verify(token: unknown): FileCapability;
}

interface TokenPayload {
  v: number;
  p: string;
  s: number;
  m: number;
  ver: string | null;
  n: string;
}

function createNamedError(name: string, message: string): Error {
  const error = new Error(message);
  error.name = name;
  return error;
}

function createInvalidCapabilityError(): Error {
  return createNamedError(
    "NotAllowedError",
    "File capability is not valid for this runtime",
  );
}

function createChangedError(path: string): Error {
  return createNamedError("NotReadableError", `File changed since it was opened: ${path}`);
}

function isSafeSize(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

export function createFileCapabilityAuthority(): FileCapabilityAuthority {
  const key = randomBytes(32);

  const sign = (body: string): Buffer =>
    createHmac("sha256", key).update(body).digest();

  return {
    mint(capability) {
      const payload: TokenPayload = {
        v: TOKEN_FORMAT_VERSION,
        p: capability.path,
        s: capability.size,
        m: capability.lastModified,
        ver: capability.version ?? null,
        n: randomBytes(12).toString("base64url"),
      };
      const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
      return `${body}.${sign(body).toString("base64url")}`;
    },

    verify(token) {
      if (typeof token !== "string" || token.length > 16 * 1024) {
        throw createInvalidCapabilityError();
      }
      const separator = token.indexOf(".");
      if (separator <= 0 || separator !== token.lastIndexOf(".")) {
        throw createInvalidCapabilityError();
      }
      const body = token.slice(0, separator);
      const mac = Buffer.from(token.slice(separator + 1), "base64url");
      const expected = sign(body);
      if (mac.length !== expected.length || !timingSafeEqual(mac, expected)) {
        throw createInvalidCapabilityError();
      }

      let payload: TokenPayload;
      try {
        payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as TokenPayload;
      } catch {
        throw createInvalidCapabilityError();
      }
      if (
        payload.v !== TOKEN_FORMAT_VERSION ||
        typeof payload.p !== "string" ||
        !isSafeSize(payload.s) ||
        typeof payload.m !== "number" ||
        (payload.ver !== null && typeof payload.ver !== "string")
      ) {
        throw createInvalidCapabilityError();
      }

      return {
        path: payload.p,
        size: payload.s,
        lastModified: payload.m,
        version: payload.ver ?? undefined,
      };
    },
  };
}

/**
 * Validate that `[start, end)` is a byte range of a capability.
 */
export function assertCapabilityRange(
  capability: FileCapability,
  start: unknown,
  end: unknown,
  maxLength = Number.POSITIVE_INFINITY,
): { start: number; end: number } {
  if (
    !isSafeSize(start) ||
    !isSafeSize(end) ||
    end < start ||
    end > capability.size ||
    end - start > maxLength
  ) {
    throw new RangeError(
      `Invalid byte range ${String(start)}-${String(end)} for ${capability.path}`,
    );
  }
  return { start, end };
}

export type ReadFileStreamCallback = (
  path: string,
  options: { start: number; end: number; version?: string; signal?: AbortSignal },
) => ReadableStream<Uint8Array> | Promise<ReadableStream<Uint8Array>>;

/**
 * Read exactly `length` bytes from a binding stream.
 */
export async function readStreamExactly(
  stream: ReadableStream<Uint8Array>,
  length: number,
  path: string,
): Promise<Uint8Array> {
  const result = new Uint8Array(length);
  let offset = 0;
  const reader = stream.getReader();
  try {
    while (offset < length) {
      const { done, value } = await reader.read();
      if (done) {
        throw createChangedError(path);
      }
      if (offset + value.byteLength > length) {
        throw createChangedError(path);
      }
      result.set(value, offset);
      offset += value.byteLength;
    }
    // A well-behaved range stream ends exactly here.
    const tail = await reader.read();
    if (!tail.done && tail.value.byteLength > 0) {
      throw createChangedError(path);
    }
  } catch (error) {
    await reader.cancel(error).catch(() => {});
    throw error;
  }
  await reader.cancel().catch(() => {});
  return result;
}

/**
 * Create a response body that streams `[start, end)` of a capability from the
 * client's own file bindings. Nothing is opened until the body is first read;
 * the binding stream is cancelled when the consumer cancels. The stream is
 * owned by the response consumer and is not tied to the runtime's lifetime.
 */
export function createCapabilityBodyStream(
  readFileStream: ReadFileStreamCallback,
  capability: FileCapability,
  range: { start: number; end: number },
  requestContext: { requestId?: string; metadata?: Record<string, string> },
): ReadableStream<Uint8Array> {
  const abortController = new AbortController();
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  let remaining = range.end - range.start;

  const release = async (reason?: unknown) => {
    const active = reader;
    reader = null;
    if (active) {
      await active.cancel(reason).catch(() => {});
    }
  };

  return new ReadableStream<Uint8Array>(
    {
      async pull(controller) {
        try {
          if (!reader) {
            if (remaining === 0) {
              controller.close();
              return;
            }
            const stream = await withRequestContext(
              {
                requestId: requestContext.requestId,
                metadata: requestContext.metadata,
                signal: abortController.signal,
              },
              async () =>
                await readFileStream(capability.path, {
                  start: range.start,
                  end: range.end,
                  version: capability.version,
                  signal: abortController.signal,
                }),
            );
            reader = stream.getReader();
          }

          const { done, value } = await reader.read();
          if (done) {
            reader = null;
            if (remaining !== 0) {
              throw createChangedError(capability.path);
            }
            controller.close();
            return;
          }
          if (value.byteLength > remaining) {
            throw createChangedError(capability.path);
          }
          remaining -= value.byteLength;
          controller.enqueue(value);
        } catch (error) {
          if (!abortController.signal.aborted) {
            abortController.abort(error);
          }
          await release(error);
          controller.error(error);
        }
      },
      async cancel(reason) {
        if (!abortController.signal.aborted) {
          abortController.abort(reason);
        }
        await release(reason);
      },
    },
    { highWaterMark: 0 },
  );
}
