import { test, describe, beforeEach } from "node:test";
import assert from "node:assert";
import { createFsFromVolume, Volume } from "memfs";
import { createNodeFileSystemHandler } from "./node-adapter.ts";
import type { FileSystemHandler } from "./index.ts";

describe("createNodeFileSystemHandler", () => {
  let vol: InstanceType<typeof Volume>;
  let handler: FileSystemHandler;

  beforeEach(() => {
    vol = new Volume();
    const memfs = createFsFromVolume(vol);
    handler = createNodeFileSystemHandler("/", { fs: memfs as any });
  });

  describe("getFileHandle", () => {
    test("creates new file when create: true", async () => {
      await handler.getFileHandle("/newfile.txt", { create: true });
      assert.ok(vol.existsSync("/newfile.txt"));
    });

    test("opens existing file without create option", async () => {
      vol.writeFileSync("/existing.txt", "content");
      await handler.getFileHandle("/existing.txt");
      // Should not throw
    });

    test("throws NotFoundError for missing file without create", async () => {
      await assert.rejects(
        () => handler.getFileHandle("/nonexistent.txt"),
        (err: Error) => err.message.includes("[NotFoundError]")
      );
    });

    test("throws TypeMismatchError when path is a directory", async () => {
      vol.mkdirSync("/somedir");
      await assert.rejects(
        () => handler.getFileHandle("/somedir"),
        (err: Error) => err.message.includes("[TypeMismatchError]")
      );
    });
  });

  describe("getDirectoryHandle", () => {
    test("creates new directory when create: true", async () => {
      await handler.getDirectoryHandle("/newdir", { create: true });
      assert.ok(vol.existsSync("/newdir"));
      const stats = vol.statSync("/newdir");
      assert.ok(stats.isDirectory());
    });

    test("creates nested directories with create: true", async () => {
      await handler.getDirectoryHandle("/parent/child/grandchild", { create: true });
      assert.ok(vol.existsSync("/parent/child/grandchild"));
    });

    test("opens existing directory without create option", async () => {
      vol.mkdirSync("/existingdir");
      await handler.getDirectoryHandle("/existingdir");
      // Should not throw
    });

    test("throws NotFoundError for missing directory without create", async () => {
      await assert.rejects(
        () => handler.getDirectoryHandle("/nonexistent"),
        (err: Error) => err.message.includes("[NotFoundError]")
      );
    });

    test("throws TypeMismatchError when path is a file", async () => {
      vol.writeFileSync("/somefile", "content");
      await assert.rejects(
        () => handler.getDirectoryHandle("/somefile"),
        (err: Error) => err.message.includes("[TypeMismatchError]")
      );
    });
  });

  describe("removeEntry", () => {
    test("removes a file", async () => {
      vol.writeFileSync("/todelete.txt", "content");
      await handler.removeEntry("/todelete.txt");
      assert.ok(!vol.existsSync("/todelete.txt"));
    });

    test("removes an empty directory", async () => {
      vol.mkdirSync("/emptydir");
      await handler.removeEntry("/emptydir");
      assert.ok(!vol.existsSync("/emptydir"));
    });

    test("removes non-empty directory with recursive: true", async () => {
      vol.mkdirSync("/parent");
      vol.mkdirSync("/parent/child");
      vol.writeFileSync("/parent/file.txt", "content");
      vol.writeFileSync("/parent/child/nested.txt", "nested");

      await handler.removeEntry("/parent", { recursive: true });

      assert.ok(!vol.existsSync("/parent"));
      assert.ok(!vol.existsSync("/parent/child"));
      assert.ok(!vol.existsSync("/parent/file.txt"));
    });

    test("throws error for non-empty directory without recursive", async () => {
      vol.mkdirSync("/nonempty");
      vol.writeFileSync("/nonempty/file.txt", "content");

      await assert.rejects(
        () => handler.removeEntry("/nonempty"),
        (err: Error) => err.message.includes("[InvalidModificationError]")
      );
    });

    test("throws NotFoundError for non-existent path", async () => {
      await assert.rejects(
        () => handler.removeEntry("/nonexistent"),
        (err: Error) => err.message.includes("[NotFoundError]")
      );
    });
  });

  describe("readDirectory", () => {
    test("lists files and directories", async () => {
      vol.mkdirSync("/testdir");
      vol.writeFileSync("/testdir/file1.txt", "content1");
      vol.writeFileSync("/testdir/file2.txt", "content2");
      vol.mkdirSync("/testdir/subdir");

      const entries = await handler.readDirectory("/testdir");

      assert.strictEqual(entries.length, 3);

      const sorted = entries.sort((a, b) => a.name.localeCompare(b.name));
      assert.deepStrictEqual(sorted[0], { name: "file1.txt", kind: "file" });
      assert.deepStrictEqual(sorted[1], { name: "file2.txt", kind: "file" });
      assert.deepStrictEqual(sorted[2], { name: "subdir", kind: "directory" });
    });

    test("returns empty array for empty directory", async () => {
      vol.mkdirSync("/emptydir");
      const entries = await handler.readDirectory("/emptydir");
      assert.strictEqual(entries.length, 0);
    });

    test("throws NotFoundError for non-existent directory", async () => {
      await assert.rejects(
        () => handler.readDirectory("/nonexistent"),
        (err: Error) => err.message.includes("[NotFoundError]")
      );
    });
  });

  describe("readFile", () => {
    test("reads file content as Uint8Array", async () => {
      const content = "hello world";
      vol.writeFileSync("/test.txt", content);

      const result = await handler.readFile("/test.txt");

      assert.ok(result.data instanceof Uint8Array);
      assert.strictEqual(new TextDecoder().decode(result.data), content);
    });

    test("returns correct size", async () => {
      const content = "hello world";
      vol.writeFileSync("/test.txt", content);

      const result = await handler.readFile("/test.txt");

      assert.strictEqual(result.size, content.length);
    });

    test("returns lastModified timestamp", async () => {
      vol.writeFileSync("/test.txt", "content");

      const result = await handler.readFile("/test.txt");

      assert.ok(typeof result.lastModified === "number");
      assert.ok(result.lastModified > 0);
    });

    test("returns MIME type based on extension", async () => {
      vol.writeFileSync("/test.txt", "content");
      vol.writeFileSync("/test.json", "{}");
      vol.writeFileSync("/test.png", "binary");

      const txtResult = await handler.readFile("/test.txt");
      const jsonResult = await handler.readFile("/test.json");
      const pngResult = await handler.readFile("/test.png");

      assert.strictEqual(txtResult.type, "text/plain");
      assert.strictEqual(jsonResult.type, "application/json");
      assert.strictEqual(pngResult.type, "image/png");
    });

    test("throws NotFoundError for non-existent file", async () => {
      await assert.rejects(
        () => handler.readFile("/nonexistent.txt"),
        (err: Error) => err.message.includes("[NotFoundError]")
      );
    });

    test("throws TypeMismatchError for directory", async () => {
      vol.mkdirSync("/somedir");
      await assert.rejects(
        () => handler.readFile("/somedir"),
        (err: Error) => err.message.includes("[TypeMismatchError]")
      );
    });
  });

  describe("writeFile", () => {
    test("writes data to file (overwrite mode)", async () => {
      vol.writeFileSync("/test.txt", "old content");

      const newContent = new TextEncoder().encode("new content");
      await handler.writeFile("/test.txt", newContent);

      const result = vol.readFileSync("/test.txt", "utf-8");
      assert.strictEqual(result, "new content");
    });

    test("writes data at specific position", async () => {
      vol.writeFileSync("/test.txt", "hello world");

      const data = new TextEncoder().encode("XXXXX");
      await handler.writeFile("/test.txt", data, 6);

      const result = vol.readFileSync("/test.txt", "utf-8");
      assert.strictEqual(result, "hello XXXXX");
    });

    test("throws NotFoundError for non-existent file", async () => {
      const data = new TextEncoder().encode("content");
      await assert.rejects(
        () => handler.writeFile("/nonexistent.txt", data),
        (err: Error) => err.message.includes("[NotFoundError]")
      );
    });
  });

  describe("truncateFile", () => {
    test("truncates file to smaller size", async () => {
      vol.writeFileSync("/test.txt", "hello world");

      await handler.truncateFile("/test.txt", 5);

      const result = vol.readFileSync("/test.txt", "utf-8");
      assert.strictEqual(result, "hello");
    });

    test("extends file to larger size", async () => {
      vol.writeFileSync("/test.txt", "hi");

      await handler.truncateFile("/test.txt", 10);

      const stats = vol.statSync("/test.txt");
      assert.strictEqual(stats.size, 10);
    });

    test("throws NotFoundError for non-existent file", async () => {
      await assert.rejects(
        () => handler.truncateFile("/nonexistent.txt", 10),
        (err: Error) => err.message.includes("[NotFoundError]")
      );
    });
  });

  describe("getFileMetadata", () => {
    test("returns size", async () => {
      const content = "hello world";
      vol.writeFileSync("/test.txt", content);

      const result = await handler.getFileMetadata("/test.txt");

      assert.strictEqual(result.size, content.length);
    });

    test("returns lastModified timestamp", async () => {
      vol.writeFileSync("/test.txt", "content");

      const result = await handler.getFileMetadata("/test.txt");

      assert.ok(typeof result.lastModified === "number");
      assert.ok(result.lastModified > 0);
    });

    test("returns MIME type based on extension", async () => {
      vol.writeFileSync("/test.html", "<html></html>");

      const result = await handler.getFileMetadata("/test.html");

      assert.strictEqual(result.type, "text/html");
    });

    test("throws NotFoundError for non-existent file", async () => {
      await assert.rejects(
        () => handler.getFileMetadata("/nonexistent.txt"),
        (err: Error) => err.message.includes("[NotFoundError]")
      );
    });

    test("throws TypeMismatchError for directory", async () => {
      vol.mkdirSync("/somedir");
      await assert.rejects(
        () => handler.getFileMetadata("/somedir"),
        (err: Error) => err.message.includes("[TypeMismatchError]")
      );
    });
  });

  describe("path mapping", () => {
    test("maps root path correctly", async () => {
      const memfs = createFsFromVolume(vol);
      const rootHandler = createNodeFileSystemHandler("/sandbox", { fs: memfs as any });

      vol.mkdirSync("/sandbox", { recursive: true });
      vol.writeFileSync("/sandbox/test.txt", "content");

      const result = await rootHandler.readFile("/test.txt");
      assert.strictEqual(new TextDecoder().decode(result.data), "content");
    });

    test("handles nested paths correctly", async () => {
      const memfs = createFsFromVolume(vol);
      const rootHandler = createNodeFileSystemHandler("/sandbox", { fs: memfs as any });

      vol.mkdirSync("/sandbox/subdir", { recursive: true });
      vol.writeFileSync("/sandbox/subdir/file.txt", "nested content");

      const result = await rootHandler.readFile("/subdir/file.txt");
      assert.strictEqual(new TextDecoder().decode(result.data), "nested content");
    });
  });
});
