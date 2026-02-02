import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import ivm from "isolated-vm";
import { setupTestEnvironment, runTests } from "./index.ts";

describe("mock system", () => {
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

  describe("mock.fn()", () => {
    test("creates a callable mock function", async () => {
      context.evalSync(`
        test("mock is callable", () => {
          const fn = mock.fn();
          fn();
          fn("arg1", "arg2");
          expect(fn.mock.calls.length).toBe(2);
        });
      `);
      const results = await runTests(context);
      assert.strictEqual(results.passed, 1);
      assert.strictEqual(results.failed, 0);
    });

    test("tracks call arguments", async () => {
      context.evalSync(`
        test("tracks args", () => {
          const fn = mock.fn();
          fn("a", 1);
          fn("b", 2);
          expect(fn.mock.calls[0]).toEqual(["a", 1]);
          expect(fn.mock.calls[1]).toEqual(["b", 2]);
        });
      `);
      const results = await runTests(context);
      assert.strictEqual(results.passed, 1);
    });

    test("tracks lastCall", async () => {
      context.evalSync(`
        test("tracks lastCall", () => {
          const fn = mock.fn();
          fn("first");
          fn("second");
          expect(fn.mock.lastCall).toEqual(["second"]);
        });
      `);
      const results = await runTests(context);
      assert.strictEqual(results.passed, 1);
    });

    test("tracks this context", async () => {
      context.evalSync(`
        test("tracks context", () => {
          const fn = mock.fn();
          const obj = { method: fn };
          obj.method();
          expect(fn.mock.contexts[0]).toBe(obj);
        });
      `);
      const results = await runTests(context);
      assert.strictEqual(results.passed, 1);
    });

    test("accepts an implementation", async () => {
      context.evalSync(`
        test("with implementation", () => {
          const fn = mock.fn((x) => x * 2);
          expect(fn(5)).toBe(10);
        });
      `);
      const results = await runTests(context);
      assert.strictEqual(results.passed, 1);
    });
  });

  describe("mockReturnValue / mockReturnValueOnce", () => {
    test("mockReturnValue sets default return", async () => {
      context.evalSync(`
        test("mockReturnValue", () => {
          const fn = mock.fn().mockReturnValue(42);
          expect(fn()).toBe(42);
          expect(fn()).toBe(42);
        });
      `);
      const results = await runTests(context);
      assert.strictEqual(results.passed, 1);
    });

    test("mockReturnValueOnce returns value once", async () => {
      context.evalSync(`
        test("mockReturnValueOnce", () => {
          const fn = mock.fn()
            .mockReturnValueOnce("first")
            .mockReturnValueOnce("second")
            .mockReturnValue("default");
          expect(fn()).toBe("first");
          expect(fn()).toBe("second");
          expect(fn()).toBe("default");
        });
      `);
      const results = await runTests(context);
      assert.strictEqual(results.passed, 1);
    });
  });

  describe("mockResolvedValue / mockRejectedValue", () => {
    test("mockResolvedValue returns resolved promise", async () => {
      context.evalSync(`
        test("mockResolvedValue", async () => {
          const fn = mock.fn().mockResolvedValue("resolved");
          const result = await fn();
          expect(result).toBe("resolved");
        });
      `);
      const results = await runTests(context);
      assert.strictEqual(results.passed, 1);
    });

    test("mockRejectedValue returns rejected promise", async () => {
      context.evalSync(`
        test("mockRejectedValue", async () => {
          const fn = mock.fn().mockRejectedValue(new Error("oops"));
          try {
            await fn();
            expect(true).toBe(false); // should not reach here
          } catch (e) {
            expect(e.message).toBe("oops");
          }
        });
      `);
      const results = await runTests(context);
      assert.strictEqual(results.passed, 1);
    });
  });

  describe("mockImplementation / mockImplementationOnce", () => {
    test("mockImplementation sets implementation", async () => {
      context.evalSync(`
        test("mockImplementation", () => {
          const fn = mock.fn().mockImplementation((x) => x + 1);
          expect(fn(5)).toBe(6);
        });
      `);
      const results = await runTests(context);
      assert.strictEqual(results.passed, 1);
    });

    test("mockImplementationOnce runs once", async () => {
      context.evalSync(`
        test("mockImplementationOnce", () => {
          const fn = mock.fn()
            .mockImplementationOnce(() => "once")
            .mockImplementation(() => "default");
          expect(fn()).toBe("once");
          expect(fn()).toBe("default");
        });
      `);
      const results = await runTests(context);
      assert.strictEqual(results.passed, 1);
    });
  });

  describe("mockClear / mockReset", () => {
    test("mockClear clears call history", async () => {
      context.evalSync(`
        test("mockClear", () => {
          const fn = mock.fn().mockReturnValue(42);
          fn();
          fn();
          expect(fn.mock.calls.length).toBe(2);
          fn.mockClear();
          expect(fn.mock.calls.length).toBe(0);
          // Return value should still work
          expect(fn()).toBe(42);
        });
      `);
      const results = await runTests(context);
      assert.strictEqual(results.passed, 1);
    });

    test("mockReset clears everything", async () => {
      context.evalSync(`
        test("mockReset", () => {
          const fn = mock.fn().mockReturnValue(42);
          fn();
          fn.mockReset();
          expect(fn.mock.calls.length).toBe(0);
          // Return value should be cleared too
          expect(fn()).toBe(undefined);
        });
      `);
      const results = await runTests(context);
      assert.strictEqual(results.passed, 1);
    });
  });

  describe("mock.spyOn()", () => {
    test("spies on object methods", async () => {
      context.evalSync(`
        test("spyOn basics", () => {
          const obj = { greet: (name) => "Hello, " + name };
          const spy = mock.spyOn(obj, "greet");

          expect(obj.greet("World")).toBe("Hello, World");
          expect(spy).toHaveBeenCalled();
          expect(spy).toHaveBeenCalledWith("World");
        });
      `);
      const results = await runTests(context);
      assert.strictEqual(results.passed, 1);
    });

    test("can mock return value of spy", async () => {
      context.evalSync(`
        test("spy mockReturnValue", () => {
          const obj = { getValue: () => "original" };
          const spy = mock.spyOn(obj, "getValue").mockReturnValue("mocked");

          expect(obj.getValue()).toBe("mocked");
        });
      `);
      const results = await runTests(context);
      assert.strictEqual(results.passed, 1);
    });

    test("mockRestore restores original method", async () => {
      context.evalSync(`
        test("spy mockRestore", () => {
          const obj = { getValue: () => "original" };
          const spy = mock.spyOn(obj, "getValue").mockReturnValue("mocked");

          expect(obj.getValue()).toBe("mocked");

          spy.mockRestore();
          expect(obj.getValue()).toBe("original");
        });
      `);
      const results = await runTests(context);
      assert.strictEqual(results.passed, 1);
    });

    test("throws if method is not a function", async () => {
      context.evalSync(`
        test("spyOn non-function", () => {
          const obj = { value: 42 };
          expect(() => mock.spyOn(obj, "value")).toThrow("not a function");
        });
      `);
      const results = await runTests(context);
      assert.strictEqual(results.passed, 1);
    });
  });

  describe("global mock management", () => {
    test("clearAllMocks clears all mocks", async () => {
      context.evalSync(`
        test("clearAllMocks", () => {
          const fn1 = mock.fn();
          const fn2 = mock.fn();
          fn1(); fn1();
          fn2();

          mock.clearAllMocks();

          expect(fn1.mock.calls.length).toBe(0);
          expect(fn2.mock.calls.length).toBe(0);
        });
      `);
      const results = await runTests(context);
      assert.strictEqual(results.passed, 1);
    });

    test("resetAllMocks resets all mocks", async () => {
      context.evalSync(`
        test("resetAllMocks", () => {
          const fn1 = mock.fn().mockReturnValue("a");
          const fn2 = mock.fn().mockReturnValue("b");
          fn1(); fn2();

          mock.resetAllMocks();

          expect(fn1.mock.calls.length).toBe(0);
          expect(fn2.mock.calls.length).toBe(0);
          expect(fn1()).toBe(undefined);
          expect(fn2()).toBe(undefined);
        });
      `);
      const results = await runTests(context);
      assert.strictEqual(results.passed, 1);
    });

    test("restoreAllMocks restores all spies", async () => {
      context.evalSync(`
        test("restoreAllMocks", () => {
          const obj1 = { fn: () => "orig1" };
          const obj2 = { fn: () => "orig2" };

          mock.spyOn(obj1, "fn").mockReturnValue("mock1");
          mock.spyOn(obj2, "fn").mockReturnValue("mock2");

          expect(obj1.fn()).toBe("mock1");
          expect(obj2.fn()).toBe("mock2");

          mock.restoreAllMocks();

          expect(obj1.fn()).toBe("orig1");
          expect(obj2.fn()).toBe("orig2");
        });
      `);
      const results = await runTests(context);
      assert.strictEqual(results.passed, 1);
    });
  });

  describe("toHaveBeenCalled matcher", () => {
    test("passes when mock was called", async () => {
      context.evalSync(`
        test("toHaveBeenCalled pass", () => {
          const fn = mock.fn();
          fn();
          expect(fn).toHaveBeenCalled();
        });
      `);
      const results = await runTests(context);
      assert.strictEqual(results.passed, 1);
    });

    test("fails when mock was not called", async () => {
      context.evalSync(`
        test("toHaveBeenCalled fail", () => {
          const fn = mock.fn();
          expect(fn).toHaveBeenCalled();
        });
      `);
      const results = await runTests(context);
      assert.strictEqual(results.failed, 1);
    });

    test("negation works", async () => {
      context.evalSync(`
        test("not.toHaveBeenCalled", () => {
          const fn = mock.fn();
          expect(fn).not.toHaveBeenCalled();
        });
      `);
      const results = await runTests(context);
      assert.strictEqual(results.passed, 1);
    });
  });

  describe("toHaveBeenCalledTimes matcher", () => {
    test("passes with correct count", async () => {
      context.evalSync(`
        test("toHaveBeenCalledTimes pass", () => {
          const fn = mock.fn();
          fn(); fn(); fn();
          expect(fn).toHaveBeenCalledTimes(3);
        });
      `);
      const results = await runTests(context);
      assert.strictEqual(results.passed, 1);
    });

    test("fails with wrong count", async () => {
      context.evalSync(`
        test("toHaveBeenCalledTimes fail", () => {
          const fn = mock.fn();
          fn(); fn();
          expect(fn).toHaveBeenCalledTimes(3);
        });
      `);
      const results = await runTests(context);
      assert.strictEqual(results.failed, 1);
    });
  });

  describe("toHaveBeenCalledWith matcher", () => {
    test("passes when args match", async () => {
      context.evalSync(`
        test("toHaveBeenCalledWith pass", () => {
          const fn = mock.fn();
          fn("a", 1);
          fn("b", 2);
          expect(fn).toHaveBeenCalledWith("a", 1);
          expect(fn).toHaveBeenCalledWith("b", 2);
        });
      `);
      const results = await runTests(context);
      assert.strictEqual(results.passed, 1);
    });

    test("fails when args don't match", async () => {
      context.evalSync(`
        test("toHaveBeenCalledWith fail", () => {
          const fn = mock.fn();
          fn("a", 1);
          expect(fn).toHaveBeenCalledWith("x", 99);
        });
      `);
      const results = await runTests(context);
      assert.strictEqual(results.failed, 1);
    });

    test("works with objects", async () => {
      context.evalSync(`
        test("toHaveBeenCalledWith objects", () => {
          const fn = mock.fn();
          fn({ name: "test" });
          expect(fn).toHaveBeenCalledWith({ name: "test" });
        });
      `);
      const results = await runTests(context);
      assert.strictEqual(results.passed, 1);
    });
  });

  describe("toHaveBeenLastCalledWith matcher", () => {
    test("checks last call args", async () => {
      context.evalSync(`
        test("toHaveBeenLastCalledWith", () => {
          const fn = mock.fn();
          fn("first");
          fn("second");
          fn("third");
          expect(fn).toHaveBeenLastCalledWith("third");
        });
      `);
      const results = await runTests(context);
      assert.strictEqual(results.passed, 1);
    });
  });

  describe("toHaveBeenNthCalledWith matcher", () => {
    test("checks nth call args", async () => {
      context.evalSync(`
        test("toHaveBeenNthCalledWith", () => {
          const fn = mock.fn();
          fn("first");
          fn("second");
          fn("third");
          expect(fn).toHaveBeenNthCalledWith(1, "first");
          expect(fn).toHaveBeenNthCalledWith(2, "second");
          expect(fn).toHaveBeenNthCalledWith(3, "third");
        });
      `);
      const results = await runTests(context);
      assert.strictEqual(results.passed, 1);
    });
  });

  describe("toHaveReturned matcher", () => {
    test("passes when mock returned", async () => {
      context.evalSync(`
        test("toHaveReturned pass", () => {
          const fn = mock.fn(() => 42);
          fn();
          expect(fn).toHaveReturned();
        });
      `);
      const results = await runTests(context);
      assert.strictEqual(results.passed, 1);
    });

    test("fails when mock threw", async () => {
      context.evalSync(`
        test("toHaveReturned fail on throw", () => {
          const fn = mock.fn(() => { throw new Error("oops"); });
          try { fn(); } catch {}
          expect(fn).toHaveReturned();
        });
      `);
      const results = await runTests(context);
      assert.strictEqual(results.failed, 1);
    });
  });

  describe("toHaveReturnedWith matcher", () => {
    test("checks return value", async () => {
      context.evalSync(`
        test("toHaveReturnedWith", () => {
          const fn = mock.fn()
            .mockReturnValueOnce("a")
            .mockReturnValueOnce("b");
          fn(); fn();
          expect(fn).toHaveReturnedWith("a");
          expect(fn).toHaveReturnedWith("b");
        });
      `);
      const results = await runTests(context);
      assert.strictEqual(results.passed, 1);
    });
  });

  describe("toHaveLastReturnedWith matcher", () => {
    test("checks last return value", async () => {
      context.evalSync(`
        test("toHaveLastReturnedWith", () => {
          const fn = mock.fn()
            .mockReturnValueOnce("first")
            .mockReturnValueOnce("last");
          fn(); fn();
          expect(fn).toHaveLastReturnedWith("last");
        });
      `);
      const results = await runTests(context);
      assert.strictEqual(results.passed, 1);
    });
  });

  describe("jest compatibility alias", () => {
    test("jest.fn works like mock.fn", async () => {
      context.evalSync(`
        test("jest.fn", () => {
          const fn = jest.fn();
          fn("hello");
          expect(fn).toHaveBeenCalledWith("hello");
        });
      `);
      const results = await runTests(context);
      assert.strictEqual(results.passed, 1);
    });

    test("jest.spyOn works like mock.spyOn", async () => {
      context.evalSync(`
        test("jest.spyOn", () => {
          const obj = { greet: () => "hi" };
          const spy = jest.spyOn(obj, "greet");
          obj.greet();
          expect(spy).toHaveBeenCalled();
        });
      `);
      const results = await runTests(context);
      assert.strictEqual(results.passed, 1);
    });
  });

  describe("error handling for non-mock values", () => {
    test("throws when using mock matchers on non-mock", async () => {
      context.evalSync(`
        test("error on non-mock", () => {
          const fn = () => {};
          expect(() => {
            expect(fn).toHaveBeenCalled();
          }).toThrow("requires a mock function");
        });
      `);
      const results = await runTests(context);
      assert.strictEqual(results.passed, 1);
    });
  });

  describe("result tracking", () => {
    test("tracks exceptions in results", async () => {
      context.evalSync(`
        test("tracks exceptions", () => {
          const fn = mock.fn(() => { throw new Error("boom"); });
          try { fn(); } catch {}
          expect(fn.mock.results[0].type).toBe("throw");
          expect(fn.mock.results[0].value.message).toBe("boom");
        });
      `);
      const results = await runTests(context);
      assert.strictEqual(results.passed, 1);
    });

    test("tracks return values in results", async () => {
      context.evalSync(`
        test("tracks returns", () => {
          const fn = mock.fn()
            .mockReturnValueOnce("a")
            .mockReturnValueOnce("b");
          fn(); fn();
          expect(fn.mock.results[0]).toEqual({ type: "return", value: "a" });
          expect(fn.mock.results[1]).toEqual({ type: "return", value: "b" });
        });
      `);
      const results = await runTests(context);
      assert.strictEqual(results.passed, 1);
    });
  });
});
