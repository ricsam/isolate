import * as nodeFs from "node:fs";
import * as nodePath from "node:path";
import { lookup as mimeLookup } from "mime-types";
import type { FileSystemHandler } from "./index.ts";

export interface NodeFileSystemHandlerOptions {
  /** Custom fs module (e.g., memfs for testing). Defaults to Node.js fs */
  fs?: typeof nodeFs;
}

/**
 * Create a FileSystemHandler backed by the Node.js filesystem
 *
 * @param rootPath - Absolute path to the root directory for the sandbox
 * @param options - Optional configuration
 * @returns FileSystemHandler implementation
 *
 * @example
 * import { createNodeFileSystemHandler } from "@ricsam/isolate-fs";
 *
 * const handler = createNodeFileSystemHandler("/tmp/sandbox");
 *
 * // Use with createRuntime
 * const runtime = await createRuntime({
 *   fs: { handler }
 * });
 */
export function createNodeFileSystemHandler(
  rootPath: string,
  options?: NodeFileSystemHandlerOptions
): FileSystemHandler {
  const fs = options?.fs ?? nodeFs;
  const fsPromises = fs.promises;

  // Resolve the root path to ensure it's absolute
  const resolvedRoot = nodePath.resolve(rootPath);

  /**
   * Map a virtual path to a real filesystem path
   * Virtual paths always start with "/" and are relative to rootPath
   */
  function toRealPath(virtualPath: string): string {
    // Normalize the virtual path
    const normalized = nodePath.normalize(virtualPath);
    // Join with root, handling the leading slash
    const relativePath = normalized.startsWith("/")
      ? normalized.slice(1)
      : normalized;
    return nodePath.join(resolvedRoot, relativePath);
  }

  /**
   * Map Node.js errors to DOMException-style error messages
   */
  function mapError(err: unknown, operation: string): Error {
    if (!(err instanceof Error)) {
      return new Error(`[Error]${operation} failed`);
    }

    const nodeError = err as NodeJS.ErrnoException;

    switch (nodeError.code) {
      case "ENOENT":
        return new Error(`[NotFoundError]${operation}: path not found`);
      case "EISDIR":
        return new Error(
          `[TypeMismatchError]${operation}: expected file but found directory`
        );
      case "ENOTDIR":
        return new Error(
          `[TypeMismatchError]${operation}: expected directory but found file`
        );
      case "ENOTEMPTY":
        return new Error(
          `[InvalidModificationError]${operation}: directory not empty`
        );
      case "EEXIST":
        return new Error(`[InvalidModificationError]${operation}: already exists`);
      case "EACCES":
      case "EPERM":
        return new Error(`[NotAllowedError]${operation}: permission denied`);
      default:
        return new Error(`[Error]${operation}: ${nodeError.message}`);
    }
  }

  /**
   * Get MIME type for a file based on extension
   */
  function getMimeType(filePath: string): string {
    const result = mimeLookup(filePath);
    return result || "application/octet-stream";
  }

  return {
    async getFileHandle(
      path: string,
      options?: { create?: boolean }
    ): Promise<void> {
      const realPath = toRealPath(path);

      try {
        const stats = await fsPromises.stat(realPath);
        if (stats.isDirectory()) {
          throw new Error(
            "[TypeMismatchError]getFileHandle: expected file but found directory"
          );
        }
        // File exists and is a file - success
      } catch (err) {
        const nodeError = err as NodeJS.ErrnoException;
        if (nodeError.code === "ENOENT") {
          if (options?.create) {
            // Create empty file
            await fsPromises.writeFile(realPath, "");
            return;
          }
          throw new Error("[NotFoundError]getFileHandle: file not found");
        }
        throw mapError(err, "getFileHandle");
      }
    },

    async getDirectoryHandle(
      path: string,
      options?: { create?: boolean }
    ): Promise<void> {
      const realPath = toRealPath(path);

      try {
        const stats = await fsPromises.stat(realPath);
        if (!stats.isDirectory()) {
          throw new Error(
            "[TypeMismatchError]getDirectoryHandle: expected directory but found file"
          );
        }
        // Directory exists - success
      } catch (err) {
        const nodeError = err as NodeJS.ErrnoException;
        if (nodeError.code === "ENOENT") {
          if (options?.create) {
            // Create directory
            await fsPromises.mkdir(realPath, { recursive: true });
            return;
          }
          throw new Error(
            "[NotFoundError]getDirectoryHandle: directory not found"
          );
        }
        throw mapError(err, "getDirectoryHandle");
      }
    },

    async removeEntry(
      path: string,
      options?: { recursive?: boolean }
    ): Promise<void> {
      const realPath = toRealPath(path);

      try {
        const stats = await fsPromises.stat(realPath);

        if (stats.isDirectory()) {
          if (options?.recursive) {
            // Use rm with recursive for non-empty directories
            await fsPromises.rm(realPath, { recursive: true });
          } else {
            // Try rmdir for empty directories (will fail if not empty)
            await fsPromises.rmdir(realPath);
          }
        } else {
          // Use unlink for files
          await fsPromises.unlink(realPath);
        }
      } catch (err) {
        throw mapError(err, "removeEntry");
      }
    },

    async readDirectory(
      path: string
    ): Promise<Array<{ name: string; kind: "file" | "directory" }>> {
      const realPath = toRealPath(path);

      try {
        const entries = await fsPromises.readdir(realPath, {
          withFileTypes: true,
        });

        return entries.map((entry) => ({
          name: entry.name,
          kind: entry.isDirectory() ? ("directory" as const) : ("file" as const),
        }));
      } catch (err) {
        throw mapError(err, "readDirectory");
      }
    },

    async readFile(
      path: string
    ): Promise<{
      data: Uint8Array;
      size: number;
      lastModified: number;
      type: string;
    }> {
      const realPath = toRealPath(path);

      try {
        const [data, stats] = await Promise.all([
          fsPromises.readFile(realPath),
          fsPromises.stat(realPath),
        ]);

        if (stats.isDirectory()) {
          throw new Error(
            "[TypeMismatchError]readFile: expected file but found directory"
          );
        }

        return {
          data: new Uint8Array(data),
          size: stats.size,
          lastModified: stats.mtimeMs,
          type: getMimeType(realPath),
        };
      } catch (err) {
        if (err instanceof Error && err.message.startsWith("[")) {
          throw err;
        }
        throw mapError(err, "readFile");
      }
    },

    async writeFile(
      path: string,
      data: Uint8Array,
      position?: number
    ): Promise<void> {
      const realPath = toRealPath(path);

      try {
        // Check file exists first (matches WHATWG semantics where file must exist via getFileHandle)
        await fsPromises.access(realPath);

        if (position !== undefined) {
          // Position-based write - need to use r+ to preserve existing content
          const fh = await fsPromises.open(realPath, "r+");
          try {
            await fh.write(data, 0, data.length, position);
          } finally {
            await fh.close();
          }
        } else {
          // Replace entire content
          await fsPromises.writeFile(realPath, data);
        }
      } catch (err) {
        throw mapError(err, "writeFile");
      }
    },

    async truncateFile(path: string, size: number): Promise<void> {
      const realPath = toRealPath(path);

      try {
        await fsPromises.truncate(realPath, size);
      } catch (err) {
        throw mapError(err, "truncateFile");
      }
    },

    async getFileMetadata(
      path: string
    ): Promise<{ size: number; lastModified: number; type: string }> {
      const realPath = toRealPath(path);

      try {
        const stats = await fsPromises.stat(realPath);

        if (stats.isDirectory()) {
          throw new Error(
            "[TypeMismatchError]getFileMetadata: expected file but found directory"
          );
        }

        return {
          size: stats.size,
          lastModified: stats.mtimeMs,
          type: getMimeType(realPath),
        };
      } catch (err) {
        if (err instanceof Error && err.message.startsWith("[")) {
          throw err;
        }
        throw mapError(err, "getFileMetadata");
      }
    },
  };
}
