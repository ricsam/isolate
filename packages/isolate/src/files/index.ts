import fs from "node:fs/promises";
import path from "node:path";
import type { FileBindings } from "../types.ts";

function resolveSafePath(root: string, requestedPath: string): string {
  const resolvedRoot = path.resolve(root);
  const resolvedPath = path.resolve(path.join(resolvedRoot, requestedPath));
  if (!resolvedPath.startsWith(`${resolvedRoot}${path.sep}`) && resolvedPath !== resolvedRoot) {
    throw new Error(`Access denied: ${requestedPath}`);
  }
  return resolvedPath;
}

export function createFileBindings(options: {
  root: string;
  allowWrite?: boolean;
}): FileBindings {
  const allowWrite = options.allowWrite ?? false;

  return {
    readFile: async (requestedPath) => {
      const safePath = resolveSafePath(options.root, requestedPath);
      const buffer = await fs.readFile(safePath);
      return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
    },
    writeFile: async (requestedPath, data) => {
      if (!allowWrite) {
        throw new Error("Write access is disabled for these file bindings.");
      }
      const safePath = resolveSafePath(options.root, requestedPath);
      await fs.mkdir(path.dirname(safePath), { recursive: true });
      await fs.writeFile(safePath, Buffer.from(data));
    },
    unlink: async (requestedPath) => {
      if (!allowWrite) {
        throw new Error("Write access is disabled for these file bindings.");
      }
      const safePath = resolveSafePath(options.root, requestedPath);
      await fs.unlink(safePath);
    },
    readdir: async (requestedPath) => {
      const safePath = resolveSafePath(options.root, requestedPath);
      return await fs.readdir(safePath);
    },
    mkdir: async (requestedPath, mkdirOptions) => {
      if (!allowWrite) {
        throw new Error("Write access is disabled for these file bindings.");
      }
      const safePath = resolveSafePath(options.root, requestedPath);
      await fs.mkdir(safePath, { recursive: mkdirOptions?.recursive ?? false });
    },
    rmdir: async (requestedPath) => {
      if (!allowWrite) {
        throw new Error("Write access is disabled for these file bindings.");
      }
      const safePath = resolveSafePath(options.root, requestedPath);
      await fs.rmdir(safePath);
    },
    stat: async (requestedPath) => {
      const safePath = resolveSafePath(options.root, requestedPath);
      const stats = await fs.stat(safePath);
      return {
        isFile: stats.isFile(),
        isDirectory: stats.isDirectory(),
        size: stats.size,
      };
    },
    rename: async (from, to) => {
      if (!allowWrite) {
        throw new Error("Write access is disabled for these file bindings.");
      }
      const safeFrom = resolveSafePath(options.root, from);
      const safeTo = resolveSafePath(options.root, to);
      await fs.rename(safeFrom, safeTo);
    },
  };
}
