/**
 * Callback-based FileSystemHandler adapter.
 *
 * Adapts simple client callbacks (readFile, writeFile, etc.) to the
 * FileSystemHandler interface used by @ricsam/isolate-fs.
 */

import type { FileSystemHandler } from "@ricsam/isolate-fs";
import type { FsCallbackRegistrations, CallbackRegistration } from "@ricsam/isolate-protocol";
import type { ConnectionState } from "./types.ts";

interface InvokeClientCallback {
  (connection: ConnectionState, callbackId: number, args: unknown[]): Promise<unknown>;
}

interface CallbackFsHandlerOptions {
  connection: ConnectionState;
  callbacks: FsCallbackRegistrations;
  invokeClientCallback: InvokeClientCallback;
  basePath?: string;
}

/**
 * Create a FileSystemHandler that invokes client callbacks.
 *
 * Maps WHATWG FileSystem API operations to simple POSIX-like callbacks.
 */
export function createCallbackFileSystemHandler(
  options: CallbackFsHandlerOptions
): FileSystemHandler {
  const { connection, callbacks, invokeClientCallback, basePath = "" } = options;

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

  return {
    async getFileHandle(path: string, opts?: { create?: boolean }): Promise<void> {
      const fullPath = resolvePath(path);

      if (opts?.create) {
        // Ensure file exists by writing empty content if it doesn't exist
        if (callbacks.writeFile) {
          try {
            // Check if file exists first
            if (callbacks.stat) {
              try {
                await invokeClientCallback(connection, callbacks.stat.callbackId, [fullPath]);
                // File exists, nothing to do
                return;
              } catch {
                // File doesn't exist, create it
              }
            }
            // Create empty file
            await invokeClientCallback(connection, callbacks.writeFile.callbackId, [
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
      if (callbacks.stat) {
        try {
          const result = (await invokeClientCallback(connection, callbacks.stat.callbackId, [
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

      if (opts?.create) {
        if (callbacks.mkdir) {
          try {
            await invokeClientCallback(connection, callbacks.mkdir.callbackId, [
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
      if (callbacks.stat) {
        try {
          const result = (await invokeClientCallback(connection, callbacks.stat.callbackId, [
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

      // Check if it's a file or directory
      let isFile = true;
      if (callbacks.stat) {
        try {
          const result = (await invokeClientCallback(connection, callbacks.stat.callbackId, [
            fullPath,
          ])) as { isFile: boolean; isDirectory: boolean };
          isFile = result.isFile;
        } catch {
          throw new Error(`[NotFoundError]Entry not found: ${fullPath}`);
        }
      }

      if (isFile) {
        if (!callbacks.unlink) {
          throw new Error(`[NotAllowedError]File deletion not supported`);
        }
        await invokeClientCallback(connection, callbacks.unlink.callbackId, [fullPath]);
      } else {
        if (!callbacks.rmdir) {
          throw new Error(`[NotAllowedError]Directory deletion not supported`);
        }
        // Note: recursive option may need special handling
        await invokeClientCallback(connection, callbacks.rmdir.callbackId, [fullPath]);
      }
    },

    async readDirectory(
      path: string
    ): Promise<Array<{ name: string; kind: "file" | "directory" }>> {
      const fullPath = resolvePath(path);

      if (!callbacks.readdir) {
        throw new Error(`[NotAllowedError]Directory reading not supported`);
      }

      const entries = (await invokeClientCallback(connection, callbacks.readdir.callbackId, [
        fullPath,
      ])) as string[];

      // We need to stat each entry to determine if it's a file or directory
      const result: Array<{ name: string; kind: "file" | "directory" }> = [];

      for (const name of entries) {
        const entryPath = fullPath ? `${fullPath}/${name}` : name;
        let kind: "file" | "directory" = "file";

        if (callbacks.stat) {
          try {
            const stat = (await invokeClientCallback(connection, callbacks.stat.callbackId, [
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

      if (!callbacks.readFile) {
        throw new Error(`[NotAllowedError]File reading not supported`);
      }

      const data = (await invokeClientCallback(connection, callbacks.readFile.callbackId, [
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

      if (callbacks.stat) {
        try {
          const stat = (await invokeClientCallback(connection, callbacks.stat.callbackId, [
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
      const mimeTypes: Record<string, string> = {
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
      const type = mimeTypes[ext] || "application/octet-stream";

      return { data: bytes, size, lastModified, type };
    },

    async writeFile(path: string, data: Uint8Array, position?: number): Promise<void> {
      const fullPath = resolvePath(path);

      if (!callbacks.writeFile) {
        throw new Error(`[NotAllowedError]File writing not supported`);
      }

      // Note: position parameter for partial writes may need special handling
      // Simple implementation overwrites entire file
      if (position !== undefined && position > 0) {
        // For positional writes, we need to read existing content and merge
        if (callbacks.readFile) {
          try {
            const existing = (await invokeClientCallback(
              connection,
              callbacks.readFile.callbackId,
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

            await invokeClientCallback(connection, callbacks.writeFile.callbackId, [
              fullPath,
              merged,
            ]);
            return;
          } catch {
            // File doesn't exist, create new one at position
            const newData = new Uint8Array(position + data.length);
            newData.set(data, position);
            await invokeClientCallback(connection, callbacks.writeFile.callbackId, [
              fullPath,
              newData,
            ]);
            return;
          }
        }
      }

      await invokeClientCallback(connection, callbacks.writeFile.callbackId, [fullPath, data]);
    },

    async truncateFile(path: string, size: number): Promise<void> {
      const fullPath = resolvePath(path);

      if (!callbacks.readFile || !callbacks.writeFile) {
        throw new Error(`[NotAllowedError]File truncation not supported`);
      }

      // Read existing content
      const existing = (await invokeClientCallback(connection, callbacks.readFile.callbackId, [
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

      await invokeClientCallback(connection, callbacks.writeFile.callbackId, [fullPath, truncated]);
    },

    async getFileMetadata(
      path: string
    ): Promise<{ size: number; lastModified: number; type: string }> {
      const fullPath = resolvePath(path);

      if (!callbacks.stat) {
        throw new Error(`[NotAllowedError]File stat not supported`);
      }

      const stat = (await invokeClientCallback(connection, callbacks.stat.callbackId, [
        fullPath,
      ])) as { size: number; lastModified?: number; isFile: boolean };

      if (!stat.isFile) {
        throw new Error(`[TypeMismatchError]Not a file: ${fullPath}`);
      }

      // Determine MIME type from extension
      const ext = path.split(".").pop()?.toLowerCase() || "";
      const mimeTypes: Record<string, string> = {
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
      const type = mimeTypes[ext] || "application/octet-stream";

      return {
        size: stat.size,
        lastModified: stat.lastModified ?? Date.now(),
        type,
      };
    },
  };
}
