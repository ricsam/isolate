import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import {
  createConsistencyTestContext,
  getAbortControllerFromOrigin,
  getAbortSignalFromOrigin,
  type ConsistencyTestContext,
  ABORT_CONTROLLER_ORIGINS,
  ABORT_SIGNAL_ORIGINS,
} from "./origins.ts";

describe("Abort Consistency", () => {
  let ctx: ConsistencyTestContext;

  beforeEach(async () => {
    ctx = await createConsistencyTestContext();
  });

  afterEach(async () => {
    await ctx.dispose();
  });

  // ============================================================================
  // AbortController Tests
  // ============================================================================

  describe("AbortController Consistency", () => {
    describe("Property Existence", () => {
      for (const origin of ABORT_CONTROLLER_ORIGINS) {
        test(`signal property exists when from ${origin}`, async () => {
          await getAbortControllerFromOrigin(ctx, origin);
          await ctx.eval(`
            setResult(__testAbortController.signal instanceof AbortSignal);
          `);
          assert.strictEqual(ctx.getResult(), true);
        });
      }
    });

    describe("Method Existence", () => {
      for (const origin of ABORT_CONTROLLER_ORIGINS) {
        test(`abort() exists when from ${origin}`, async () => {
          await getAbortControllerFromOrigin(ctx, origin);
          await ctx.eval(`
            setResult(typeof __testAbortController.abort === 'function');
          `);
          assert.strictEqual(ctx.getResult(), true);
        });
      }
    });

    describe("Behavioral Equivalence", () => {
      for (const origin of ABORT_CONTROLLER_ORIGINS) {
        test(`signal.aborted is false initially when from ${origin}`, async () => {
          await getAbortControllerFromOrigin(ctx, origin);
          await ctx.eval(`
            setResult(__testAbortController.signal.aborted);
          `);
          assert.strictEqual(ctx.getResult(), false);
        });

        test(`abort() sets signal.aborted to true when from ${origin}`, async () => {
          await getAbortControllerFromOrigin(ctx, origin);
          await ctx.eval(`
            const abortedBefore = __testAbortController.signal.aborted;
            __testAbortController.abort();
            const abortedAfter = __testAbortController.signal.aborted;
            setResult({ abortedBefore, abortedAfter });
          `);
          const result = ctx.getResult() as { abortedBefore: boolean; abortedAfter: boolean };
          assert.strictEqual(result.abortedBefore, false);
          assert.strictEqual(result.abortedAfter, true);
        });

        test(`abort() with reason sets signal.reason when from ${origin}`, async () => {
          await getAbortControllerFromOrigin(ctx, origin);
          await ctx.eval(`
            __testAbortController.abort("custom reason");
            setResult(__testAbortController.signal.reason);
          `);
          assert.strictEqual(ctx.getResult(), "custom reason");
        });

        test(`abort() without reason sets default DOMException reason when from ${origin}`, async () => {
          await getAbortControllerFromOrigin(ctx, origin);
          await ctx.eval(`
            __testAbortController.abort();
            const reason = __testAbortController.signal.reason;
            setResult({
              isDOMException: reason instanceof DOMException,
              name: reason?.name,
              message: reason?.message,
            });
          `);
          const result = ctx.getResult() as { isDOMException: boolean; name?: string; message?: string };
          assert.strictEqual(result.isDOMException, true);
          assert.strictEqual(result.name, "AbortError");
        });

        test(`signal property returns same object on repeated access when from ${origin}`, async () => {
          await getAbortControllerFromOrigin(ctx, origin);
          await ctx.eval(`
            const signal1 = __testAbortController.signal;
            const signal2 = __testAbortController.signal;
            setResult(signal1 === signal2);
          `);
          assert.strictEqual(ctx.getResult(), true);
        });
      }
    });

    describe("instanceof Check", () => {
      for (const origin of ABORT_CONTROLLER_ORIGINS) {
        test(`instanceof AbortController when from ${origin}`, async () => {
          await getAbortControllerFromOrigin(ctx, origin);
          await ctx.eval(`
            setResult(__testAbortController instanceof AbortController);
          `);
          assert.strictEqual(ctx.getResult(), true);
        });

        test(`constructor.name is AbortController when from ${origin}`, async () => {
          await getAbortControllerFromOrigin(ctx, origin);
          await ctx.eval(`
            setResult(__testAbortController.constructor.name);
          `);
          assert.strictEqual(ctx.getResult(), "AbortController");
        });
      }
    });
  });

  // ============================================================================
  // AbortSignal Tests
  // ============================================================================

  describe("AbortSignal Consistency", () => {
    describe("Property Existence", () => {
      for (const origin of ABORT_SIGNAL_ORIGINS) {
        test(`aborted property exists when from ${origin}`, async () => {
          await getAbortSignalFromOrigin(ctx, origin);
          await ctx.eval(`
            setResult(typeof __testAbortSignal.aborted === 'boolean');
          `);
          assert.strictEqual(ctx.getResult(), true);
        });

        test(`reason property exists when from ${origin}`, async () => {
          await getAbortSignalFromOrigin(ctx, origin);
          await ctx.eval(`
            // reason is undefined initially
            setResult('reason' in __testAbortSignal);
          `);
          assert.strictEqual(ctx.getResult(), true);
        });

        // WHATWG spec requires onabort event handler property
        // https://dom.spec.whatwg.org/#interface-AbortSignal
        test.todo(`onabort property exists when from ${origin} (WHATWG: event handler property not implemented)`);
      }
    });

    describe("Method Existence", () => {
      for (const origin of ABORT_SIGNAL_ORIGINS) {
        test(`throwIfAborted() exists when from ${origin}`, async () => {
          await getAbortSignalFromOrigin(ctx, origin);
          await ctx.eval(`
            setResult(typeof __testAbortSignal.throwIfAborted === 'function');
          `);
          assert.strictEqual(ctx.getResult(), true);
        });

        test(`addEventListener() exists when from ${origin}`, async () => {
          await getAbortSignalFromOrigin(ctx, origin);
          await ctx.eval(`
            setResult(typeof __testAbortSignal.addEventListener === 'function');
          `);
          assert.strictEqual(ctx.getResult(), true);
        });

        test(`removeEventListener() exists when from ${origin}`, async () => {
          await getAbortSignalFromOrigin(ctx, origin);
          await ctx.eval(`
            setResult(typeof __testAbortSignal.removeEventListener === 'function');
          `);
          assert.strictEqual(ctx.getResult(), true);
        });
      }
    });

    describe("Static Method Existence", () => {
      test("AbortSignal.abort() static method exists", async () => {
        await ctx.eval(`
          setResult(typeof AbortSignal.abort === 'function');
        `);
        assert.strictEqual(ctx.getResult(), true);
      });

      test("AbortSignal.timeout() static method exists", async () => {
        await ctx.eval(`
          setResult(typeof AbortSignal.timeout === 'function');
        `);
        assert.strictEqual(ctx.getResult(), true);
      });

      // WHATWG spec requires AbortSignal.any() for combining multiple signals
      // https://dom.spec.whatwg.org/#dom-abortsignal-any
      test.todo("AbortSignal.any() static method exists (WHATWG: static method for combining signals not implemented)");
    });

    describe("Static Method Behavior", () => {
      test("AbortSignal.abort() returns already-aborted signal", async () => {
        await ctx.eval(`
          const signal = AbortSignal.abort();
          setResult({
            aborted: signal.aborted,
            isAbortSignal: signal instanceof AbortSignal,
          });
        `);
        const result = ctx.getResult() as { aborted: boolean; isAbortSignal: boolean };
        assert.strictEqual(result.aborted, true);
        assert.strictEqual(result.isAbortSignal, true);
      });

      test("AbortSignal.abort() with reason returns signal with that reason", async () => {
        await ctx.eval(`
          const signal = AbortSignal.abort("custom abort reason");
          setResult(signal.reason);
        `);
        assert.strictEqual(ctx.getResult(), "custom abort reason");
      });

      test("AbortSignal.timeout() returns AbortSignal", async () => {
        await ctx.eval(`
          const signal = AbortSignal.timeout(10000);
          setResult({
            isAbortSignal: signal instanceof AbortSignal,
            aborted: signal.aborted,
          });
        `);
        const result = ctx.getResult() as { isAbortSignal: boolean; aborted: boolean };
        assert.strictEqual(result.isAbortSignal, true);
        assert.strictEqual(result.aborted, false);
      });
    });

    describe("Behavioral Equivalence", () => {
      for (const origin of ABORT_SIGNAL_ORIGINS) {
        test(`aborted is false initially when from ${origin}`, async () => {
          await getAbortSignalFromOrigin(ctx, origin);
          await ctx.eval(`
            setResult(__testAbortSignal.aborted);
          `);
          assert.strictEqual(ctx.getResult(), false);
        });

        test(`reason is undefined initially when from ${origin}`, async () => {
          await getAbortSignalFromOrigin(ctx, origin);
          await ctx.eval(`
            setResult(__testAbortSignal.reason);
          `);
          assert.strictEqual(ctx.getResult(), undefined);
        });

        test(`throwIfAborted() does not throw when not aborted when from ${origin}`, async () => {
          await getAbortSignalFromOrigin(ctx, origin);
          await ctx.eval(`
            try {
              __testAbortSignal.throwIfAborted();
              setResult({ threw: false });
            } catch (e) {
              setResult({ threw: true });
            }
          `);
          const result = ctx.getResult() as { threw: boolean };
          assert.strictEqual(result.threw, false);
        });

        test(`throwIfAborted() throws when aborted when from ${origin}`, async () => {
          await getAbortSignalFromOrigin(ctx, origin);
          await ctx.eval(`
            __testAbortController.abort("test reason");
            try {
              __testAbortSignal.throwIfAborted();
              setResult({ threw: false });
            } catch (e) {
              setResult({ threw: true, reason: e });
            }
          `);
          const result = ctx.getResult() as { threw: boolean; reason?: string };
          assert.strictEqual(result.threw, true);
          assert.strictEqual(result.reason, "test reason");
        });

        test(`addEventListener('abort') is called when aborted when from ${origin}`, async () => {
          await getAbortSignalFromOrigin(ctx, origin);
          await ctx.eval(`
            let listenerCalled = false;
            let eventType = null;
            __testAbortSignal.addEventListener('abort', (event) => {
              listenerCalled = true;
              eventType = event.type;
            });
            __testAbortController.abort();
            setResult({ listenerCalled, eventType });
          `);
          const result = ctx.getResult() as { listenerCalled: boolean; eventType: string | null };
          assert.strictEqual(result.listenerCalled, true);
          assert.strictEqual(result.eventType, "abort");
        });

        test(`removeEventListener('abort') prevents listener from being called when from ${origin}`, async () => {
          await getAbortSignalFromOrigin(ctx, origin);
          await ctx.eval(`
            let listenerCalled = false;
            const listener = () => { listenerCalled = true; };
            __testAbortSignal.addEventListener('abort', listener);
            __testAbortSignal.removeEventListener('abort', listener);
            __testAbortController.abort();
            setResult(listenerCalled);
          `);
          assert.strictEqual(ctx.getResult(), false);
        });

        test(`multiple abort listeners are all called when from ${origin}`, async () => {
          await getAbortSignalFromOrigin(ctx, origin);
          await ctx.eval(`
            let calls = 0;
            __testAbortSignal.addEventListener('abort', () => { calls++; });
            __testAbortSignal.addEventListener('abort', () => { calls++; });
            __testAbortSignal.addEventListener('abort', () => { calls++; });
            __testAbortController.abort();
            setResult(calls);
          `);
          assert.strictEqual(ctx.getResult(), 3);
        });
      }
    });

    describe("instanceof Check", () => {
      for (const origin of ABORT_SIGNAL_ORIGINS) {
        test(`instanceof AbortSignal when from ${origin}`, async () => {
          await getAbortSignalFromOrigin(ctx, origin);
          await ctx.eval(`
            setResult(__testAbortSignal instanceof AbortSignal);
          `);
          assert.strictEqual(ctx.getResult(), true);
        });

        test(`constructor.name is AbortSignal when from ${origin}`, async () => {
          await getAbortSignalFromOrigin(ctx, origin);
          await ctx.eval(`
            setResult(__testAbortSignal.constructor.name);
          `);
          assert.strictEqual(ctx.getResult(), "AbortSignal");
        });
      }
    });
  });

  // ============================================================================
  // Integration Tests
  // ============================================================================

  describe("AbortController/AbortSignal Integration", () => {
    test("AbortController can abort a fetch request", async () => {
      // Set up a mock response that will be returned
      ctx.setMockResponse({
        status: 200,
        body: "test response",
      });

      await ctx.eval(`
        const controller = new AbortController();
        // Abort immediately
        controller.abort();

        try {
          await fetch("https://example.com/test", { signal: controller.signal });
          setResult({ threw: false });
        } catch (e) {
          setResult({
            threw: true,
            name: e.name,
          });
        }
      `);
      const result = ctx.getResult() as { threw: boolean; name?: string };
      assert.strictEqual(result.threw, true);
      assert.strictEqual(result.name, "AbortError");
    });

    test("AbortSignal.timeout() creates non-aborted signal initially", async () => {
      // Test that AbortSignal.timeout creates a valid signal that is not aborted initially
      await ctx.eval(`
        const signal = AbortSignal.timeout(10000);
        setResult({
          isAbortSignal: signal instanceof AbortSignal,
          aborted: signal.aborted,
          hasReason: 'reason' in signal,
        });
      `);
      const result = ctx.getResult() as { isAbortSignal: boolean; aborted: boolean; hasReason: boolean };
      assert.strictEqual(result.isAbortSignal, true);
      assert.strictEqual(result.aborted, false);
      assert.strictEqual(result.hasReason, true);
    });
  });
});
