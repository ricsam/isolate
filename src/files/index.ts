import fs from "node:fs/promises";
import path from "node:path";
import {
  assertNearestAncestorInside,
  assertRealPathInside,
  createConfinedRoot,
  normalizeFsError,
  openConfinedFileForWrite,
  openConfinedFileRangeStream,
  readConfinedFile,
  statConfined,
} from "../internal/fs/confined-file.ts";
import type { FileBindings } from "../types.ts";

/**
 * Create root-confined file bindings backed by the Node.js filesystem.
 *
 * Every operation stays inside `root`: `../` traversal is rejected lexically,
 * and symlinks are resolved so that no entry can reach outside the real root.
 * Reads open the file first and then verify its identity against the confined
 * real path, so swapping a path component for a symlink cannot redirect them.
 *
 * `stat()` reports a snapshot `version` for regular files and
 * `readFileStream()` streams byte ranges of that snapshot, so sandbox
 * `getFile()` calls return lazy, disk-backed files whose contents are only
 * read on demand. A lazy file whose underlying file is replaced, truncated,
 * deleted, or modified fails with `NotReadableError` instead of serving
 * different content.
 */
export function createFileBindings(options: {
  root: string;
  allowWrite?: boolean;
}): FileBindings {
  const allowWrite = options.allowWrite ?? false;
  const root = createConfinedRoot(options.root);

  const assertWritable = () => {
    if (!allowWrite) {
      throw new Error("Write access is disabled for these file bindings.");
    }
  };

  return {
    readFile: async (requestedPath) => {
      const { data } = await readConfinedFile(root, requestedPath);
      return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
    },
    readFileStream: async (requestedPath, streamOptions, context) => {
      return await openConfinedFileRangeStream(root, requestedPath, {
        start: streamOptions.start,
        end: streamOptions.end,
        version: streamOptions.version,
        signal: context.signal,
      });
    },
    writeFile: async (requestedPath, data) => {
      assertWritable();
      const handle = await openConfinedFileForWrite(root, requestedPath);
      try {
        await handle.writeFile(Buffer.from(data));
      } catch (error) {
        throw normalizeFsError(error, requestedPath);
      } finally {
        await handle.close().catch(() => {});
      }
    },
    unlink: async (requestedPath) => {
      assertWritable();
      const safePath = root.resolve(requestedPath);
      await assertRealPathInside(root, path.dirname(safePath), requestedPath);
      try {
        await fs.unlink(safePath);
      } catch (error) {
        throw normalizeFsError(error, requestedPath);
      }
    },
    readdir: async (requestedPath) => {
      const safePath = root.resolve(requestedPath);
      const realPath = await assertRealPathInside(root, safePath, requestedPath);
      try {
        return await fs.readdir(realPath);
      } catch (error) {
        throw normalizeFsError(error, requestedPath);
      }
    },
    mkdir: async (requestedPath, mkdirOptions) => {
      assertWritable();
      const safePath = root.resolve(requestedPath);
      await assertNearestAncestorInside(root, safePath, requestedPath);
      try {
        await fs.mkdir(safePath, { recursive: mkdirOptions?.recursive ?? false });
      } catch (error) {
        throw normalizeFsError(error, requestedPath);
      }
      await assertRealPathInside(root, safePath, requestedPath);
    },
    rmdir: async (requestedPath) => {
      assertWritable();
      const safePath = root.resolve(requestedPath);
      await assertRealPathInside(root, path.dirname(safePath), requestedPath);
      try {
        await fs.rmdir(safePath);
      } catch (error) {
        throw normalizeFsError(error, requestedPath);
      }
    },
    stat: async (requestedPath) => {
      return await statConfined(root, requestedPath);
    },
    rename: async (from, to) => {
      assertWritable();
      const safeFrom = root.resolve(from);
      const safeTo = root.resolve(to);
      await assertRealPathInside(root, path.dirname(safeFrom), from);
      await assertNearestAncestorInside(root, path.dirname(safeTo), to);
      try {
        await fs.rename(safeFrom, safeTo);
      } catch (error) {
        throw normalizeFsError(error, from);
      }
    },
  };
}
