import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import ivm from "isolated-vm";
import { setupFs } from "./index.ts";

describe("@ricsam/isolate-fs", () => {
  let isolate: ivm.Isolate;
  let context: ivm.Context;

  beforeEach(async () => {
    isolate = new ivm.Isolate();
    context = await isolate.createContext();
  });

  afterEach(() => {
    context.release();
    isolate.dispose();
  });

  describe("FileSystemDirectoryHandle", () => {
    test("getFileHandle creates new file", async () => {
      // TODO: Implement test
    });

    test("getFileHandle opens existing file", async () => {
      // TODO: Implement test
    });

    test("getDirectoryHandle creates new directory", async () => {
      // TODO: Implement test
    });

    test("removeEntry removes file", async () => {
      // TODO: Implement test
    });

    test("removeEntry removes directory recursively", async () => {
      // TODO: Implement test
    });

    test("entries() iterates directory contents", async () => {
      // TODO: Implement test
    });

    test("keys() returns file/directory names", async () => {
      // TODO: Implement test
    });

    test("values() returns handles", async () => {
      // TODO: Implement test
    });
  });

  describe("FileSystemFileHandle", () => {
    test("getFile returns File object", async () => {
      // TODO: Implement test
    });

    test("createWritable returns WritableStream", async () => {
      // TODO: Implement test
    });
  });

  describe("FileSystemWritableFileStream", () => {
    test("write string data", async () => {
      // TODO: Implement test
    });

    test("write ArrayBuffer data", async () => {
      // TODO: Implement test
    });

    test("write at specific position", async () => {
      // TODO: Implement test
    });

    test("seek changes position", async () => {
      // TODO: Implement test
    });

    test("truncate changes file size", async () => {
      // TODO: Implement test
    });

    test("close finalizes write", async () => {
      // TODO: Implement test
    });
  });

  describe("streaming", () => {
    test("stream() returns ReadableStream", async () => {
      // TODO: Implement test
    });

    test("can read file in chunks", async () => {
      // TODO: Implement test
    });
  });
});
