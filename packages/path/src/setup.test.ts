import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import ivm from "isolated-vm";
import { setupPath } from "./index.ts";

describe("@ricsam/isolate-path", () => {
  let isolate: ivm.Isolate;
  let context: ivm.Context;

  beforeEach(async () => {
    isolate = new ivm.Isolate();
    context = await isolate.createContext();
    await setupPath(context);
  });

  afterEach(() => {
    context.release();
    isolate.dispose();
  });

  describe("path.sep and path.delimiter", () => {
    test("sep is /", async () => {
      const result = context.evalSync(`path.sep`);
      assert.strictEqual(result, "/");
    });

    test("delimiter is :", async () => {
      const result = context.evalSync(`path.delimiter`);
      assert.strictEqual(result, ":");
    });
  });

  describe("path.join", () => {
    test("joins path segments", async () => {
      const result = context.evalSync(`path.join('/foo', 'bar', 'baz')`);
      assert.strictEqual(result, "/foo/bar/baz");
    });

    test("normalizes the result", async () => {
      const result = context.evalSync(`path.join('/foo', 'bar', '..', 'baz')`);
      assert.strictEqual(result, "/foo/baz");
    });

    test("handles empty segments", async () => {
      const result = context.evalSync(`path.join('foo', '', 'bar')`);
      assert.strictEqual(result, "foo/bar");
    });

    test("returns . for no arguments", async () => {
      const result = context.evalSync(`path.join()`);
      assert.strictEqual(result, ".");
    });

    test("handles multiple separators", async () => {
      const result = context.evalSync(`path.join('/foo/', '/bar/')`);
      assert.strictEqual(result, "/foo/bar/");
    });
  });

  describe("path.dirname", () => {
    test("returns directory name", async () => {
      const result = context.evalSync(`path.dirname('/foo/bar/baz.txt')`);
      assert.strictEqual(result, "/foo/bar");
    });

    test("returns / for root-level files", async () => {
      const result = context.evalSync(`path.dirname('/file.txt')`);
      assert.strictEqual(result, "/");
    });

    test("returns . for relative file with no directory", async () => {
      const result = context.evalSync(`path.dirname('file.txt')`);
      assert.strictEqual(result, ".");
    });

    test("handles trailing slashes", async () => {
      const result = context.evalSync(`path.dirname('/foo/bar/')`);
      assert.strictEqual(result, "/foo");
    });
  });

  describe("path.basename", () => {
    test("returns file name", async () => {
      const result = context.evalSync(`path.basename('/foo/bar/baz.txt')`);
      assert.strictEqual(result, "baz.txt");
    });

    test("removes extension when provided", async () => {
      const result = context.evalSync(`path.basename('/foo/bar/baz.txt', '.txt')`);
      assert.strictEqual(result, "baz");
    });

    test("does not remove extension if it doesn't match", async () => {
      const result = context.evalSync(`path.basename('/foo/bar/baz.txt', '.js')`);
      assert.strictEqual(result, "baz.txt");
    });

    test("handles trailing slashes", async () => {
      const result = context.evalSync(`path.basename('/foo/bar/')`);
      assert.strictEqual(result, "bar");
    });
  });

  describe("path.extname", () => {
    test("returns file extension", async () => {
      const result = context.evalSync(`path.extname('/foo/bar/baz.txt')`);
      assert.strictEqual(result, ".txt");
    });

    test("returns empty string for no extension", async () => {
      const result = context.evalSync(`path.extname('/foo/bar/baz')`);
      assert.strictEqual(result, "");
    });

    test("handles multiple dots", async () => {
      const result = context.evalSync(`path.extname('/foo/bar/baz.tar.gz')`);
      assert.strictEqual(result, ".gz");
    });

    test("handles dotfiles", async () => {
      const result = context.evalSync(`path.extname('/foo/.gitignore')`);
      assert.strictEqual(result, "");
    });

    test("handles dotfiles with extension", async () => {
      const result = context.evalSync(`path.extname('/foo/.eslintrc.json')`);
      assert.strictEqual(result, ".json");
    });
  });

  describe("path.normalize", () => {
    test("normalizes path separators", async () => {
      const result = context.evalSync(`path.normalize('/foo//bar///baz')`);
      assert.strictEqual(result, "/foo/bar/baz");
    });

    test("resolves . and ..", async () => {
      const result = context.evalSync(`path.normalize('/foo/bar/../baz/./qux')`);
      assert.strictEqual(result, "/foo/baz/qux");
    });

    test("preserves trailing slash", async () => {
      const result = context.evalSync(`path.normalize('/foo/bar/')`);
      assert.strictEqual(result, "/foo/bar/");
    });

    test("returns . for empty string", async () => {
      const result = context.evalSync(`path.normalize('')`);
      assert.strictEqual(result, ".");
    });

    test("handles relative paths with ..", async () => {
      const result = context.evalSync(`path.normalize('foo/../bar')`);
      assert.strictEqual(result, "bar");
    });

    test("keeps leading .. for relative paths", async () => {
      const result = context.evalSync(`path.normalize('../foo/bar')`);
      assert.strictEqual(result, "../foo/bar");
    });
  });

  describe("path.isAbsolute", () => {
    test("returns true for absolute paths", async () => {
      const result = context.evalSync(`path.isAbsolute('/foo/bar')`);
      assert.strictEqual(result, true);
    });

    test("returns false for relative paths", async () => {
      const result = context.evalSync(`path.isAbsolute('foo/bar')`);
      assert.strictEqual(result, false);
    });

    test("returns true for root", async () => {
      const result = context.evalSync(`path.isAbsolute('/')`);
      assert.strictEqual(result, true);
    });

    test("returns false for empty string", async () => {
      const result = context.evalSync(`path.isAbsolute('')`);
      assert.strictEqual(result, false);
    });
  });

  describe("path.resolve", () => {
    test("resolves absolute path", async () => {
      const result = context.evalSync(`path.resolve('/foo', 'bar')`);
      assert.strictEqual(result, "/foo/bar");
    });

    test("later absolute path takes precedence", async () => {
      const result = context.evalSync(`path.resolve('/foo', '/bar', 'baz')`);
      assert.strictEqual(result, "/bar/baz");
    });

    test("resolves relative path from root", async () => {
      const result = context.evalSync(`path.resolve('foo', 'bar')`);
      assert.strictEqual(result, "/foo/bar");
    });

    test("normalizes the result", async () => {
      const result = context.evalSync(`path.resolve('/foo', 'bar', '..', 'baz')`);
      assert.strictEqual(result, "/foo/baz");
    });
  });

  describe("path.relative", () => {
    test("returns relative path between two absolute paths", async () => {
      const result = context.evalSync(`path.relative('/foo/bar', '/foo/baz')`);
      assert.strictEqual(result, "../baz");
    });

    test("returns empty string for same path", async () => {
      const result = context.evalSync(`path.relative('/foo/bar', '/foo/bar')`);
      assert.strictEqual(result, "");
    });

    test("handles deeply nested paths", async () => {
      const result = context.evalSync(`path.relative('/foo/bar/baz', '/foo/qux/quux')`);
      assert.strictEqual(result, "../../qux/quux");
    });

    test("handles path going to parent", async () => {
      const result = context.evalSync(`path.relative('/foo/bar/baz', '/foo')`);
      assert.strictEqual(result, "../..");
    });
  });

  describe("path.parse", () => {
    test("parses absolute path", async () => {
      const result = context.evalSync(`JSON.stringify(path.parse('/foo/bar/baz.txt'))`);
      const parsed = JSON.parse(result as string);
      assert.deepStrictEqual(parsed, {
        root: "/",
        dir: "/foo/bar",
        base: "baz.txt",
        ext: ".txt",
        name: "baz",
      });
    });

    test("parses relative path", async () => {
      const result = context.evalSync(`JSON.stringify(path.parse('foo/bar.txt'))`);
      const parsed = JSON.parse(result as string);
      assert.deepStrictEqual(parsed, {
        root: "",
        dir: "foo",
        base: "bar.txt",
        ext: ".txt",
        name: "bar",
      });
    });

    test("parses path without extension", async () => {
      const result = context.evalSync(`JSON.stringify(path.parse('/foo/bar'))`);
      const parsed = JSON.parse(result as string);
      assert.deepStrictEqual(parsed, {
        root: "/",
        dir: "/foo",
        base: "bar",
        ext: "",
        name: "bar",
      });
    });

    test("parses root-level file", async () => {
      const result = context.evalSync(`JSON.stringify(path.parse('/file.txt'))`);
      const parsed = JSON.parse(result as string);
      assert.deepStrictEqual(parsed, {
        root: "/",
        dir: "/",
        base: "file.txt",
        ext: ".txt",
        name: "file",
      });
    });
  });

  describe("path.format", () => {
    test("formats path object", async () => {
      const result = context.evalSync(`
        path.format({
          root: '/',
          dir: '/foo/bar',
          base: 'baz.txt'
        })
      `);
      assert.strictEqual(result, "/foo/bar/baz.txt");
    });

    test("uses name and ext if base is not provided", async () => {
      const result = context.evalSync(`
        path.format({
          root: '/',
          dir: '/foo',
          name: 'bar',
          ext: '.txt'
        })
      `);
      assert.strictEqual(result, "/foo/bar.txt");
    });

    test("base takes precedence over name and ext", async () => {
      const result = context.evalSync(`
        path.format({
          dir: '/foo',
          base: 'baz.js',
          name: 'bar',
          ext: '.txt'
        })
      `);
      assert.strictEqual(result, "/foo/baz.js");
    });

    test("uses root if dir is not provided", async () => {
      const result = context.evalSync(`
        path.format({
          root: '/',
          base: 'file.txt'
        })
      `);
      assert.strictEqual(result, "/file.txt");
    });
  });

  describe("path.posix", () => {
    test("posix is available and equals path", async () => {
      const result = context.evalSync(`path.posix === path`);
      assert.strictEqual(result, true);
    });
  });

  describe("error handling", () => {
    test("throws TypeError for non-string path in join", async () => {
      await assert.rejects(
        async () => context.evalSync(`path.join('/foo', 123)`),
        /TypeError/
      );
    });

    test("throws TypeError for non-string path in dirname", async () => {
      await assert.rejects(
        async () => context.evalSync(`path.dirname(123)`),
        /TypeError/
      );
    });

    test("throws TypeError for non-string path in basename", async () => {
      await assert.rejects(
        async () => context.evalSync(`path.basename(123)`),
        /TypeError/
      );
    });

    test("throws TypeError for non-object in format", async () => {
      await assert.rejects(
        async () => context.evalSync(`path.format('string')`),
        /TypeError/
      );
    });
  });
});
