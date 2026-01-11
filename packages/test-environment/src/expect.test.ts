import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import ivm from "isolated-vm";
import { setupTestEnvironment } from "./index.ts";

describe("expect matchers", () => {
  let isolate: ivm.Isolate;
  let context: ivm.Context;

  beforeEach(async () => {
    isolate = new ivm.Isolate();
    context = await isolate.createContext();
    await setupTestEnvironment(context);
  });

  afterEach(() => {
    context.release();
    isolate.dispose();
  });

  describe("toBe", () => {
    test("passes for equal primitives", async () => {
      // TODO: Implement test
    });

    test("fails for different primitives", async () => {
      // TODO: Implement test
    });
  });

  describe("toEqual", () => {
    test("passes for equal objects", async () => {
      // TODO: Implement test
    });

    test("passes for equal arrays", async () => {
      // TODO: Implement test
    });
  });

  describe("toStrictEqual", () => {
    test("checks for strict equality", async () => {
      // TODO: Implement test
    });
  });

  describe("not modifier", () => {
    test("not.toBe inverts the check", async () => {
      // TODO: Implement test
    });
  });

  describe("toBeTruthy", () => {
    test("passes for truthy values", async () => {
      // TODO: Implement test
    });
  });

  describe("toBeFalsy", () => {
    test("passes for falsy values", async () => {
      // TODO: Implement test
    });
  });

  describe("toBeNull", () => {
    test("passes for null", async () => {
      // TODO: Implement test
    });
  });

  describe("toBeUndefined", () => {
    test("passes for undefined", async () => {
      // TODO: Implement test
    });
  });

  describe("toBeDefined", () => {
    test("passes for defined values", async () => {
      // TODO: Implement test
    });
  });

  describe("toContain", () => {
    test("passes when array contains item", async () => {
      // TODO: Implement test
    });

    test("passes when string contains substring", async () => {
      // TODO: Implement test
    });
  });

  describe("toThrow", () => {
    test("passes when function throws", async () => {
      // TODO: Implement test
    });

    test("can match error message", async () => {
      // TODO: Implement test
    });
  });

  describe("toBeInstanceOf", () => {
    test("passes for correct instance", async () => {
      // TODO: Implement test
    });
  });

  describe("toHaveLength", () => {
    test("passes for correct array length", async () => {
      // TODO: Implement test
    });

    test("passes for correct string length", async () => {
      // TODO: Implement test
    });
  });
});
