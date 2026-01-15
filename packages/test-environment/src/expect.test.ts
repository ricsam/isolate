import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import ivm from "isolated-vm";
import { setupTestEnvironment, runTests } from "./index.ts";

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
      context.evalSync(`
        test("toBe test", () => {
          expect(1).toBe(1);
          expect("hello").toBe("hello");
          expect(true).toBe(true);
        });
      `);
      const results = await runTests(context);
      assert.strictEqual(results.passed, 1);
      assert.strictEqual(results.failed, 0);
    });

    test("fails for different primitives", async () => {
      context.evalSync(`
        test("toBe fails", () => {
          expect(1).toBe(2);
        });
      `);
      const results = await runTests(context);
      assert.strictEqual(results.passed, 0);
      assert.strictEqual(results.failed, 1);
      assert.ok(results.tests[0]!.error?.message?.includes("Expected 1 to be 2"));
    });
  });

  describe("toEqual", () => {
    test("passes for equal objects", async () => {
      context.evalSync(`
        test("toEqual objects", () => {
          expect({ a: 1, b: 2 }).toEqual({ a: 1, b: 2 });
          expect({ nested: { value: 42 } }).toEqual({ nested: { value: 42 } });
        });
      `);
      const results = await runTests(context);
      assert.strictEqual(results.passed, 1);
      assert.strictEqual(results.failed, 0);
    });

    test("passes for equal arrays", async () => {
      context.evalSync(`
        test("toEqual arrays", () => {
          expect([1, 2, 3]).toEqual([1, 2, 3]);
          expect([{ a: 1 }, { b: 2 }]).toEqual([{ a: 1 }, { b: 2 }]);
        });
      `);
      const results = await runTests(context);
      assert.strictEqual(results.passed, 1);
      assert.strictEqual(results.failed, 0);
    });
  });

  describe("toStrictEqual", () => {
    test("checks for strict equality", async () => {
      context.evalSync(`
        test("toStrictEqual", () => {
          expect({ a: 1 }).toStrictEqual({ a: 1 });
        });
      `);
      const results = await runTests(context);
      assert.strictEqual(results.passed, 1);
      assert.strictEqual(results.failed, 0);
    });
  });

  describe("not modifier", () => {
    test("not.toBe inverts the check", async () => {
      context.evalSync(`
        test("not.toBe", () => {
          expect(1).not.toBe(2);
          expect("hello").not.toBe("world");
        });
      `);
      const results = await runTests(context);
      assert.strictEqual(results.passed, 1);
      assert.strictEqual(results.failed, 0);
    });
  });

  describe("toBeTruthy", () => {
    test("passes for truthy values", async () => {
      context.evalSync(`
        test("toBeTruthy", () => {
          expect(1).toBeTruthy();
          expect("hello").toBeTruthy();
          expect([]).toBeTruthy();
          expect({}).toBeTruthy();
        });
      `);
      const results = await runTests(context);
      assert.strictEqual(results.passed, 1);
      assert.strictEqual(results.failed, 0);
    });
  });

  describe("toBeFalsy", () => {
    test("passes for falsy values", async () => {
      context.evalSync(`
        test("toBeFalsy", () => {
          expect(0).toBeFalsy();
          expect("").toBeFalsy();
          expect(null).toBeFalsy();
          expect(undefined).toBeFalsy();
          expect(false).toBeFalsy();
        });
      `);
      const results = await runTests(context);
      assert.strictEqual(results.passed, 1);
      assert.strictEqual(results.failed, 0);
    });
  });

  describe("toBeNull", () => {
    test("passes for null", async () => {
      context.evalSync(`
        test("toBeNull", () => {
          expect(null).toBeNull();
        });
      `);
      const results = await runTests(context);
      assert.strictEqual(results.passed, 1);
      assert.strictEqual(results.failed, 0);
    });
  });

  describe("toBeUndefined", () => {
    test("passes for undefined", async () => {
      context.evalSync(`
        test("toBeUndefined", () => {
          expect(undefined).toBeUndefined();
          let x;
          expect(x).toBeUndefined();
        });
      `);
      const results = await runTests(context);
      assert.strictEqual(results.passed, 1);
      assert.strictEqual(results.failed, 0);
    });
  });

  describe("toBeDefined", () => {
    test("passes for defined values", async () => {
      context.evalSync(`
        test("toBeDefined", () => {
          expect(1).toBeDefined();
          expect("").toBeDefined();
          expect(null).toBeDefined();
          expect(0).toBeDefined();
        });
      `);
      const results = await runTests(context);
      assert.strictEqual(results.passed, 1);
      assert.strictEqual(results.failed, 0);
    });
  });

  describe("toContain", () => {
    test("passes when array contains item", async () => {
      context.evalSync(`
        test("toContain array", () => {
          expect([1, 2, 3]).toContain(2);
          expect(["a", "b", "c"]).toContain("b");
        });
      `);
      const results = await runTests(context);
      assert.strictEqual(results.passed, 1);
      assert.strictEqual(results.failed, 0);
    });

    test("passes when string contains substring", async () => {
      context.evalSync(`
        test("toContain string", () => {
          expect("hello world").toContain("world");
          expect("abc").toContain("b");
        });
      `);
      const results = await runTests(context);
      assert.strictEqual(results.passed, 1);
      assert.strictEqual(results.failed, 0);
    });
  });

  describe("toThrow", () => {
    test("passes when function throws", async () => {
      context.evalSync(`
        test("toThrow", () => {
          expect(() => { throw new Error("boom"); }).toThrow();
        });
      `);
      const results = await runTests(context);
      assert.strictEqual(results.passed, 1);
      assert.strictEqual(results.failed, 0);
    });

    test("can match error message", async () => {
      context.evalSync(`
        test("toThrow with message", () => {
          expect(() => { throw new Error("something went wrong"); }).toThrow("went wrong");
        });
      `);
      const results = await runTests(context);
      assert.strictEqual(results.passed, 1);
      assert.strictEqual(results.failed, 0);
    });
  });

  describe("toBeInstanceOf", () => {
    test("passes for correct instance", async () => {
      context.evalSync(`
        test("toBeInstanceOf", () => {
          expect(new Error()).toBeInstanceOf(Error);
          expect([]).toBeInstanceOf(Array);
          expect({}).toBeInstanceOf(Object);
        });
      `);
      const results = await runTests(context);
      assert.strictEqual(results.passed, 1);
      assert.strictEqual(results.failed, 0);
    });
  });

  describe("toHaveLength", () => {
    test("passes for correct array length", async () => {
      context.evalSync(`
        test("toHaveLength array", () => {
          expect([1, 2, 3]).toHaveLength(3);
          expect([]).toHaveLength(0);
        });
      `);
      const results = await runTests(context);
      assert.strictEqual(results.passed, 1);
      assert.strictEqual(results.failed, 0);
    });

    test("passes for correct string length", async () => {
      context.evalSync(`
        test("toHaveLength string", () => {
          expect("hello").toHaveLength(5);
          expect("").toHaveLength(0);
        });
      `);
      const results = await runTests(context);
      assert.strictEqual(results.passed, 1);
      assert.strictEqual(results.failed, 0);
    });
  });

  describe("toMatch", () => {
    test("passes for matching regexp", async () => {
      context.evalSync(`
        test("toMatch regexp", () => {
          expect("hello world").toMatch(/world/);
          expect("abc123").toMatch(/\\d+/);
        });
      `);
      const results = await runTests(context);
      assert.strictEqual(results.passed, 1);
      assert.strictEqual(results.failed, 0);
    });

    test("passes for matching substring", async () => {
      context.evalSync(`
        test("toMatch substring", () => {
          expect("hello world").toMatch("world");
        });
      `);
      const results = await runTests(context);
      assert.strictEqual(results.passed, 1);
      assert.strictEqual(results.failed, 0);
    });
  });

  describe("toHaveProperty", () => {
    test("passes when property exists", async () => {
      context.evalSync(`
        test("toHaveProperty exists", () => {
          expect({ a: 1 }).toHaveProperty("a");
          expect({ nested: { value: 42 } }).toHaveProperty("nested.value");
        });
      `);
      const results = await runTests(context);
      assert.strictEqual(results.passed, 1);
      assert.strictEqual(results.failed, 0);
    });

    test("passes when property has expected value", async () => {
      context.evalSync(`
        test("toHaveProperty with value", () => {
          expect({ a: 1 }).toHaveProperty("a", 1);
          expect({ nested: { value: 42 } }).toHaveProperty("nested.value", 42);
        });
      `);
      const results = await runTests(context);
      assert.strictEqual(results.passed, 1);
      assert.strictEqual(results.failed, 0);
    });
  });
});
