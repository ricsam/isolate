/**
 * Node.js helpers for root-confined file access.
 *
 * Used by the public `createFileBindings()` helper and the in-process
 * `createNodeFileSystemHandler()` adapter. They provide:
 *
 * - lexical traversal protection (`../` cannot leave the root),
 * - symlink-escape protection (the real path of every accessed entry must be
 *   inside the real root),
 * - open-time race protection for reads (a file is opened first, then its
 *   identity is compared with the confined real path, so swapping a path
 *   component for a symlink between the check and the open is detected), and
 * - identity versions (`dev:ino:size:mtime:ctime`) that pin a file snapshot so
 *   lazily read files fail predictably instead of silently streaming a
 *   different or modified file.
 *
 * Error messages only mention the requested (virtual) path, never the host path.
 */

import nodeFs from "node:fs";
import fsPromises, { type FileHandle } from "node:fs/promises";
import nodePath from "node:path";

const READ_FLAGS = nodeFs.constants.O_RDONLY | (nodeFs.constants.O_NONBLOCK ?? 0);
const WRITE_FLAGS =
  nodeFs.constants.O_WRONLY |
  nodeFs.constants.O_CREAT |
  nodeFs.constants.O_TRUNC |
  (nodeFs.constants.O_NOFOLLOW ?? 0);

/** Default chunk size used when streaming file ranges. */
export const DEFAULT_FILE_STREAM_CHUNK_SIZE = 256 * 1024;

function createCodedError(name: string, code: string, message: string): Error {
  const error = new Error(message) as Error & { code: string };
  error.name = name;
  error.code = code;
  return error;
}

export function createAccessDeniedError(requestedPath: string): Error {
  return createCodedError("NotAllowedError", "EACCES", `Access denied: ${requestedPath}`);
}

export function createFileChangedError(requestedPath: string): Error {
  return createCodedError(
    "NotReadableError",
    "EFILECHANGED",
    `File changed since it was opened: ${requestedPath}`,
  );
}

function createNotFoundError(requestedPath: string): Error {
  return createCodedError("NotFoundError", "ENOENT", `File not found: ${requestedPath}`);
}

function createNotAFileError(requestedPath: string): Error {
  return createCodedError("TypeMismatchError", "EISDIR", `Not a regular file: ${requestedPath}`);
}

function createInvalidRangeError(requestedPath: string, start: number, end: number, size: number): Error {
  return createCodedError(
    "RangeError",
    "ERANGE",
    `Invalid byte range ${start}-${end} for ${requestedPath} (size ${size})`,
  );
}

function createAbortError(reason?: unknown): Error {
  if (reason instanceof Error) {
    return reason;
  }
  const error = new Error(typeof reason === "string" ? reason : "The operation was aborted");
  error.name = "AbortError";
  return error;
}

const NORMALIZED_ERROR_NAMES = new Set([
  "NotAllowedError",
  "NotReadableError",
  "NotFoundError",
  "TypeMismatchError",
  "InvalidModificationError",
  "RangeError",
  "AbortError",
]);

/**
 * Translate Node.js filesystem errors into errors that do not expose host paths.
 */
export function normalizeFsError(error: unknown, requestedPath: string): Error {
  if (error instanceof Error && NORMALIZED_ERROR_NAMES.has(error.name)) {
    return error;
  }
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  switch (code) {
    case "ENOENT":
    case "ENOTDIR":
      return createNotFoundError(requestedPath);
    case "EISDIR":
      return createNotAFileError(requestedPath);
    case "EEXIST":
    case "ENOTEMPTY":
      return createCodedError(
        "InvalidModificationError",
        code,
        `${code === "EEXIST" ? "Already exists" : "Directory not empty"}: ${requestedPath}`,
      );
    case "EACCES":
    case "EPERM":
    case "ELOOP":
      return createAccessDeniedError(requestedPath);
    default:
      return createCodedError(
        "Error",
        code ?? "EIO",
        `File operation failed: ${requestedPath}${code ? ` (${code})` : ""}`,
      );
  }
}

function isInsideRoot(realRoot: string, candidate: string): boolean {
  if (candidate === realRoot) {
    return true;
  }
  const prefix = realRoot.endsWith(nodePath.sep) ? realRoot : `${realRoot}${nodePath.sep}`;
  return candidate.startsWith(prefix);
}

export interface ConfinedRoot {
  /** Lexically resolved absolute root. */
  readonly root: string;
  /** Lexically resolve a requested path inside the root. Throws on traversal. */
  resolve(requestedPath: string): string;
  /** The root with symlinks resolved (cached). */
  realRoot(): Promise<string>;
}

export function createConfinedRoot(root: string): ConfinedRoot {
  const resolvedRoot = nodePath.resolve(root);
  let realRootPromise: Promise<string> | undefined;

  return {
    root: resolvedRoot,
    resolve(requestedPath: string): string {
      const relative = String(requestedPath).replace(/^[\\/]+/, "");
      const resolvedPath = nodePath.resolve(resolvedRoot, relative);
      if (!isInsideRoot(resolvedRoot, resolvedPath)) {
        throw createAccessDeniedError(requestedPath);
      }
      return resolvedPath;
    },
    realRoot(): Promise<string> {
      if (!realRootPromise) {
        realRootPromise = fsPromises.realpath(resolvedRoot).catch((error) => {
          realRootPromise = undefined;
          throw error;
        });
      }
      return realRootPromise;
    },
  };
}

/**
 * Assert that an existing path resolves (after following symlinks) inside the real root.
 */
export async function assertRealPathInside(
  root: ConfinedRoot,
  absolutePath: string,
  requestedPath: string,
): Promise<string> {
  let realPath: string;
  try {
    realPath = await fsPromises.realpath(absolutePath);
  } catch (error) {
    throw normalizeFsError(error, requestedPath);
  }
  const realRoot = await root.realRoot();
  if (!isInsideRoot(realRoot, realPath)) {
    throw createAccessDeniedError(requestedPath);
  }
  return realPath;
}

/**
 * Assert that the nearest existing ancestor of a (possibly missing) path is inside the real root.
 * Used before creating files or directories so that symlinked ancestors cannot redirect writes.
 */
export async function assertNearestAncestorInside(
  root: ConfinedRoot,
  absolutePath: string,
  requestedPath: string,
): Promise<void> {
  let current = absolutePath;
  while (true) {
    let exists = true;
    try {
      await fsPromises.lstat(current);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT" && code !== "ENOTDIR") {
        throw normalizeFsError(error, requestedPath);
      }
      exists = false;
    }
    if (exists) {
      // Existing entries (including dangling symlinks) must resolve inside the root.
      await assertRealPathInside(root, current, requestedPath);
      return;
    }
    const parent = nodePath.dirname(current);
    if (parent === current) {
      throw createAccessDeniedError(requestedPath);
    }
    current = parent;
  }
}

export interface VerifiedFile {
  handle: FileHandle;
  stats: nodeFs.BigIntStats;
}

/**
 * Compute the identity version of a file snapshot.
 *
 * Any content-changing operation (write, truncate, replace, delete+recreate)
 * changes at least one of these fields.
 */
export function fileVersion(stats: nodeFs.BigIntStats): string {
  return `${stats.dev}:${stats.ino}:${stats.size}:${stats.mtimeNs}:${stats.ctimeNs}`;
}

/**
 * Open a regular file for reading, verifying that it is confined to the root.
 *
 * The file is opened first and its identity compared with the confined real
 * path afterwards, so a symlink swapped in between the two steps is detected.
 */
export async function openConfinedFile(
  root: ConfinedRoot,
  requestedPath: string,
): Promise<VerifiedFile> {
  const target = root.resolve(requestedPath);
  let handle: FileHandle;
  try {
    handle = await fsPromises.open(target, READ_FLAGS);
  } catch (error) {
    throw normalizeFsError(error, requestedPath);
  }

  try {
    const stats = await handle.stat({ bigint: true });
    if (!stats.isFile()) {
      throw createNotAFileError(requestedPath);
    }

    const realPath = await assertRealPathInside(root, target, requestedPath);
    let pathStats: nodeFs.BigIntStats;
    try {
      pathStats = await fsPromises.stat(realPath, { bigint: true });
    } catch (error) {
      throw normalizeFsError(error, requestedPath);
    }
    if (pathStats.dev !== stats.dev || pathStats.ino !== stats.ino) {
      throw createAccessDeniedError(requestedPath);
    }

    return { handle, stats };
  } catch (error) {
    await handle.close().catch(() => {});
    throw error;
  }
}

export interface ConfinedStat {
  isFile: boolean;
  isDirectory: boolean;
  size: number;
  lastModified: number;
  version?: string;
}

/**
 * Stat a confined path. Regular files are verified with an open-time identity
 * check and include a snapshot `version`.
 */
export async function statConfined(
  root: ConfinedRoot,
  requestedPath: string,
): Promise<ConfinedStat> {
  const target = root.resolve(requestedPath);
  let initial: nodeFs.Stats;
  try {
    initial = await fsPromises.stat(target);
  } catch (error) {
    throw normalizeFsError(error, requestedPath);
  }

  if (!initial.isFile()) {
    await assertRealPathInside(root, target, requestedPath);
    return {
      isFile: false,
      isDirectory: initial.isDirectory(),
      size: initial.size,
      lastModified: initial.mtimeMs,
    };
  }

  const file = await openConfinedFile(root, requestedPath);
  try {
    return {
      isFile: true,
      isDirectory: false,
      size: Number(file.stats.size),
      lastModified: Number(file.stats.mtimeMs),
      version: fileVersion(file.stats),
    };
  } finally {
    await file.handle.close().catch(() => {});
  }
}

/**
 * Read a whole confined file (used for explicit, eager reads).
 */
export async function readConfinedFile(
  root: ConfinedRoot,
  requestedPath: string,
): Promise<{ data: Uint8Array; stats: nodeFs.BigIntStats }> {
  const file = await openConfinedFile(root, requestedPath);
  try {
    const data = await file.handle.readFile();
    return {
      data: new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
      stats: file.stats,
    };
  } catch (error) {
    throw normalizeFsError(error, requestedPath);
  } finally {
    await file.handle.close().catch(() => {});
  }
}

export interface FileRangeStreamOptions {
  /** Inclusive start offset. */
  start: number;
  /** Exclusive end offset. */
  end: number;
  /** Snapshot version that the file must still match. */
  version?: string;
  /** Aborts the stream and closes the underlying file handle. */
  signal?: AbortSignal;
  /** Maximum chunk size. */
  chunkSize?: number;
}

function validateRange(requestedPath: string, start: number, end: number, size: number): void {
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 0 ||
    end < start ||
    end > size
  ) {
    throw createInvalidRangeError(requestedPath, start, end, size);
  }
}

/**
 * Create a pull-based stream over `[start, end)` of a verified file.
 *
 * The stream owns the file handle: it is closed when the range has been read,
 * on cancellation, on error, or when `signal` aborts. Each chunk is followed by
 * a version check so that a file modified mid-stream errors instead of
 * producing mixed content. Nothing is read before the consumer pulls.
 */
export function createFileRangeStream(
  file: VerifiedFile,
  requestedPath: string,
  options: FileRangeStreamOptions,
): ReadableStream<Uint8Array> {
  const chunkSize = Math.max(1, Math.floor(options.chunkSize ?? DEFAULT_FILE_STREAM_CHUNK_SIZE));
  const end = options.end;
  let position = options.start;
  let closed = false;
  let streamController: ReadableStreamDefaultController<Uint8Array> | undefined;

  const close = async () => {
    if (closed) {
      return;
    }
    closed = true;
    options.signal?.removeEventListener("abort", onAbort);
    await file.handle.close().catch(() => {});
  };

  const onAbort = () => {
    const reason = createAbortError(options.signal?.reason);
    void close();
    try {
      streamController?.error(reason);
    } catch {
      // Stream already closed or errored.
    }
  };

  if (options.signal?.aborted) {
    void close();
  } else {
    options.signal?.addEventListener("abort", onAbort, { once: true });
  }

  return new ReadableStream<Uint8Array>(
    {
      start(controller) {
        streamController = controller;
        if (options.signal?.aborted) {
          controller.error(createAbortError(options.signal.reason));
        }
      },
      async pull(controller) {
        if (closed) {
          return;
        }
        try {
          if (position >= end) {
            await close();
            controller.close();
            return;
          }

          const length = Math.min(chunkSize, end - position);
          const buffer = new Uint8Array(length);
          const { bytesRead } = await file.handle.read(buffer, 0, length, position);

          if (options.version !== undefined) {
            const current = await file.handle.stat({ bigint: true });
            if (fileVersion(current) !== options.version) {
              throw createFileChangedError(requestedPath);
            }
          }

          if (bytesRead === 0) {
            // The file is shorter than its snapshot.
            throw createFileChangedError(requestedPath);
          }

          position += bytesRead;
          controller.enqueue(bytesRead === length ? buffer : buffer.subarray(0, bytesRead));
          if (position >= end) {
            await close();
            controller.close();
          }
        } catch (error) {
          await close();
          if (options.signal?.aborted) {
            controller.error(createAbortError(options.signal.reason));
            return;
          }
          controller.error(normalizeFsError(error, requestedPath));
        }
      },
      async cancel() {
        await close();
      },
    },
    { highWaterMark: 0 },
  );
}

/**
 * Open a confined file and stream `[start, end)` of it.
 *
 * Rejects before returning a stream if the file is missing, escapes the root,
 * is not a regular file, no longer matches `version`, or the range is invalid.
 */
export async function openConfinedFileRangeStream(
  root: ConfinedRoot,
  requestedPath: string,
  options: FileRangeStreamOptions,
): Promise<ReadableStream<Uint8Array>> {
  if (options.signal?.aborted) {
    throw createAbortError(options.signal.reason);
  }
  const file = await openConfinedFile(root, requestedPath);
  try {
    if (options.version !== undefined && fileVersion(file.stats) !== options.version) {
      throw createFileChangedError(requestedPath);
    }
    validateRange(requestedPath, options.start, options.end, Number(file.stats.size));
  } catch (error) {
    await file.handle.close().catch(() => {});
    throw error;
  }
  return createFileRangeStream(file, requestedPath, options);
}

/**
 * Open a confined file for writing. The final path component must not be a
 * symlink and every existing ancestor must resolve inside the root.
 */
export async function openConfinedFileForWrite(
  root: ConfinedRoot,
  requestedPath: string,
): Promise<FileHandle> {
  const target = root.resolve(requestedPath);
  const parent = nodePath.dirname(target);
  await assertNearestAncestorInside(root, parent, requestedPath);
  await fsPromises.mkdir(parent, { recursive: true });
  await assertRealPathInside(root, parent, requestedPath);
  try {
    return await fsPromises.open(target, WRITE_FLAGS, 0o666);
  } catch (error) {
    throw normalizeFsError(error, requestedPath);
  }
}
