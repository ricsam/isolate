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
  });

  afterEach(() => {
    context.release();
    isolate.dispose();
  });

  describe("path.join", () => {
    test("joins path segments", async () => {
      // TODO: Implement test
    });

    test("normalizes the result", async () => {
      // TODO: Implement test
    });
  });

  describe("path.dirname", () => {
    test("returns directory name", async () => {
      // TODO: Implement test
    });
  });

  describe("path.basename", () => {
    test("returns file name", async () => {
      // TODO: Implement test
    });

    test("removes extension when provided", async () => {
      // TODO: Implement test
    });
  });

  describe("path.extname", () => {
    test("returns file extension", async () => {
      // TODO: Implement test
    });
  });

  describe("path.normalize", () => {
    test("normalizes path separators", async () => {
      // TODO: Implement test
    });

    test("resolves . and ..", async () => {
      // TODO: Implement test
    });
  });

  describe("path.isAbsolute", () => {
    test("returns true for absolute paths", async () => {
      // TODO: Implement test
    });

    test("returns false for relative paths", async () => {
      // TODO: Implement test
    });
  });
});
