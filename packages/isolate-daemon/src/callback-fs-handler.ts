/**
 * Callback-based FileSystemHandler adapter.
 *
 * Adapts simple client callbacks (readFile, writeFile, etc.) to the
 * FileSystemHandler interface used by @ricsam/isolate-fs.
 */

import type { FileSystemHandler } from "@ricsam/isolate-fs";
import type { ConnectionState, CallbackContext } from "./types.ts";

/** Common MIME type mappings by file extension. */
const MIME_TYPES: Record<string, string> = {
  txt: "text/plain",
  html: "text/html",
  htm: "text/html",
  css: "text/css",
  js: "text/javascript",
  json: "application/json",
  xml: "application/xml",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  svg: "image/svg+xml",
  pdf: "application/pdf",
};

interface InvokeClientCallback {
  (connection: ConnectionState, callbackId: number, args: unknown[]): Promise<unknown>;
}

interface CallbackFsHandlerOptions {
  connection: ConnectionState;
  callbackContext: CallbackContext;
  invokeClientCallback: InvokeClientCallback;
  basePath?: string;
}

/**
 * Create a FileSystemHandler that invokes client callbacks.
 *
 * Maps WHATWG FileSystem API operations to simple POSIX-like callbacks.
 * Uses callbackContext for dynamic callback ID lookup to support runtime reuse.
 */
export function createCallbackFileSystemHandler(
  options: CallbackFsHandlerOptions
): FileSystemHandler {
  const { connection, callbackContext, invokeClientCallback, basePath = "" } = options;

  const resolvePath = (path: string): string => {
    // Remove leading slash from the path
    const cleanPath = path.startsWith("/") ? path.slice(1) : path;
    // Handle root case
    if (!basePath || basePath === "/") {
      return `/${cleanPath}`;
    }
    // Remove trailing slash from basePath
    const cleanBase = basePath.endsWith("/") ? basePath.slice(0, -1) : basePath;
    return `${cleanBase}/${cleanPath}`;
  };

  // Helper to get current callback ID (supports runtime reuse)
  const getCallbackId = (name: keyof CallbackContext["fs"]): number | undefined => {
    return callbackContext.fs[name];
  };

  // Helper to get current connection (supports runtime reuse)
  const getConnection = (): ConnectionState => {
    return callbackContext.connection || connection;
  };

  return {
    async getFileHandle(path: string, opts?: { create?: boolean }): Promise<void> {
      const fullPath = resolvePath(path);
      const conn = getConnection();

      if (opts?.create) {
        // Ensure file exists by writing empty content if it doesn't exist
        const writeFileId = getCallbackId("writeFile");
        if (writeFileId !== undefined) {
          try {
            // Check if file exists first
            const statId = getCallbackId("stat");
            if (statId !== undefined) {
              try {
                await invokeClientCallback(conn, statId, [fullPath]);
                // File exists, nothing to do
                return;
              } catch {
                // File doesn't exist, create it
              }
            }
            // Create empty file
            await invokeClientCallback(conn, writeFileId, [
              fullPath,
              new Uint8Array(0),
            ]);
          } catch (err) {
            const error = err as Error;
            throw new Error(`[NotFoundError]${error.message}`);
          }
        }
        return;
      }

      // Check file exists
      const statId = getCallbackId("stat");
      if (statId !== undefined) {
        try {
          const result = (await invokeClientCallback(conn, statId, [
            fullPath,
          ])) as { isFile: boolean };
          if (!result.isFile) {
            throw new Error(`[TypeMismatchError]Not a file: ${fullPath}`);
          }
        } catch (err) {
          const error = err as Error;
          if (error.message.includes("TypeMismatchError")) throw error;
          throw new Error(`[NotFoundError]File not found: ${fullPath}`);
        }
      }
    },

    async getDirectoryHandle(path: string, opts?: { create?: boolean }): Promise<void> {
      const fullPath = resolvePath(path);
      const conn = getConnection();

      if (opts?.create) {
        const mkdirId = getCallbackId("mkdir");
        if (mkdirId !== undefined) {
          try {
            await invokeClientCallback(conn, mkdirId, [
              fullPath,
              { recursive: true },
            ]);
          } catch {
            // Ignore error if directory already exists
          }
        }
        return;
      }

      // Check directory exists
      const statId = getCallbackId("stat");
      if (statId !== undefined) {
        try {
          const result = (await invokeClientCallback(conn, statId, [
            fullPath,
          ])) as { isDirectory: boolean };
          if (!result.isDirectory) {
            throw new Error(`[TypeMismatchError]Not a directory: ${fullPath}`);
          }
        } catch (err) {
          const error = err as Error;
          if (error.message.includes("TypeMismatchError")) throw error;
          throw new Error(`[NotFoundError]Directory not found: ${fullPath}`);
        }
      }
    },

    async removeEntry(path: string, opts?: { recursive?: boolean }): Promise<void> {
      const fullPath = resolvePath(path);
      const conn = getConnection();

      // Check if it's a file or directory
      let isFile = true;
      const statId = getCallbackId("stat");
      if (statId !== undefined) {
        try {
          const result = (await invokeClientCallback(conn, statId, [
            fullPath,
          ])) as { isFile: boolean; isDirectory: boolean };
          isFile = result.isFile;
        } catch {
          throw new Error(`[NotFoundError]Entry not found: ${fullPath}`);
        }
      }

      if (isFile) {
        const unlinkId = getCallbackId("unlink");
        if (unlinkId === undefined) {
          throw new Error(`[NotAllowedError]File deletion not supported`);
        }
        await invokeClientCallback(conn, unlinkId, [fullPath]);
      } else {
        const rmdirId = getCallbackId("rmdir");
        if (rmdirId === undefined) {
          throw new Error(`[NotAllowedError]Directory deletion not supported`);
        }
        // Note: recursive option may need special handling
        await invokeClientCallback(conn, rmdirId, [fullPath]);
      }
    },

    async readDirectory(
      path: string
    ): Promise<Array<{ name: string; kind: "file" | "directory" }>> {
      const fullPath = resolvePath(path);
      const conn = getConnection();

      const readdirId = getCallbackId("readdir");
      if (readdirId === undefined) {
        throw new Error(`[NotAllowedError]Directory reading not supported`);
      }

      const entries = (await invokeClientCallback(conn, readdirId, [
        fullPath,
      ])) as string[];

      // We need to stat each entry to determine if it's a file or directory
      const result: Array<{ name: string; kind: "file" | "directory" }> = [];

      const statId = getCallbackId("stat");
      for (const name of entries) {
        const entryPath = fullPath ? `${fullPath}/${name}` : name;
        let kind: "file" | "directory" = "file";

        if (statId !== undefined) {
          try {
            const stat = (await invokeClientCallback(conn, statId, [
              entryPath,
            ])) as { isFile: boolean; isDirectory: boolean };
            kind = stat.isDirectory ? "directory" : "file";
          } catch {
            // Default to file if stat fails
          }
        }

        result.push({ name, kind });
      }

      return result;
    },

    async readFile(
      path: string
    ): Promise<{ data: Uint8Array; size: number; lastModified: number; type: string }> {
      const fullPath = resolvePath(path);
      const conn = getConnection();

      const readFileId = getCallbackId("readFile");
      if (readFileId === undefined) {
        throw new Error(`[NotAllowedError]File reading not supported`);
      }

      const data = (await invokeClientCallback(conn, readFileId, [
        fullPath,
      ])) as Uint8Array | ArrayBuffer | number[];

      // Convert to Uint8Array if needed
      let bytes: Uint8Array;
      if (data instanceof Uint8Array) {
        bytes = data;
      } else if (Array.isArray(data)) {
        bytes = new Uint8Array(data);
      } else if (data instanceof ArrayBuffer) {
        bytes = new Uint8Array(data);
      } else {
        bytes = new Uint8Array(0);
      }

      // Get metadata if stat is available
      let size = bytes.length;
      let lastModified = Date.now();

      const statId = getCallbackId("stat");
      if (statId !== undefined) {
        try {
          const stat = (await invokeClientCallback(conn, statId, [
            fullPath,
          ])) as { size: number; lastModified?: number };
          size = stat.size;
          if (stat.lastModified) {
            lastModified = stat.lastModified;
          }
        } catch {
          // Use byte length as fallback
        }
      }

      // Determine MIME type from extension
      const ext = path.split(".").pop()?.toLowerCase() || "";
      const type = MIME_TYPES[ext] || "application/octet-stream";

      return { data: bytes, size, lastModified, type };
    },

    async writeFile(path: string, data: Uint8Array, position?: number): Promise<void> {
      const fullPath = resolvePath(path);
      const conn = getConnection();

      const writeFileId = getCallbackId("writeFile");
      if (writeFileId === undefined) {
        throw new Error(`[NotAllowedError]File writing not supported`);
      }

      // Note: position parameter for partial writes may need special handling
      // Simple implementation overwrites entire file
      if (position !== undefined && position > 0) {
        // For positional writes, we need to read existing content and merge
        const readFileId = getCallbackId("readFile");
        if (readFileId !== undefined) {
          try {
            const existing = (await invokeClientCallback(
              conn,
              readFileId,
              [fullPath]
            )) as Uint8Array | ArrayBuffer | number[];

            let existingBytes: Uint8Array;
            if (existing instanceof Uint8Array) {
              existingBytes = existing;
            } else if (Array.isArray(existing)) {
              existingBytes = new Uint8Array(existing);
            } else if (existing instanceof ArrayBuffer) {
              existingBytes = new Uint8Array(existing);
            } else {
              existingBytes = new Uint8Array(0);
            }

            // Create merged buffer
            const newSize = Math.max(existingBytes.length, position + data.length);
            const merged = new Uint8Array(newSize);
            merged.set(existingBytes);
            merged.set(data, position);

            await invokeClientCallback(conn, writeFileId, [
              fullPath,
              merged,
            ]);
            return;
          } catch {
            // File doesn't exist, create new one at position
            const newData = new Uint8Array(position + data.length);
            newData.set(data, position);
            await invokeClientCallback(conn, writeFileId, [
              fullPath,
              newData,
            ]);
            return;
          }
        }
      }

      await invokeClientCallback(conn, writeFileId, [fullPath, data]);
    },

    async truncateFile(path: string, size: number): Promise<void> {
      const fullPath = resolvePath(path);
      const conn = getConnection();

      const readFileId = getCallbackId("readFile");
      const writeFileId = getCallbackId("writeFile");
      if (readFileId === undefined || writeFileId === undefined) {
        throw new Error(`[NotAllowedError]File truncation not supported`);
      }

      // Read existing content
      const existing = (await invokeClientCallback(conn, readFileId, [
        fullPath,
      ])) as Uint8Array | ArrayBuffer | number[];

      let existingBytes: Uint8Array;
      if (existing instanceof Uint8Array) {
        existingBytes = existing;
      } else if (Array.isArray(existing)) {
        existingBytes = new Uint8Array(existing);
      } else if (existing instanceof ArrayBuffer) {
        existingBytes = new Uint8Array(existing);
      } else {
        existingBytes = new Uint8Array(0);
      }

      // Create truncated buffer
      const truncated = new Uint8Array(size);
      truncated.set(existingBytes.slice(0, size));

      await invokeClientCallback(conn, writeFileId, [fullPath, truncated]);
    },

    async getFileMetadata(
      path: string
    ): Promise<{ size: number; lastModified: number; type: string }> {
      const fullPath = resolvePath(path);
      const conn = getConnection();

      const statId = getCallbackId("stat");
      if (statId === undefined) {
        throw new Error(`[NotAllowedError]File stat not supported`);
      }

      const stat = (await invokeClientCallback(conn, statId, [
        fullPath,
      ])) as { size: number; lastModified?: number; isFile: boolean };

      if (!stat.isFile) {
        throw new Error(`[TypeMismatchError]Not a file: ${fullPath}`);
      }

      // Determine MIME type from extension
      const ext = path.split(".").pop()?.toLowerCase() || "";
      const type = MIME_TYPES[ext] || "application/octet-stream";

      return {
        size: stat.size,
        lastModified: stat.lastModified ?? Date.now(),
        type,
      };
    },
  };
}
