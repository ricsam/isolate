import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import ivm from "isolated-vm";
import { setupTimers, type TimersHandle } from "./index.ts";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("@ricsam/isolate-timers", () => {
  let isolate: ivm.Isolate;
  let context: ivm.Context;
  let handle: TimersHandle;

  beforeEach(async () => {
    isolate = new ivm.Isolate();
    context = await isolate.createContext();
    handle = await setupTimers(context);
  });

  afterEach(() => {
    handle.dispose();
    context.release();
    isolate.dispose();
  });

  describe("setTimeout", () => {
    test("executes callback after delay", async () => {
      context.evalSync(`
        globalThis.called = false;
        setTimeout(() => { globalThis.called = true; }, 20);
      `);

      // Not called yet immediately
      assert.strictEqual(context.evalSync("globalThis.called"), false);

      // Wait for timer to fire
      await sleep(50);
      assert.strictEqual(context.evalSync("globalThis.called"), true);
    });

    test("returns a timer ID", async () => {
      const result = context.evalSync(`
        const id = setTimeout(() => {}, 100);
        typeof id === 'number' && id > 0;
      `);
      assert.strictEqual(result, true);
    });

    test("passes arguments to callback", async () => {
      context.evalSync(`
        globalThis.receivedArgs = [];
        setTimeout((a, b, c) => {
          globalThis.receivedArgs = [a, b, c];
        }, 10, 'hello', 42, true);
      `);

      await sleep(30);
      const args = context.evalSync("JSON.stringify(globalThis.receivedArgs)");
      assert.deepStrictEqual(JSON.parse(args as string), ["hello", 42, true]);
    });
  });

  describe("clearTimeout", () => {
    test("cancels a pending timeout", async () => {
      context.evalSync(`
        globalThis.called = false;
        const id = setTimeout(() => { globalThis.called = true; }, 20);
        clearTimeout(id);
      `);

      await sleep(50);
      assert.strictEqual(context.evalSync("globalThis.called"), false);
    });

    test("does nothing for invalid ID", async () => {
      // Should not throw
      context.evalSync(`
        clearTimeout(999999);
        clearTimeout(undefined);
        clearTimeout(null);
      `);
      // If we get here without error, the test passes
      assert.ok(true);
    });
  });

  describe("setInterval", () => {
    test("executes callback repeatedly", async () => {
      context.evalSync(`
        globalThis.count = 0;
        globalThis.intervalId = setInterval(() => { globalThis.count++; }, 20);
      `);

      await sleep(70); // Should fire ~3 times
      const count = context.evalSync("globalThis.count") as number;
      assert.ok(count >= 2, `Expected count >= 2, got ${count}`);

      // Clear so it doesn't keep running
      context.evalSync("clearInterval(globalThis.intervalId)");
    });

    test("returns a timer ID", async () => {
      const result = context.evalSync(`
        const id = setInterval(() => {}, 100);
        clearInterval(id); // Clean up
        typeof id === 'number' && id > 0;
      `);
      assert.strictEqual(result, true);
    });
  });

  describe("clearInterval", () => {
    test("stops an interval", async () => {
      context.evalSync(`
        globalThis.count = 0;
        globalThis.intervalId = setInterval(() => { globalThis.count++; }, 15);
      `);

      await sleep(40); // Let it run a bit
      const countBefore = context.evalSync("globalThis.count") as number;
      assert.ok(countBefore >= 1, "Interval should have fired at least once");

      // Clear the interval
      context.evalSync("clearInterval(globalThis.intervalId)");

      // Wait a bit more
      await sleep(50);
      const countAfter = context.evalSync("globalThis.count") as number;

      // Count should not have increased (or only by 1 if timing is close)
      assert.ok(
        countAfter <= countBefore + 1,
        `Count should have stopped, before=${countBefore}, after=${countAfter}`
      );
    });
  });

  describe("nested timers", () => {
    test("setTimeout inside setTimeout works", async () => {
      context.evalSync(`
        globalThis.order = [];
        setTimeout(() => {
          globalThis.order.push('first');
          setTimeout(() => {
            globalThis.order.push('second');
          }, 20);
        }, 20);
      `);

      await sleep(30);
      assert.deepStrictEqual(
        JSON.parse(context.evalSync("JSON.stringify(globalThis.order)") as string),
        ["first"]
      );

      await sleep(30);
      assert.deepStrictEqual(
        JSON.parse(context.evalSync("JSON.stringify(globalThis.order)") as string),
        ["first", "second"]
      );
    });
  });

  describe("handle.clearAll()", () => {
    test("clears all pending timers", async () => {
      context.evalSync(`
        globalThis.count = 0;
        setTimeout(() => globalThis.count++, 20);
        setTimeout(() => globalThis.count++, 30);
        setInterval(() => globalThis.count++, 15);
      `);

      handle.clearAll();

      // Wait past all scheduled times
      await sleep(60);

      // Nothing should have executed
      assert.strictEqual(context.evalSync("globalThis.count"), 0);
    });
  });

  describe("edge cases", () => {
    test("timer with delay 0 fires quickly", async () => {
      context.evalSync(`
        globalThis.called = false;
        setTimeout(() => { globalThis.called = true; }, 0);
      `);

      await sleep(20);
      assert.strictEqual(context.evalSync("globalThis.called"), true);
    });

    test("negative delay is treated as 0", async () => {
      context.evalSync(`
        globalThis.called = false;
        setTimeout(() => { globalThis.called = true; }, -100);
      `);

      await sleep(20);
      assert.strictEqual(context.evalSync("globalThis.called"), true);
    });

    test("multiple intervals at same delay", async () => {
      context.evalSync(`
        globalThis.a = 0;
        globalThis.b = 0;
        globalThis.intervalA = setInterval(() => globalThis.a++, 20);
        globalThis.intervalB = setInterval(() => globalThis.b++, 20);
      `);

      await sleep(50);
      const a = context.evalSync("globalThis.a") as number;
      const b = context.evalSync("globalThis.b") as number;
      assert.ok(a >= 1, `Expected a >= 1, got ${a}`);
      assert.ok(b >= 1, `Expected b >= 1, got ${b}`);

      // Clean up
      context.evalSync("clearInterval(globalThis.intervalA)");
      context.evalSync("clearInterval(globalThis.intervalB)");
    });

    test("clearTimeout inside callback", async () => {
      context.evalSync(`
        globalThis.secondCalled = false;
        const id = setTimeout(() => { globalThis.secondCalled = true; }, 40);
        setTimeout(() => { clearTimeout(id); }, 10);
      `);

      await sleep(60);
      assert.strictEqual(context.evalSync("globalThis.secondCalled"), false);
    });
  });
});
