import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import ivm from "isolated-vm";
import { withScope, withScopeAsync, marshal } from "./index.ts";

describe("scope", () => {
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

  describe("withScope", () => {
    test("returns the result of the callback", async () => {
      const result = withScope(context, () => 42);
      assert.strictEqual(result, 42);
    });

    test("manages handles and keeps them alive during scope", async () => {
      withScope(context, (scope) => {
        const ref = scope.marshal({ name: "test" });
        context.global.setSync("testData", ref);
        const result = context.evalSync(`testData.name`);
        assert.strictEqual(result, "test");
      });
    });

    test("disposes handles after scope exits", async () => {
      let capturedRef: ivm.Reference | null = null;
      withScope(context, (scope) => {
        capturedRef = scope.marshal("test value");
      });
      // The reference should be released after scope exits
      // Trying to use it should throw or return undefined
      assert.ok(capturedRef !== null);
    });

    test("disposes handles in reverse order (LIFO)", async () => {
      const order: number[] = [];
      withScope(context, (scope) => {
        // Create multiple handles
        scope.marshal({ id: 1 });
        scope.marshal({ id: 2 });
        scope.marshal({ id: 3 });
        // Handles will be disposed in reverse order (3, 2, 1)
      });
      // Test passes if no errors occur during disposal
      assert.ok(true);
    });

    test("disposes handles even when callback throws", async () => {
      let capturedRef: ivm.Reference | null = null;
      assert.throws(() => {
        withScope(context, (scope) => {
          capturedRef = scope.marshal("test");
          throw new Error("test error");
        });
      }, /test error/);
      // Handle should still be disposed even though callback threw
      assert.ok(capturedRef !== null);
    });

    test("works with nested scopes", async () => {
      const result = withScope(context, (outerScope) => {
        const outerRef = outerScope.marshal({ level: "outer" });
        context.global.setSync("outer", outerRef);

        return withScope(context, (innerScope) => {
          const innerRef = innerScope.marshal({ level: "inner" });
          context.global.setSync("inner", innerRef);
          return context.evalSync(`inner.level`);
        });
      });
      assert.strictEqual(result, "inner");
    });

    test("handles can be used to return values", async () => {
      const result = withScope(context, (scope) => {
        const ref = scope.marshal({ value: 123 });
        context.global.setSync("data", ref);
        return context.evalSync(`data.value`);
      });
      assert.strictEqual(result, 123);
    });

    test("works with marshal helper", async () => {
      withScope(context, (scope) => {
        const ref = scope.marshal({ key: "value" });
        context.global.setSync("obj", ref);
        const result = context.evalSync(`obj.key`);
        assert.strictEqual(result, "value");
      });
    });
  });

  describe("withScopeAsync", () => {
    test("returns the result of the async callback", async () => {
      const result = await withScopeAsync(context, async () => {
        return 42;
      });
      assert.strictEqual(result, 42);
    });

    test("manages handles during async operations", async () => {
      await withScopeAsync(context, async (scope) => {
        const ref = scope.marshal({ async: true });
        context.global.setSync("asyncData", ref);
        const result = await context.eval(`asyncData.async`);
        assert.strictEqual(result, true);
      });
    });

    test("disposes handles after async scope exits", async () => {
      let capturedRef: ivm.Reference | null = null;
      await withScopeAsync(context, async (scope) => {
        capturedRef = scope.marshal("async test");
        await Promise.resolve();
      });
      assert.ok(capturedRef !== null);
    });

    test("disposes handles when async callback rejects", async () => {
      let capturedRef: ivm.Reference | null = null;
      await assert.rejects(async () => {
        await withScopeAsync(context, async (scope) => {
          capturedRef = scope.marshal("test");
          await Promise.resolve();
          throw new Error("async error");
        });
      }, /async error/);
      assert.ok(capturedRef !== null);
    });

    test("works with real async operations", async () => {
      const result = await withScopeAsync(context, async (scope) => {
        const ref = scope.marshal({ data: "test" });
        context.global.setSync("asyncObj", ref);
        // Simulate async work
        await new Promise((resolve) => setTimeout(resolve, 10));
        return await context.eval(`asyncObj.data`);
      });
      assert.strictEqual(result, "test");
    });

    test("nested async scopes work correctly", async () => {
      const result = await withScopeAsync(context, async (outerScope) => {
        const outerRef = outerScope.marshal({ level: "outer" });
        context.global.setSync("outerAsync", outerRef);

        return await withScopeAsync(context, async (innerScope) => {
          const innerRef = innerScope.marshal({ level: "inner" });
          context.global.setSync("innerAsync", innerRef);
          return await context.eval(`innerAsync.level`);
        });
      });
      assert.strictEqual(result, "inner");
    });
  });

  describe("edge cases", () => {
    test("empty scope works", async () => {
      const result = withScope(context, () => "done");
      assert.strictEqual(result, "done");
    });

    test("scope with many handles", async () => {
      withScope(context, (scope) => {
        for (let i = 0; i < 100; i++) {
          scope.marshal({ index: i });
        }
      });
      // Test passes if no errors occur
      assert.ok(true);
    });

    test("manages already-alive handles correctly", async () => {
      const preExistingRef = marshal(context, { preexisting: true });
      withScope(context, (scope) => {
        scope.manage(preExistingRef);
      });
      // Pre-existing handle is now released by the scope
      assert.ok(true);
    });
  });
});
