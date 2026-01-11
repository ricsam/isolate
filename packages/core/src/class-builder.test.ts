import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import ivm from "isolated-vm";
import { defineClass, clearAllInstanceState } from "./index.ts";

describe("class-builder", () => {
  let isolate: ivm.Isolate;
  let context: ivm.Context;

  beforeEach(async () => {
    isolate = new ivm.Isolate();
    context = await isolate.createContext();
    clearAllInstanceState();
  });

  afterEach(() => {
    context.release();
    isolate.dispose();
  });

  describe("defineClass", () => {
    describe("basic class creation", () => {
      test("creates a class that can be instantiated", async () => {
        // TODO: Implement test
      });

      test("passes constructor arguments", async () => {
        // TODO: Implement test
      });
    });

    describe("methods", () => {
      test("defines instance methods", async () => {
        // TODO: Implement test
      });

      test("methods receive arguments", async () => {
        // TODO: Implement test
      });
    });

    describe("properties", () => {
      test("defines getter properties", async () => {
        // TODO: Implement test
      });

      test("defines setter properties", async () => {
        // TODO: Implement test
      });
    });

    describe("static methods", () => {
      test("defines static methods", async () => {
        // TODO: Implement test
      });
    });

    describe("static properties", () => {
      test("defines static properties", async () => {
        // TODO: Implement test
      });
    });

    describe("async methods", () => {
      test("methods can return promises", async () => {
        // TODO: Implement test
      });
    });
  });

  describe("multiple instances", () => {
    test("each instance has independent state", async () => {
      // TODO: Implement test
    });
  });

  describe("error type preservation", () => {
    test("preserves TypeError from constructor", async () => {
      // TODO: Implement test
    });

    test("preserves RangeError from method", async () => {
      // TODO: Implement test
    });

    test("preserves SyntaxError from method", async () => {
      // TODO: Implement test
    });

    test("preserves ReferenceError from getter", async () => {
      // TODO: Implement test
    });

    test("falls back to Error for unknown error types", async () => {
      // TODO: Implement test
    });

    test("preserves error message", async () => {
      // TODO: Implement test
    });
  });
});
