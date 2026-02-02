import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import ivm from "isolated-vm";
import { setupTestEnvironment, runTests } from "./index.ts";

describe("Additional Matchers", () => {
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

  describe("Basic Matchers", () => {
    test("toBeNaN - passes for NaN", async () => {
      context.evalSync(`
        test("NaN check", () => {
          expect(NaN).toBeNaN();
          expect(Number("not a number")).toBeNaN();
        });
      `);
      const results = await runTests(context);
      assert.strictEqual(results.passed, 1);
      assert.strictEqual(results.failed, 0);
    });

    test("toBeNaN - fails for numbers", async () => {
      context.evalSync(`
        test("not NaN", () => {
          expect(42).toBeNaN();
        });
      `);
      const results = await runTests(context);
      assert.strictEqual(results.failed, 1);
      assert.strictEqual(results.tests[0]?.error?.matcherName, "toBeNaN");
    });

    test("toBeNaN - negated", async () => {
      context.evalSync(`
        test("not NaN", () => {
          expect(42).not.toBeNaN();
          expect("hello").not.toBeNaN();
        });
      `);
      const results = await runTests(context);
      assert.strictEqual(results.passed, 1);
    });

    test("toMatchObject - partial object matching", async () => {
      context.evalSync(`
        test("partial match", () => {
          expect({ a: 1, b: 2, c: 3 }).toMatchObject({ a: 1, b: 2 });
        });
      `);
      const results = await runTests(context);
      assert.strictEqual(results.passed, 1);
    });

    test("toMatchObject - nested objects", async () => {
      context.evalSync(`
        test("nested match", () => {
          expect({ a: { b: { c: 1 }, d: 2 }, e: 3 }).toMatchObject({ a: { b: { c: 1 } } });
        });
      `);
      const results = await runTests(context);
      assert.strictEqual(results.passed, 1);
    });

    test("toMatchObject - fails when property missing", async () => {
      context.evalSync(`
        test("missing property", () => {
          expect({ a: 1 }).toMatchObject({ b: 2 });
        });
      `);
      const results = await runTests(context);
      assert.strictEqual(results.failed, 1);
    });

    test("toContainEqual - deep equality in arrays", async () => {
      context.evalSync(`
        test("contains equal object", () => {
          expect([{ a: 1 }, { b: 2 }]).toContainEqual({ a: 1 });
        });
      `);
      const results = await runTests(context);
      assert.strictEqual(results.passed, 1);
    });

    test("toContainEqual - fails when not found", async () => {
      context.evalSync(`
        test("does not contain", () => {
          expect([{ a: 1 }, { b: 2 }]).toContainEqual({ c: 3 });
        });
      `);
      const results = await runTests(context);
      assert.strictEqual(results.failed, 1);
    });

    test("toBeTypeOf - typeof checks", async () => {
      context.evalSync(`
        test("type checks", () => {
          expect("hello").toBeTypeOf("string");
          expect(42).toBeTypeOf("number");
          expect(true).toBeTypeOf("boolean");
          expect({}).toBeTypeOf("object");
          expect(() => {}).toBeTypeOf("function");
          expect(undefined).toBeTypeOf("undefined");
        });
      `);
      const results = await runTests(context);
      assert.strictEqual(results.passed, 1);
    });

    test("toBeTypeOf - fails on wrong type", async () => {
      context.evalSync(`
        test("wrong type", () => {
          expect("hello").toBeTypeOf("number");
        });
      `);
      const results = await runTests(context);
      assert.strictEqual(results.failed, 1);
      assert.ok(results.tests[0]?.error?.message.includes("string"));
    });
  });

  describe("Asymmetric Matchers", () => {
    test("expect.anything() - matches non-null/undefined", async () => {
      context.evalSync(`
        test("anything matcher", () => {
          expect(1).toEqual(expect.anything());
          expect("hello").toEqual(expect.anything());
          expect({}).toEqual(expect.anything());
          expect([]).toEqual(expect.anything());
        });
      `);
      const results = await runTests(context);
      assert.strictEqual(results.passed, 1);
    });

    test("expect.anything() - fails for null/undefined", async () => {
      context.evalSync(`
        test("anything fails for null", () => {
          expect(null).toEqual(expect.anything());
        });
      `);
      const results = await runTests(context);
      assert.strictEqual(results.failed, 1);
    });

    test("expect.any(Number) - matches numbers", async () => {
      context.evalSync(`
        test("any Number", () => {
          expect(42).toEqual(expect.any(Number));
          expect(3.14).toEqual(expect.any(Number));
        });
      `);
      const results = await runTests(context);
      assert.strictEqual(results.passed, 1);
    });

    test("expect.any(String) - matches strings", async () => {
      context.evalSync(`
        test("any String", () => {
          expect("hello").toEqual(expect.any(String));
          expect("").toEqual(expect.any(String));
        });
      `);
      const results = await runTests(context);
      assert.strictEqual(results.passed, 1);
    });

    test("expect.any() - matches instances", async () => {
      context.evalSync(`
        class MyClass {}
        test("any instance", () => {
          expect(new MyClass()).toEqual(expect.any(MyClass));
          expect(new Date()).toEqual(expect.any(Date));
          expect(new Error()).toEqual(expect.any(Error));
        });
      `);
      const results = await runTests(context);
      assert.strictEqual(results.passed, 1);
    });

    test("expect.stringContaining() - partial string", async () => {
      context.evalSync(`
        test("string containing", () => {
          expect("hello world").toEqual(expect.stringContaining("world"));
          expect("foobar").toEqual(expect.stringContaining("oba"));
        });
      `);
      const results = await runTests(context);
      assert.strictEqual(results.passed, 1);
    });

    test("expect.stringMatching() - regexp", async () => {
      context.evalSync(`
        test("string matching", () => {
          expect("hello123").toEqual(expect.stringMatching(/\\d+/));
          expect("abc").toEqual(expect.stringMatching(/^[a-z]+$/));
        });
      `);
      const results = await runTests(context);
      assert.strictEqual(results.passed, 1);
    });

    test("expect.arrayContaining() - subset arrays", async () => {
      context.evalSync(`
        test("array containing", () => {
          expect([1, 2, 3, 4, 5]).toEqual(expect.arrayContaining([2, 4]));
          expect(["a", "b", "c"]).toEqual(expect.arrayContaining(["c", "a"]));
        });
      `);
      const results = await runTests(context);
      assert.strictEqual(results.passed, 1);
    });

    test("expect.objectContaining() - subset objects", async () => {
      context.evalSync(`
        test("object containing", () => {
          expect({ a: 1, b: 2, c: 3 }).toEqual(expect.objectContaining({ a: 1, c: 3 }));
        });
      `);
      const results = await runTests(context);
      assert.strictEqual(results.passed, 1);
    });

    test("nested asymmetric matchers", async () => {
      context.evalSync(`
        test("nested matchers", () => {
          expect({
            id: 123,
            name: "test",
            items: [1, 2, 3]
          }).toEqual(expect.objectContaining({
            id: expect.any(Number),
            name: expect.stringContaining("est"),
            items: expect.arrayContaining([2])
          }));
        });
      `);
      const results = await runTests(context);
      assert.strictEqual(results.passed, 1);
    });

    test("with toHaveBeenCalledWith", async () => {
      context.evalSync(`
        test("mock with asymmetric", () => {
          const fn = mock.fn();
          fn({ id: 1, name: "test", timestamp: Date.now() });

          expect(fn).toHaveBeenCalledWith(
            expect.objectContaining({ id: 1, name: expect.any(String) })
          );
        });
      `);
      const results = await runTests(context);
      assert.strictEqual(results.passed, 1);
    });

    test("toMatchObject with asymmetric matchers", async () => {
      context.evalSync(`
        test("matchObject with asymmetric", () => {
          expect({ a: 1, b: "hello", c: 3 }).toMatchObject({
            a: expect.any(Number),
            b: expect.stringContaining("ell")
          });
        });
      `);
      const results = await runTests(context);
      assert.strictEqual(results.passed, 1);
    });
  });

  describe("Promise Matchers", () => {
    test("expect(promise).resolves.toBe(value)", async () => {
      context.evalSync(`
        test("resolves toBe", async () => {
          await expect(Promise.resolve(42)).resolves.toBe(42);
        });
      `);
      const results = await runTests(context);
      assert.strictEqual(results.passed, 1);
    });

    test("expect(promise).resolves.toEqual(value)", async () => {
      context.evalSync(`
        test("resolves toEqual", async () => {
          await expect(Promise.resolve({ a: 1 })).resolves.toEqual({ a: 1 });
        });
      `);
      const results = await runTests(context);
      assert.strictEqual(results.passed, 1);
    });

    test("expect(promise).rejects.toBeInstanceOf(Error)", async () => {
      context.evalSync(`
        test("rejects toBeInstanceOf", async () => {
          await expect(Promise.reject(new Error("oops"))).rejects.toBeInstanceOf(Error);
        });
      `);
      const results = await runTests(context);
      assert.strictEqual(results.passed, 1);
    });

    test("expect(promise).rejects.toBeInstanceOf(CustomError)", async () => {
      context.evalSync(`
        class CustomError extends Error {}
        test("rejects toBeInstanceOf", async () => {
          await expect(Promise.reject(new CustomError("oops"))).rejects.toBeInstanceOf(CustomError);
        });
      `);
      const results = await runTests(context);
      assert.strictEqual(results.passed, 1);
    });

    test("expect(promise).resolves.not.toBe()", async () => {
      context.evalSync(`
        test("resolves not toBe", async () => {
          await expect(Promise.resolve(42)).resolves.not.toBe(100);
        });
      `);
      const results = await runTests(context);
      assert.strictEqual(results.passed, 1);
    });

    test("expect(promise).rejects.not.toBeInstanceOf()", async () => {
      context.evalSync(`
        test("rejects not toBeInstanceOf", async () => {
          await expect(Promise.reject(new Error("oops"))).rejects.not.toBeInstanceOf(TypeError);
        });
      `);
      const results = await runTests(context);
      assert.strictEqual(results.passed, 1);
    });

    test("fails when promise resolves but expected to reject", async () => {
      context.evalSync(`
        test("expected reject but resolved", async () => {
          await expect(Promise.resolve(42)).rejects.toBe(42);
        });
      `);
      const results = await runTests(context);
      assert.strictEqual(results.failed, 1);
      assert.ok(results.tests[0]?.error?.message.includes("reject"));
    });
  });

  describe("Additional Mock Matchers", () => {
    test("toHaveReturnedTimes - correct count", async () => {
      context.evalSync(`
        test("returned times", () => {
          const fn = mock.fn(() => 42);
          fn();
          fn();
          fn();
          expect(fn).toHaveReturnedTimes(3);
        });
      `);
      const results = await runTests(context);
      assert.strictEqual(results.passed, 1);
    });

    test("toHaveReturnedTimes - wrong count fails", async () => {
      context.evalSync(`
        test("wrong return count", () => {
          const fn = mock.fn(() => 42);
          fn();
          fn();
          expect(fn).toHaveReturnedTimes(5);
        });
      `);
      const results = await runTests(context);
      assert.strictEqual(results.failed, 1);
    });

    test("toHaveNthReturnedWith - specific return value", async () => {
      context.evalSync(`
        test("nth return value", () => {
          const fn = mock.fn()
            .mockReturnValueOnce(1)
            .mockReturnValueOnce(2)
            .mockReturnValueOnce(3);
          fn();
          fn();
          fn();
          expect(fn).toHaveNthReturnedWith(1, 1);
          expect(fn).toHaveNthReturnedWith(2, 2);
          expect(fn).toHaveNthReturnedWith(3, 3);
        });
      `);
      const results = await runTests(context);
      assert.strictEqual(results.passed, 1);
    });

    test("toHaveNthReturnedWith - wrong value fails", async () => {
      context.evalSync(`
        test("wrong nth return", () => {
          const fn = mock.fn(() => 42);
          fn();
          expect(fn).toHaveNthReturnedWith(1, 100);
        });
      `);
      const results = await runTests(context);
      assert.strictEqual(results.failed, 1);
    });
  });

  describe("Assertion Counting", () => {
    test("expect.assertions(n) - exact count passes", async () => {
      context.evalSync(`
        test("exact assertion count", () => {
          expect.assertions(2);
          expect(1).toBe(1);
          expect(2).toBe(2);
        });
      `);
      const results = await runTests(context);
      assert.strictEqual(results.passed, 1);
    });

    test("expect.assertions(n) - wrong count fails", async () => {
      context.evalSync(`
        test("wrong assertion count", () => {
          expect.assertions(3);
          expect(1).toBe(1);
          expect(2).toBe(2);
        });
      `);
      const results = await runTests(context);
      assert.strictEqual(results.failed, 1);
      assert.ok(results.tests[0]?.error?.message.includes("Expected 3 assertions"));
    });

    test("expect.hasAssertions() - at least one", async () => {
      context.evalSync(`
        test("has assertions", () => {
          expect.hasAssertions();
          expect(1).toBe(1);
        });
      `);
      const results = await runTests(context);
      assert.strictEqual(results.passed, 1);
    });

    test("expect.hasAssertions() - fails with no assertions", async () => {
      context.evalSync(`
        test("no assertions", () => {
          expect.hasAssertions();
          // No assertions made
        });
      `);
      const results = await runTests(context);
      assert.strictEqual(results.failed, 1);
      assert.ok(results.tests[0]?.error?.message.includes("at least one assertion"));
    });

    test("assertion count resets between tests", async () => {
      context.evalSync(`
        test("first test", () => {
          expect.assertions(1);
          expect(1).toBe(1);
        });
        test("second test", () => {
          expect.assertions(2);
          expect(1).toBe(1);
          expect(2).toBe(2);
        });
      `);
      const results = await runTests(context);
      assert.strictEqual(results.passed, 2);
      assert.strictEqual(results.failed, 0);
    });
  });
});
