import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import ivm from "isolated-vm";
import { setupFs, clearAllInstanceState, type FileSystemHandler } from "./index.ts";

// ============================================================================
// MockFileSystem - In-memory file system for testing
// ============================================================================

class MockFileSystem implements FileSystemHandler {
  files = new Map<string, { data: Uint8Array; lastModified: number; type: string }>();
  directories = new Set<string>(["/"]); // Root always exists

  async getFileHandle(path: string, options?: { create?: boolean }): Promise<void> {
    const exists = this.files.has(path);
    if (!exists && !options?.create) {
      throw new Error("[NotFoundError]File not found: " + path);
    }
    if (this.directories.has(path)) {
      throw new Error("[TypeMismatchError]Path is a directory: " + path);
    }
    if (!exists && options?.create) {
      this.files.set(path, { data: new Uint8Array(0), lastModified: Date.now(), type: "" });
    }
  }

  async getDirectoryHandle(path: string, options?: { create?: boolean }): Promise<void> {
    const exists = this.directories.has(path);
    if (!exists && !options?.create) {
      throw new Error("[NotFoundError]Directory not found: " + path);
    }
    if (this.files.has(path)) {
      throw new Error("[TypeMismatchError]Path is a file: " + path);
    }
    if (!exists && options?.create) {
      this.directories.add(path);
    }
  }

  async removeEntry(path: string, options?: { recursive?: boolean }): Promise<void> {
    if (this.files.has(path)) {
      this.files.delete(path);
      return;
    }

    if (this.directories.has(path)) {
      // Check for children
      const prefix = path === "/" ? "/" : path + "/";
      const hasChildren =
        [...this.files.keys()].some((p) => p.startsWith(prefix)) ||
        [...this.directories].some((p) => p !== path && p.startsWith(prefix));

      if (hasChildren && !options?.recursive) {
        throw new Error("[InvalidModificationError]Directory not empty: " + path);
      }

      // Remove directory and all descendants
      for (const p of this.files.keys()) {
        if (p.startsWith(prefix)) {
          this.files.delete(p);
        }
      }
      for (const p of this.directories) {
        if (p.startsWith(prefix) || p === path) {
          this.directories.delete(p);
        }
      }
      return;
    }

    throw new Error("[NotFoundError]Entry not found: " + path);
  }

  async readDirectory(path: string): Promise<Array<{ name: string; kind: "file" | "directory" }>> {
    if (!this.directories.has(path)) {
      throw new Error("[NotFoundError]Directory not found: " + path);
    }

    const prefix = path === "/" ? "/" : path + "/";
    const entries: Array<{ name: string; kind: "file" | "directory" }> = [];
    const seen = new Set<string>();

    // Find files directly in this directory
    for (const p of this.files.keys()) {
      if (p.startsWith(prefix)) {
        const rest = p.slice(prefix.length);
        const name = rest.split("/")[0];
        if (name && !rest.includes("/") && !seen.has(name)) {
          seen.add(name);
          entries.push({ name, kind: "file" });
        }
      }
    }

    // Find subdirectories
    for (const p of this.directories) {
      if (p !== path && p.startsWith(prefix)) {
        const rest = p.slice(prefix.length);
        const name = rest.split("/")[0];
        if (name && !rest.includes("/") && !seen.has(name)) {
          seen.add(name);
          entries.push({ name, kind: "directory" });
        }
      }
    }

    return entries;
  }

  async readFile(
    path: string
  ): Promise<{ data: Uint8Array; size: number; lastModified: number; type: string }> {
    const file = this.files.get(path);
    if (!file) {
      throw new Error("[NotFoundError]File not found: " + path);
    }
    return {
      data: file.data,
      size: file.data.length,
      lastModified: file.lastModified,
      type: file.type,
    };
  }

  async writeFile(path: string, data: Uint8Array, position?: number): Promise<void> {
    const existing = this.files.get(path);
    if (!existing) {
      throw new Error("[NotFoundError]File not found: " + path);
    }

    if (position !== undefined && position > 0) {
      // Write at position
      const newSize = Math.max(existing.data.length, position + data.length);
      const newData = new Uint8Array(newSize);
      newData.set(existing.data);
      newData.set(data, position);
      existing.data = newData;
    } else if (position === 0) {
      // Overwrite from beginning
      const newSize = Math.max(existing.data.length, data.length);
      const newData = new Uint8Array(newSize);
      newData.set(existing.data);
      newData.set(data, 0);
      existing.data = newData;
    } else {
      // Append (no position specified means append to current content)
      // For simplicity, we treat undefined position as overwrite
      existing.data = data;
    }
    existing.lastModified = Date.now();
  }

  async truncateFile(path: string, size: number): Promise<void> {
    const file = this.files.get(path);
    if (!file) {
      throw new Error("[NotFoundError]File not found: " + path);
    }
    if (size < file.data.length) {
      file.data = file.data.slice(0, size);
    } else if (size > file.data.length) {
      const newData = new Uint8Array(size);
      newData.set(file.data);
      file.data = newData;
    }
    file.lastModified = Date.now();
  }

  async getFileMetadata(
    path: string
  ): Promise<{ size: number; lastModified: number; type: string }> {
    const file = this.files.get(path);
    if (!file) {
      throw new Error("[NotFoundError]File not found: " + path);
    }
    return {
      size: file.data.length,
      lastModified: file.lastModified,
      type: file.type,
    };
  }
}

// ============================================================================
// Tests
// ============================================================================

describe("@ricsam/isolate-fs", () => {
  let isolate: ivm.Isolate;
  let context: ivm.Context;
  let mockFs: MockFileSystem;

  beforeEach(async () => {
    isolate = new ivm.Isolate();
    context = await isolate.createContext();
    mockFs = new MockFileSystem();
    clearAllInstanceState();
  });

  afterEach(() => {
    context.release();
    isolate.dispose();
  });

  describe("FileSystemDirectoryHandle", () => {
    test("getFileHandle creates new file", async () => {
      await setupFs(context, { handler: mockFs });

      const result = await context.eval(
        `
        (async () => {
          const root = navigator.storage.getDirectory();
          const fileHandle = root.getFileHandle("test.txt", { create: true });
          return JSON.stringify({ kind: fileHandle.kind, name: fileHandle.name });
        })();
      `,
        { promise: true }
      );

      const data = JSON.parse(result as string);
      assert.strictEqual(data.kind, "file");
      assert.strictEqual(data.name, "test.txt");
      assert.ok(mockFs.files.has("/test.txt"));
    });

    test("getFileHandle opens existing file", async () => {
      // Pre-create file
      mockFs.files.set("/existing.txt", {
        data: new TextEncoder().encode("hello"),
        lastModified: Date.now(),
        type: "text/plain",
      });

      await setupFs(context, { handler: mockFs });

      const result = await context.eval(
        `
        (async () => {
          const root = navigator.storage.getDirectory();
          const fileHandle = root.getFileHandle("existing.txt");
          const file = fileHandle.getFile();
          const text = file.text();
          return text;
        })();
      `,
        { promise: true }
      );

      assert.strictEqual(result, "hello");
    });

    test("getDirectoryHandle creates new directory", async () => {
      await setupFs(context, { handler: mockFs });

      const result = await context.eval(
        `
        (async () => {
          const root = navigator.storage.getDirectory();
          const dirHandle = root.getDirectoryHandle("subdir", { create: true });
          return JSON.stringify({ kind: dirHandle.kind, name: dirHandle.name });
        })();
      `,
        { promise: true }
      );

      const data = JSON.parse(result as string);
      assert.strictEqual(data.kind, "directory");
      assert.strictEqual(data.name, "subdir");
      assert.ok(mockFs.directories.has("/subdir"));
    });

    test("removeEntry removes file", async () => {
      mockFs.files.set("/to-delete.txt", {
        data: new Uint8Array(),
        lastModified: Date.now(),
        type: "",
      });

      await setupFs(context, { handler: mockFs });

      await context.eval(
        `
        (async () => {
          const root = navigator.storage.getDirectory();
          root.removeEntry("to-delete.txt");
        })();
      `,
        { promise: true }
      );

      assert.ok(!mockFs.files.has("/to-delete.txt"));
    });

    test("removeEntry removes directory recursively", async () => {
      mockFs.directories.add("/parent");
      mockFs.directories.add("/parent/child");
      mockFs.files.set("/parent/file.txt", {
        data: new Uint8Array(),
        lastModified: Date.now(),
        type: "",
      });

      await setupFs(context, { handler: mockFs });

      await context.eval(
        `
        (async () => {
          const root = navigator.storage.getDirectory();
          root.removeEntry("parent", { recursive: true });
        })();
      `,
        { promise: true }
      );

      assert.ok(!mockFs.directories.has("/parent"));
      assert.ok(!mockFs.directories.has("/parent/child"));
      assert.ok(!mockFs.files.has("/parent/file.txt"));
    });

    test("entries() iterates directory contents", async () => {
      mockFs.files.set("/file1.txt", {
        data: new Uint8Array(),
        lastModified: Date.now(),
        type: "",
      });
      mockFs.files.set("/file2.txt", {
        data: new Uint8Array(),
        lastModified: Date.now(),
        type: "",
      });
      mockFs.directories.add("/subdir");

      await setupFs(context, { handler: mockFs });

      const result = await context.eval(
        `
        (async () => {
          const root = navigator.storage.getDirectory();
          const entries = [];
          for await (const [name, handle] of root.entries()) {
            entries.push({ name, kind: handle.kind });
          }
          return JSON.stringify(entries.sort((a, b) => a.name.localeCompare(b.name)));
        })();
      `,
        { promise: true }
      );

      const entries = JSON.parse(result as string);
      assert.strictEqual(entries.length, 3);
      assert.deepStrictEqual(entries[0], { name: "file1.txt", kind: "file" });
      assert.deepStrictEqual(entries[1], { name: "file2.txt", kind: "file" });
      assert.deepStrictEqual(entries[2], { name: "subdir", kind: "directory" });
    });

    test("keys() returns file/directory names", async () => {
      mockFs.files.set("/a.txt", { data: new Uint8Array(), lastModified: Date.now(), type: "" });
      mockFs.files.set("/b.txt", { data: new Uint8Array(), lastModified: Date.now(), type: "" });

      await setupFs(context, { handler: mockFs });

      const result = await context.eval(
        `
        (async () => {
          const root = navigator.storage.getDirectory();
          const keys = [];
          for await (const name of root.keys()) {
            keys.push(name);
          }
          return JSON.stringify(keys.sort());
        })();
      `,
        { promise: true }
      );

      const keys = JSON.parse(result as string);
      assert.deepStrictEqual(keys, ["a.txt", "b.txt"]);
    });

    test("values() returns handles", async () => {
      mockFs.files.set("/test.txt", { data: new Uint8Array(), lastModified: Date.now(), type: "" });

      await setupFs(context, { handler: mockFs });

      const result = await context.eval(
        `
        (async () => {
          const root = navigator.storage.getDirectory();
          const handles = [];
          for await (const handle of root.values()) {
            handles.push({ name: handle.name, kind: handle.kind });
          }
          return JSON.stringify(handles);
        })();
      `,
        { promise: true }
      );

      const handles = JSON.parse(result as string);
      assert.strictEqual(handles.length, 1);
      assert.deepStrictEqual(handles[0], { name: "test.txt", kind: "file" });
    });
  });

  describe("FileSystemFileHandle", () => {
    test("getFile returns File object", async () => {
      const content = "file content here";
      mockFs.files.set("/myfile.txt", {
        data: new TextEncoder().encode(content),
        lastModified: 1234567890,
        type: "text/plain",
      });

      await setupFs(context, { handler: mockFs });

      const result = await context.eval(
        `
        (async () => {
          const root = navigator.storage.getDirectory();
          const fileHandle = root.getFileHandle("myfile.txt");
          const file = fileHandle.getFile();
          const text = await file.text();
          return JSON.stringify({
            name: file.name,
            size: file.size,
            type: file.type,
            lastModified: file.lastModified,
            text: text
          });
        })();
      `,
        { promise: true }
      );

      const data = JSON.parse(result as string);
      assert.strictEqual(data.name, "myfile.txt");
      assert.strictEqual(data.size, content.length);
      assert.strictEqual(data.type, "text/plain");
      assert.strictEqual(data.lastModified, 1234567890);
      assert.strictEqual(data.text, content);
    });

    test("createWritable returns WritableStream", async () => {
      mockFs.files.set("/writable.txt", {
        data: new Uint8Array(),
        lastModified: Date.now(),
        type: "",
      });

      await setupFs(context, { handler: mockFs });

      const result = await context.eval(
        `
        (async () => {
          const root = navigator.storage.getDirectory();
          const fileHandle = root.getFileHandle("writable.txt");
          const writable = fileHandle.createWritable();
          return typeof writable.write === 'function' && typeof writable.close === 'function';
        })();
      `,
        { promise: true }
      );

      assert.strictEqual(result, true);
    });
  });

  describe("FileSystemWritableFileStream", () => {
    test("write string data", async () => {
      mockFs.files.set("/test.txt", {
        data: new Uint8Array(),
        lastModified: Date.now(),
        type: "",
      });

      await setupFs(context, { handler: mockFs });

      await context.eval(
        `
        (async () => {
          const root = navigator.storage.getDirectory();
          const fileHandle = root.getFileHandle("test.txt");
          const writable = fileHandle.createWritable();
          writable.write("hello world");
          writable.close();
        })();
      `,
        { promise: true }
      );

      const file = mockFs.files.get("/test.txt");
      const text = new TextDecoder().decode(file!.data);
      assert.strictEqual(text, "hello world");
    });

    test("write ArrayBuffer data", async () => {
      mockFs.files.set("/binary.dat", {
        data: new Uint8Array(),
        lastModified: Date.now(),
        type: "",
      });

      await setupFs(context, { handler: mockFs });

      await context.eval(
        `
        (async () => {
          const root = navigator.storage.getDirectory();
          const fileHandle = root.getFileHandle("binary.dat");
          const writable = fileHandle.createWritable();
          const buffer = new Uint8Array([1, 2, 3, 4, 5]);
          writable.write(buffer);
          writable.close();
        })();
      `,
        { promise: true }
      );

      const file = mockFs.files.get("/binary.dat");
      assert.deepStrictEqual(Array.from(file!.data), [1, 2, 3, 4, 5]);
    });

    test("write at specific position", async () => {
      const initialData = new TextEncoder().encode("hello world");
      mockFs.files.set("/test.txt", {
        data: initialData,
        lastModified: Date.now(),
        type: "",
      });

      await setupFs(context, { handler: mockFs });

      await context.eval(
        `
        (async () => {
          const root = navigator.storage.getDirectory();
          const fileHandle = root.getFileHandle("test.txt");
          const writable = fileHandle.createWritable();
          writable.write({ type: 'write', data: 'XXXXX', position: 6 });
          writable.close();
        })();
      `,
        { promise: true }
      );

      const file = mockFs.files.get("/test.txt");
      const text = new TextDecoder().decode(file!.data);
      assert.strictEqual(text, "hello XXXXX");
    });

    test("seek changes position", async () => {
      mockFs.files.set("/test.txt", {
        data: new Uint8Array(20),
        lastModified: Date.now(),
        type: "",
      });

      await setupFs(context, { handler: mockFs });

      await context.eval(
        `
        (async () => {
          const root = navigator.storage.getDirectory();
          const fileHandle = root.getFileHandle("test.txt");
          const writable = fileHandle.createWritable();
          writable.write("start");
          writable.seek(10);
          writable.write("middle");
          writable.close();
        })();
      `,
        { promise: true }
      );

      const file = mockFs.files.get("/test.txt");
      const text = new TextDecoder().decode(file!.data);
      // "start" written at 0, then seek to 10, then "middle" written at 10
      assert.ok(text.startsWith("start"));
      assert.ok(text.slice(10).startsWith("middle"));
    });

    test("truncate changes file size", async () => {
      mockFs.files.set("/test.txt", {
        data: new TextEncoder().encode("hello world!"),
        lastModified: Date.now(),
        type: "",
      });

      await setupFs(context, { handler: mockFs });

      await context.eval(
        `
        (async () => {
          const root = navigator.storage.getDirectory();
          const fileHandle = root.getFileHandle("test.txt");
          const writable = fileHandle.createWritable();
          writable.truncate(5);
          writable.close();
        })();
      `,
        { promise: true }
      );

      const file = mockFs.files.get("/test.txt");
      assert.strictEqual(file!.data.length, 5);
      assert.strictEqual(new TextDecoder().decode(file!.data), "hello");
    });

    test("close finalizes write", async () => {
      mockFs.files.set("/test.txt", {
        data: new Uint8Array(),
        lastModified: Date.now(),
        type: "",
      });

      await setupFs(context, { handler: mockFs });

      // Test that writing after close throws
      const result = await context.eval(
        `
        (async () => {
          const root = navigator.storage.getDirectory();
          const fileHandle = root.getFileHandle("test.txt");
          const writable = fileHandle.createWritable();
          writable.write("initial");
          writable.close();

          try {
            writable.write("should fail");
            return "no error";
          } catch (e) {
            return e.name;
          }
        })();
      `,
        { promise: true }
      );

      assert.strictEqual(result, "InvalidStateError");
    });
  });

  describe("streaming", () => {
    test("stream() returns ReadableStream", async () => {
      const content = "streaming content test";
      mockFs.files.set("/stream.txt", {
        data: new TextEncoder().encode(content),
        lastModified: Date.now(),
        type: "text/plain",
      });

      await setupFs(context, { handler: mockFs });

      const result = await context.eval(
        `
        (async () => {
          const root = navigator.storage.getDirectory();
          const fileHandle = root.getFileHandle("stream.txt");
          const file = fileHandle.getFile();
          const stream = file.stream();
          return stream instanceof ReadableStream;
        })();
      `,
        { promise: true }
      );

      assert.strictEqual(result, true);
    });

    test("can read file in chunks", async () => {
      const content = "chunk1chunk2chunk3";
      mockFs.files.set("/chunks.txt", {
        data: new TextEncoder().encode(content),
        lastModified: Date.now(),
        type: "text/plain",
      });

      await setupFs(context, { handler: mockFs });

      const result = await context.eval(
        `
        (async () => {
          const root = navigator.storage.getDirectory();
          const fileHandle = root.getFileHandle("chunks.txt");
          const file = fileHandle.getFile();
          const stream = file.stream();
          const reader = stream.getReader();

          let fullContent = '';
          const decoder = new TextDecoder();

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            fullContent += decoder.decode(value, { stream: true });
          }

          return fullContent;
        })();
      `,
        { promise: true }
      );

      assert.strictEqual(result, content);
    });
  });

  describe("error handling", () => {
    test("getFileHandle throws NotFoundError for missing file", async () => {
      await setupFs(context, { handler: mockFs });

      const result = await context.eval(
        `
        (async () => {
          try {
            const root = navigator.storage.getDirectory();
            root.getFileHandle("nonexistent.txt");
            return "no error";
          } catch (e) {
            return e.name;
          }
        })();
      `,
        { promise: true }
      );

      assert.strictEqual(result, "NotFoundError");
    });

    test("getDirectoryHandle throws NotFoundError for missing directory", async () => {
      await setupFs(context, { handler: mockFs });

      const result = await context.eval(
        `
        (async () => {
          try {
            const root = navigator.storage.getDirectory();
            root.getDirectoryHandle("nonexistent");
            return "no error";
          } catch (e) {
            return e.name;
          }
        })();
      `,
        { promise: true }
      );

      assert.strictEqual(result, "NotFoundError");
    });

    test("removeEntry throws InvalidModificationError for non-empty directory", async () => {
      mockFs.directories.add("/nonempty");
      mockFs.files.set("/nonempty/file.txt", {
        data: new Uint8Array(),
        lastModified: Date.now(),
        type: "",
      });

      await setupFs(context, { handler: mockFs });

      const result = await context.eval(
        `
        (async () => {
          try {
            const root = navigator.storage.getDirectory();
            root.removeEntry("nonempty");
            return "no error";
          } catch (e) {
            return e.name;
          }
        })();
      `,
        { promise: true }
      );

      assert.strictEqual(result, "InvalidModificationError");
    });
  });

  describe("isSameEntry", () => {
    test("returns true for same file", async () => {
      mockFs.files.set("/same.txt", { data: new Uint8Array(), lastModified: Date.now(), type: "" });

      await setupFs(context, { handler: mockFs });

      const result = await context.eval(
        `
        (async () => {
          const root = navigator.storage.getDirectory();
          const handle1 = root.getFileHandle("same.txt");
          const handle2 = root.getFileHandle("same.txt");
          return handle1.isSameEntry(handle2);
        })();
      `,
        { promise: true }
      );

      assert.strictEqual(result, true);
    });

    test("returns false for different files", async () => {
      mockFs.files.set("/file1.txt", { data: new Uint8Array(), lastModified: Date.now(), type: "" });
      mockFs.files.set("/file2.txt", { data: new Uint8Array(), lastModified: Date.now(), type: "" });

      await setupFs(context, { handler: mockFs });

      const result = await context.eval(
        `
        (async () => {
          const root = navigator.storage.getDirectory();
          const handle1 = root.getFileHandle("file1.txt");
          const handle2 = root.getFileHandle("file2.txt");
          return handle1.isSameEntry(handle2);
        })();
      `,
        { promise: true }
      );

      assert.strictEqual(result, false);
    });
  });

  describe("resolve", () => {
    test("returns path components for descendant", async () => {
      mockFs.directories.add("/parent");
      mockFs.directories.add("/parent/child");
      mockFs.files.set("/parent/child/file.txt", {
        data: new Uint8Array(),
        lastModified: Date.now(),
        type: "",
      });

      await setupFs(context, { handler: mockFs });

      const result = await context.eval(
        `
        (async () => {
          const root = navigator.storage.getDirectory();
          const parent = root.getDirectoryHandle("parent");
          const child = parent.getDirectoryHandle("child");
          const file = child.getFileHandle("file.txt");

          const pathFromRoot = root.resolve(file);
          return JSON.stringify(pathFromRoot);
        })();
      `,
        { promise: true }
      );

      const path = JSON.parse(result as string);
      assert.deepStrictEqual(path, ["parent", "child", "file.txt"]);
    });

    test("returns null for non-descendant", async () => {
      mockFs.directories.add("/dir1");
      mockFs.directories.add("/dir2");
      mockFs.files.set("/dir2/file.txt", {
        data: new Uint8Array(),
        lastModified: Date.now(),
        type: "",
      });

      await setupFs(context, { handler: mockFs });

      const result = await context.eval(
        `
        (async () => {
          const root = navigator.storage.getDirectory();
          const dir1 = root.getDirectoryHandle("dir1");
          const dir2 = root.getDirectoryHandle("dir2");
          const file = dir2.getFileHandle("file.txt");

          const path = dir1.resolve(file);
          return path;
        })();
      `,
        { promise: true }
      );

      assert.strictEqual(result, null);
    });
  });
});
