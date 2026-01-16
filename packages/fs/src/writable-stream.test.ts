/**
 * Tests for FileSystemWritableFileStream.getWriter()
 * Verifies fix for Issue 5
 */

import { test, describe } from "node:test";
import assert from "node:assert";
import ivm from "isolated-vm";
import { setupFs, type FileSystemHandler } from "./index.ts";

// Simple in-memory file system handler for testing
function createMemoryHandler(): FileSystemHandler {
  const files = new Map<string, { data: Uint8Array; lastModified: number }>();
  const directories = new Set<string>([""]);

  return {
    async getFileHandle(path: string, options?: { create?: boolean }) {
      const normalizedPath = path.startsWith("/") ? path.slice(1) : path;
      if (!files.has(normalizedPath) && options?.create) {
        files.set(normalizedPath, { data: new Uint8Array(0), lastModified: Date.now() });
      }
      if (!files.has(normalizedPath)) {
        throw new Error(`File not found: ${path}`);
      }
    },
    async getDirectoryHandle(path: string, options?: { create?: boolean }) {
      const normalizedPath = path.startsWith("/") ? path.slice(1) : path;
      if (!directories.has(normalizedPath) && options?.create) {
        directories.add(normalizedPath);
      }
    },
    async removeEntry(path: string) {
      const normalizedPath = path.startsWith("/") ? path.slice(1) : path;
      files.delete(normalizedPath);
      directories.delete(normalizedPath);
    },
    async readDirectory(path: string) {
      const normalizedPath = path.startsWith("/") ? path.slice(1) : path;
      const prefix = normalizedPath ? normalizedPath + "/" : "";
      const entries: Array<{ name: string; kind: "file" | "directory" }> = [];

      for (const filePath of files.keys()) {
        if (filePath.startsWith(prefix)) {
          const relativePath = filePath.slice(prefix.length);
          if (!relativePath.includes("/")) {
            entries.push({ name: relativePath, kind: "file" });
          }
        }
      }

      for (const dirPath of directories) {
        if (dirPath.startsWith(prefix) && dirPath !== normalizedPath) {
          const relativePath = dirPath.slice(prefix.length);
          if (!relativePath.includes("/")) {
            entries.push({ name: relativePath, kind: "directory" });
          }
        }
      }

      return entries;
    },
    async readFile(path: string) {
      const normalizedPath = path.startsWith("/") ? path.slice(1) : path;
      const file = files.get(normalizedPath);
      if (!file) {
        throw new Error(`File not found: ${path}`);
      }
      return {
        data: file.data,
        size: file.data.byteLength,
        lastModified: file.lastModified,
        type: "text/plain",
      };
    },
    async writeFile(path: string, data: Uint8Array, position?: number) {
      const normalizedPath = path.startsWith("/") ? path.slice(1) : path;
      const existing = files.get(normalizedPath);

      if (position !== undefined && existing) {
        const newData = new Uint8Array(Math.max(existing.data.length, position + data.length));
        newData.set(existing.data);
        newData.set(data, position);
        files.set(normalizedPath, { data: newData, lastModified: Date.now() });
      } else {
        files.set(normalizedPath, { data, lastModified: Date.now() });
      }
    },
    async truncateFile(path: string, size: number) {
      const normalizedPath = path.startsWith("/") ? path.slice(1) : path;
      const existing = files.get(normalizedPath);
      if (existing) {
        const newData = new Uint8Array(size);
        newData.set(existing.data.slice(0, size));
        files.set(normalizedPath, { data: newData, lastModified: Date.now() });
      }
    },
    async getFileMetadata(path: string) {
      const normalizedPath = path.startsWith("/") ? path.slice(1) : path;
      const file = files.get(normalizedPath);
      if (!file) {
        throw new Error(`File not found: ${path}`);
      }
      return {
        size: file.data.byteLength,
        lastModified: file.lastModified,
        type: "text/plain",
      };
    },
  };
}

describe("FileSystemWritableFileStream.getWriter()", () => {
  test("getWriter() returns a valid writer object", async () => {
    const isolate = new ivm.Isolate();
    const context = await isolate.createContext();

    const fsHandler = createMemoryHandler();
    const handle = await setupFs(context, {
      getDirectory: async () => fsHandler,
    });

    try {
      const resultJson = await context.eval(
        `
        (async () => {
          const root = await getDirectory("/");
          const fileHandle = await root.getFileHandle("test.txt", { create: true });
          const writable = await fileHandle.createWritable();
          const writer = writable.getWriter();

          return JSON.stringify({
            hasWrite: typeof writer.write === "function",
            hasClose: typeof writer.close === "function",
            hasAbort: typeof writer.abort === "function",
            hasReleaseLock: typeof writer.releaseLock === "function",
            hasClosed: "closed" in writer,
            hasReady: "ready" in writer,
            hasDesiredSize: "desiredSize" in writer,
          });
        })()
        `,
        { promise: true }
      );

      const result = JSON.parse(resultJson);
      assert.strictEqual(result.hasWrite, true, "Writer should have write method");
      assert.strictEqual(result.hasClose, true, "Writer should have close method");
      assert.strictEqual(result.hasAbort, true, "Writer should have abort method");
      assert.strictEqual(result.hasReleaseLock, true, "Writer should have releaseLock method");
      assert.strictEqual(result.hasClosed, true, "Writer should have closed property");
      assert.strictEqual(result.hasReady, true, "Writer should have ready property");
      assert.strictEqual(result.hasDesiredSize, true, "Writer should have desiredSize property");
    } finally {
      handle.dispose();
      isolate.dispose();
    }
  });

  test("getWriter().write() writes data to file", async () => {
    const isolate = new ivm.Isolate();
    const context = await isolate.createContext();

    const fsHandler = createMemoryHandler();
    const handle = await setupFs(context, {
      getDirectory: async () => fsHandler,
    });

    try {
      const result = await context.eval(
        `
        (async () => {
          const root = await getDirectory("/");
          const fileHandle = await root.getFileHandle("test.txt", { create: true });
          const writable = await fileHandle.createWritable();
          const writer = writable.getWriter();

          await writer.write("Hello, World!");
          await writer.close();

          // Read back the file
          const file = await fileHandle.getFile();
          const text = await file.text();
          return text;
        })()
        `,
        { promise: true }
      );

      assert.strictEqual(result, "Hello, World!", "File should contain written data");
    } finally {
      handle.dispose();
      isolate.dispose();
    }
  });

  test("getWriter().close() resolves closed promise", async () => {
    const isolate = new ivm.Isolate();
    const context = await isolate.createContext();

    const fsHandler = createMemoryHandler();
    const handle = await setupFs(context, {
      getDirectory: async () => fsHandler,
    });

    try {
      const result = await context.eval(
        `
        (async () => {
          const root = await getDirectory("/");
          const fileHandle = await root.getFileHandle("test.txt", { create: true });
          const writable = await fileHandle.createWritable();
          const writer = writable.getWriter();

          let closedResolved = false;
          const closedPromise = writer.closed.then(() => {
            closedResolved = true;
          });

          await writer.close();
          await closedPromise;

          return closedResolved;
        })()
        `,
        { promise: true }
      );

      assert.strictEqual(result, true, "closed promise should resolve after close()");
    } finally {
      handle.dispose();
      isolate.dispose();
    }
  });

  test("getWriter().releaseLock() prevents further writes", async () => {
    const isolate = new ivm.Isolate();
    const context = await isolate.createContext();

    const fsHandler = createMemoryHandler();
    const handle = await setupFs(context, {
      getDirectory: async () => fsHandler,
    });

    try {
      const resultJson = await context.eval(
        `
        (async () => {
          const root = await getDirectory("/");
          const fileHandle = await root.getFileHandle("test.txt", { create: true });
          const writable = await fileHandle.createWritable();
          const writer = writable.getWriter();

          writer.releaseLock();

          try {
            await writer.write("test");
            return JSON.stringify({ threw: false });
          } catch (e) {
            return JSON.stringify({ threw: true, name: e.name });
          }
        })()
        `,
        { promise: true }
      );

      const result = JSON.parse(resultJson);
      assert.strictEqual(result.threw, true, "Should throw after releaseLock");
      assert.strictEqual(result.name, "TypeError", "Should throw TypeError");
    } finally {
      handle.dispose();
      isolate.dispose();
    }
  });

  test("getWriter().ready resolves immediately", async () => {
    const isolate = new ivm.Isolate();
    const context = await isolate.createContext();

    const fsHandler = createMemoryHandler();
    const handle = await setupFs(context, {
      getDirectory: async () => fsHandler,
    });

    try {
      const result = await context.eval(
        `
        (async () => {
          const root = await getDirectory("/");
          const fileHandle = await root.getFileHandle("test.txt", { create: true });
          const writable = await fileHandle.createWritable();
          const writer = writable.getWriter();

          await writer.ready;
          return true;
        })()
        `,
        { promise: true }
      );

      assert.strictEqual(result, true, "ready should resolve");
    } finally {
      handle.dispose();
      isolate.dispose();
    }
  });

  test("getWriter().desiredSize returns 1", async () => {
    const isolate = new ivm.Isolate();
    const context = await isolate.createContext();

    const fsHandler = createMemoryHandler();
    const handle = await setupFs(context, {
      getDirectory: async () => fsHandler,
    });

    try {
      const result = await context.eval(
        `
        (async () => {
          const root = await getDirectory("/");
          const fileHandle = await root.getFileHandle("test.txt", { create: true });
          const writable = await fileHandle.createWritable();
          const writer = writable.getWriter();

          return writer.desiredSize;
        })()
        `,
        { promise: true }
      );

      assert.strictEqual(result, 1, "desiredSize should be 1");
    } finally {
      handle.dispose();
      isolate.dispose();
    }
  });
});
