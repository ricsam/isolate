import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import ivm from "isolated-vm";
import { setupTimers } from "./index.ts";

describe("@ricsam/isolate-timers", () => {
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

  describe("setTimeout", () => {
    test("executes callback after delay", async () => {
      const handle = await setupTimers(context);
      context.evalSync(`
        globalThis.called = false;
        setTimeout(() => { globalThis.called = true; }, 100);
      `);

      // Not called yet at time 0
      await handle.tick(0);
      assert.strictEqual(context.evalSync("globalThis.called"), false);

      // Not called yet at time 50
      await handle.tick(50);
      assert.strictEqual(context.evalSync("globalThis.called"), false);

      // Called after 100ms total
      await handle.tick(50);
      assert.strictEqual(context.evalSync("globalThis.called"), true);
    });

    test("returns a timer ID", async () => {
      const handle = await setupTimers(context);
      const result = context.evalSync(`
        const id = setTimeout(() => {}, 100);
        typeof id === 'number' && id > 0;
      `);
      assert.strictEqual(result, true);
    });

    test("passes arguments to callback", async () => {
      const handle = await setupTimers(context);
      context.evalSync(`
        globalThis.receivedArgs = [];
        setTimeout((a, b, c) => {
          globalThis.receivedArgs = [a, b, c];
        }, 0, 'hello', 42, true);
      `);

      await handle.tick(0);
      const args = context.evalSync("JSON.stringify(globalThis.receivedArgs)");
      assert.deepStrictEqual(JSON.parse(args as string), ["hello", 42, true]);
    });
  });

  describe("clearTimeout", () => {
    test("cancels a pending timeout", async () => {
      const handle = await setupTimers(context);
      context.evalSync(`
        globalThis.called = false;
        const id = setTimeout(() => { globalThis.called = true; }, 100);
        clearTimeout(id);
      `);

      await handle.tick(100);
      assert.strictEqual(context.evalSync("globalThis.called"), false);
    });

    test("does nothing for invalid ID", async () => {
      const handle = await setupTimers(context);
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
      const handle = await setupTimers(context);
      context.evalSync(`
        globalThis.count = 0;
        setInterval(() => { globalThis.count++; }, 50);
      `);

      await handle.tick(50); // count = 1
      assert.strictEqual(context.evalSync("globalThis.count"), 1);

      await handle.tick(50); // count = 2
      assert.strictEqual(context.evalSync("globalThis.count"), 2);

      await handle.tick(50); // count = 3
      assert.strictEqual(context.evalSync("globalThis.count"), 3);
    });

    test("returns a timer ID", async () => {
      const handle = await setupTimers(context);
      const result = context.evalSync(`
        const id = setInterval(() => {}, 100);
        typeof id === 'number' && id > 0;
      `);
      assert.strictEqual(result, true);
    });
  });

  describe("clearInterval", () => {
    test("stops an interval", async () => {
      const handle = await setupTimers(context);
      context.evalSync(`
        globalThis.count = 0;
        globalThis.intervalId = setInterval(() => { globalThis.count++; }, 50);
      `);

      await handle.tick(50); // count = 1
      assert.strictEqual(context.evalSync("globalThis.count"), 1);

      // Clear the interval
      context.evalSync("clearInterval(globalThis.intervalId)");

      // Should not increment anymore
      await handle.tick(50);
      await handle.tick(50);
      assert.strictEqual(context.evalSync("globalThis.count"), 1);
    });
  });

  describe("nested timers", () => {
    test("setTimeout inside setTimeout works", async () => {
      const handle = await setupTimers(context);
      context.evalSync(`
        globalThis.order = [];
        setTimeout(() => {
          globalThis.order.push('first');
          setTimeout(() => {
            globalThis.order.push('second');
          }, 50);
        }, 50);
      `);

      await handle.tick(50); // First timer fires, schedules second
      assert.deepStrictEqual(
        JSON.parse(context.evalSync("JSON.stringify(globalThis.order)") as string),
        ["first"]
      );

      await handle.tick(50); // Second timer fires
      assert.deepStrictEqual(
        JSON.parse(context.evalSync("JSON.stringify(globalThis.order)") as string),
        ["first", "second"]
      );
    });
  });

  describe("handle.tick()", () => {
    test("processes pending timers", async () => {
      const handle = await setupTimers(context);
      context.evalSync(`
        globalThis.order = [];
        setTimeout(() => globalThis.order.push('a'), 30);
        setTimeout(() => globalThis.order.push('b'), 10);
        setTimeout(() => globalThis.order.push('c'), 20);
      `);

      // Tick enough to process all timers
      await handle.tick(30);

      // Should be in order of scheduled time
      const order = JSON.parse(
        context.evalSync("JSON.stringify(globalThis.order)") as string
      );
      assert.deepStrictEqual(order, ["b", "c", "a"]);
    });
  });

  describe("handle.clearAll()", () => {
    test("clears all pending timers", async () => {
      const handle = await setupTimers(context);
      context.evalSync(`
        globalThis.count = 0;
        setTimeout(() => globalThis.count++, 50);
        setTimeout(() => globalThis.count++, 100);
        setInterval(() => globalThis.count++, 25);
      `);

      handle.clearAll();

      // Tick past all scheduled times
      await handle.tick(200);

      // Nothing should have executed
      assert.strictEqual(context.evalSync("globalThis.count"), 0);
    });
  });

  describe("edge cases", () => {
    test("timer with delay 0 fires immediately on tick", async () => {
      const handle = await setupTimers(context);
      context.evalSync(`
        globalThis.called = false;
        setTimeout(() => { globalThis.called = true; }, 0);
      `);

      await handle.tick(0);
      assert.strictEqual(context.evalSync("globalThis.called"), true);
    });

    test("negative delay is treated as 0", async () => {
      const handle = await setupTimers(context);
      context.evalSync(`
        globalThis.called = false;
        setTimeout(() => { globalThis.called = true; }, -100);
      `);

      await handle.tick(0);
      assert.strictEqual(context.evalSync("globalThis.called"), true);
    });

    test("multiple intervals at same delay", async () => {
      const handle = await setupTimers(context);
      context.evalSync(`
        globalThis.a = 0;
        globalThis.b = 0;
        setInterval(() => globalThis.a++, 50);
        setInterval(() => globalThis.b++, 50);
      `);

      await handle.tick(50);
      assert.strictEqual(context.evalSync("globalThis.a"), 1);
      assert.strictEqual(context.evalSync("globalThis.b"), 1);

      await handle.tick(50);
      assert.strictEqual(context.evalSync("globalThis.a"), 2);
      assert.strictEqual(context.evalSync("globalThis.b"), 2);
    });

    test("clearTimeout inside callback", async () => {
      const handle = await setupTimers(context);
      context.evalSync(`
        globalThis.secondCalled = false;
        const id = setTimeout(() => { globalThis.secondCalled = true; }, 100);
        setTimeout(() => { clearTimeout(id); }, 50);
      `);

      await handle.tick(50); // First callback clears the second
      await handle.tick(50); // Second would fire here but was cleared

      assert.strictEqual(context.evalSync("globalThis.secondCalled"), false);
    });
  });
});
