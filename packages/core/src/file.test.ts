import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import ivm from "isolated-vm";
import { setupCore, clearAllInstanceState } from "./index.ts";

describe("File", () => {
  let isolate: ivm.Isolate;
  let context: ivm.Context;

  beforeEach(async () => {
    isolate = new ivm.Isolate();
    context = await isolate.createContext();
    await setupCore(context);
    clearAllInstanceState();
  });

  afterEach(() => {
    context.release();
    isolate.dispose();
  });

  describe("constructor", () => {
    test("creates file with name", async () => {
      // TODO: Implement test
    });

    test("creates file with content", async () => {
      // TODO: Implement test
    });

    test("creates file with type option", async () => {
      // TODO: Implement test
    });

    test("creates file with custom lastModified", async () => {
      // TODO: Implement test
    });

    test("creates file with multiple parts", async () => {
      // TODO: Implement test
    });
  });

  describe("name property", () => {
    test("returns the file name", async () => {
      // TODO: Implement test
    });

    test("handles special characters in name", async () => {
      // TODO: Implement test
    });
  });

  describe("size property", () => {
    test("returns 0 for empty file", async () => {
      // TODO: Implement test
    });

    test("returns correct size for content", async () => {
      // TODO: Implement test
    });
  });

  describe("type property", () => {
    test("returns empty string by default", async () => {
      // TODO: Implement test
    });

    test("returns specified type", async () => {
      // TODO: Implement test
    });
  });

  describe("lastModified property", () => {
    test("returns current time by default", async () => {
      // TODO: Implement test
    });

    test("returns custom lastModified when specified", async () => {
      // TODO: Implement test
    });
  });

  describe("webkitRelativePath property", () => {
    test("returns empty string", async () => {
      // TODO: Implement test
    });
  });

  describe("text() method", () => {
    test("returns content as string", async () => {
      // TODO: Implement test
    });
  });

  describe("arrayBuffer() method", () => {
    test("returns content as ArrayBuffer", async () => {
      // TODO: Implement test
    });
  });

  describe("slice() method", () => {
    test("slices file content", async () => {
      // TODO: Implement test
    });
  });

  describe("multiple files", () => {
    test("files are independent", async () => {
      // TODO: Implement test
    });
  });
});
