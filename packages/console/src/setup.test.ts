import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import ivm from "isolated-vm";
import { setupConsole, type ConsoleHandle } from "./index.ts";

describe("@ricsam/isolate-console", () => {
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

  describe("log-level methods", () => {
    test("console.log calls onLog with correct level", async () => {
      const logCalls: Array<{ level: string; args: unknown[] }> = [];
      await setupConsole(context, {
        onLog: (level, ...args) => logCalls.push({ level, args }),
      });
      context.evalSync(`console.log("hello", 123)`);
      assert.strictEqual(logCalls.length, 1);
      assert.strictEqual(logCalls[0].level, "log");
      assert.deepStrictEqual(logCalls[0].args, ["hello", 123]);
    });

    test("console.warn calls onLog with warn level", async () => {
      const logCalls: Array<{ level: string; args: unknown[] }> = [];
      await setupConsole(context, {
        onLog: (level, ...args) => logCalls.push({ level, args }),
      });
      context.evalSync(`console.warn("warning")`);
      assert.strictEqual(logCalls.length, 1);
      assert.strictEqual(logCalls[0].level, "warn");
      assert.deepStrictEqual(logCalls[0].args, ["warning"]);
    });

    test("console.error calls onLog with error level", async () => {
      const logCalls: Array<{ level: string; args: unknown[] }> = [];
      await setupConsole(context, {
        onLog: (level, ...args) => logCalls.push({ level, args }),
      });
      context.evalSync(`console.error("error message")`);
      assert.strictEqual(logCalls.length, 1);
      assert.strictEqual(logCalls[0].level, "error");
      assert.deepStrictEqual(logCalls[0].args, ["error message"]);
    });

    test("console.debug calls onLog with debug level", async () => {
      const logCalls: Array<{ level: string; args: unknown[] }> = [];
      await setupConsole(context, {
        onLog: (level, ...args) => logCalls.push({ level, args }),
      });
      context.evalSync(`console.debug("debug info")`);
      assert.strictEqual(logCalls.length, 1);
      assert.strictEqual(logCalls[0].level, "debug");
    });

    test("console.info calls onLog with info level", async () => {
      const logCalls: Array<{ level: string; args: unknown[] }> = [];
      await setupConsole(context, {
        onLog: (level, ...args) => logCalls.push({ level, args }),
      });
      context.evalSync(`console.info("information")`);
      assert.strictEqual(logCalls.length, 1);
      assert.strictEqual(logCalls[0].level, "info");
    });

    test("console.trace calls onLog with trace level", async () => {
      const logCalls: Array<{ level: string; args: unknown[] }> = [];
      await setupConsole(context, {
        onLog: (level, ...args) => logCalls.push({ level, args }),
      });
      context.evalSync(`console.trace("trace")`);
      assert.strictEqual(logCalls.length, 1);
      assert.strictEqual(logCalls[0].level, "trace");
    });

    test("console.dir calls onLog with dir level", async () => {
      const logCalls: Array<{ level: string; args: unknown[] }> = [];
      await setupConsole(context, {
        onLog: (level, ...args) => logCalls.push({ level, args }),
      });
      context.evalSync(`console.dir({ key: "value" })`);
      assert.strictEqual(logCalls.length, 1);
      assert.strictEqual(logCalls[0].level, "dir");
      assert.deepStrictEqual(logCalls[0].args, [{ key: "value" }]);
    });

    test("console.table calls onLog with table level", async () => {
      const logCalls: Array<{ level: string; args: unknown[] }> = [];
      await setupConsole(context, {
        onLog: (level, ...args) => logCalls.push({ level, args }),
      });
      context.evalSync(`console.table([1, 2, 3])`);
      assert.strictEqual(logCalls.length, 1);
      assert.strictEqual(logCalls[0].level, "table");
      assert.deepStrictEqual(logCalls[0].args, [[1, 2, 3]]);
    });

    test("console.log with no arguments", async () => {
      const logCalls: Array<{ level: string; args: unknown[] }> = [];
      await setupConsole(context, {
        onLog: (level, ...args) => logCalls.push({ level, args }),
      });
      context.evalSync(`console.log()`);
      assert.strictEqual(logCalls.length, 1);
      assert.deepStrictEqual(logCalls[0].args, []);
    });

    test("console.log with multiple arguments", async () => {
      const logCalls: Array<{ level: string; args: unknown[] }> = [];
      await setupConsole(context, {
        onLog: (level, ...args) => logCalls.push({ level, args }),
      });
      context.evalSync(`console.log("a", "b", "c", 1, 2, 3)`);
      assert.strictEqual(logCalls.length, 1);
      assert.deepStrictEqual(logCalls[0].args, ["a", "b", "c", 1, 2, 3]);
    });
  });

  describe("timing methods", () => {
    test("console.time starts a timer", async () => {
      const handle = await setupConsole(context);
      context.evalSync(`console.time("test")`);
      assert.strictEqual(handle.getTimers().has("test"), true);
    });

    test("console.time uses default label", async () => {
      const handle = await setupConsole(context);
      context.evalSync(`console.time()`);
      assert.strictEqual(handle.getTimers().has("default"), true);
    });

    test("console.timeEnd reports duration", async () => {
      const timeCalls: Array<{ label: string; duration: number }> = [];
      const handle = await setupConsole(context, {
        onTime: (label, duration) => timeCalls.push({ label, duration }),
      });
      context.evalSync(`console.time("test")`);
      await new Promise((resolve) => setTimeout(resolve, 10));
      context.evalSync(`console.timeEnd("test")`);

      assert.strictEqual(timeCalls.length, 1);
      assert.strictEqual(timeCalls[0].label, "test");
      assert.ok(timeCalls[0].duration >= 0);
      assert.strictEqual(handle.getTimers().has("test"), false);
    });

    test("console.timeEnd with default label", async () => {
      const timeCalls: Array<{ label: string; duration: number }> = [];
      await setupConsole(context, {
        onTime: (label, duration) => timeCalls.push({ label, duration }),
      });
      context.evalSync(`console.time()`);
      await new Promise((resolve) => setTimeout(resolve, 5));
      context.evalSync(`console.timeEnd()`);

      assert.strictEqual(timeCalls.length, 1);
      assert.strictEqual(timeCalls[0].label, "default");
    });

    test("console.timeEnd with non-existent timer is no-op", async () => {
      const timeCalls: Array<{ label: string; duration: number }> = [];
      await setupConsole(context, {
        onTime: (label, duration) => timeCalls.push({ label, duration }),
      });
      context.evalSync(`console.timeEnd("nonexistent")`);
      assert.strictEqual(timeCalls.length, 0);
    });

    test("console.timeLog reports duration without ending", async () => {
      const timeLogCalls: Array<{
        label: string;
        duration: number;
        args: unknown[];
      }> = [];
      const handle = await setupConsole(context, {
        onTimeLog: (label, duration, ...args) =>
          timeLogCalls.push({ label, duration, args }),
      });
      context.evalSync(`console.time("test")`);
      await new Promise((resolve) => setTimeout(resolve, 5));
      context.evalSync(`console.timeLog("test", "additional", "args")`);

      assert.strictEqual(timeLogCalls.length, 1);
      assert.strictEqual(timeLogCalls[0].label, "test");
      assert.deepStrictEqual(timeLogCalls[0].args, ["additional", "args"]);
      assert.strictEqual(handle.getTimers().has("test"), true); // Timer still running
    });

    test("console.timeLog with non-existent timer is no-op", async () => {
      const timeLogCalls: Array<{
        label: string;
        duration: number;
        args: unknown[];
      }> = [];
      await setupConsole(context, {
        onTimeLog: (label, duration, ...args) =>
          timeLogCalls.push({ label, duration, args }),
      });
      context.evalSync(`console.timeLog("nonexistent")`);
      assert.strictEqual(timeLogCalls.length, 0);
    });
  });

  describe("counting methods", () => {
    test("console.count increments counter", async () => {
      const countCalls: Array<{ label: string; count: number }> = [];
      await setupConsole(context, {
        onCount: (label, count) => countCalls.push({ label, count }),
      });
      context.evalSync(`console.count("test")`);
      assert.strictEqual(countCalls.length, 1);
      assert.deepStrictEqual(countCalls[0], { label: "test", count: 1 });

      context.evalSync(`console.count("test")`);
      assert.strictEqual(countCalls.length, 2);
      assert.deepStrictEqual(countCalls[1], { label: "test", count: 2 });
    });

    test("console.count uses default label", async () => {
      const countCalls: Array<{ label: string; count: number }> = [];
      await setupConsole(context, {
        onCount: (label, count) => countCalls.push({ label, count }),
      });
      context.evalSync(`console.count()`);
      assert.strictEqual(countCalls[0].label, "default");
    });

    test("console.countReset clears counter", async () => {
      const countCalls: Array<{ label: string; count: number }> = [];
      const countResetCalls: string[] = [];
      const handle = await setupConsole(context, {
        onCount: (label, count) => countCalls.push({ label, count }),
        onCountReset: (label) => countResetCalls.push(label),
      });
      context.evalSync(`console.count("test")`);
      context.evalSync(`console.count("test")`);
      context.evalSync(`console.countReset("test")`);

      assert.deepStrictEqual(countResetCalls, ["test"]);
      assert.strictEqual(handle.getCounters().has("test"), false);

      // After reset, count starts from 1 again
      context.evalSync(`console.count("test")`);
      assert.deepStrictEqual(countCalls[countCalls.length - 1], {
        label: "test",
        count: 1,
      });
    });

    test("console.countReset with default label", async () => {
      const countResetCalls: string[] = [];
      await setupConsole(context, {
        onCountReset: (label) => countResetCalls.push(label),
      });
      context.evalSync(`console.count()`);
      context.evalSync(`console.countReset()`);
      assert.deepStrictEqual(countResetCalls, ["default"]);
    });

    test("console.countReset with non-existent counter still calls handler", async () => {
      const countResetCalls: string[] = [];
      await setupConsole(context, {
        onCountReset: (label) => countResetCalls.push(label),
      });
      context.evalSync(`console.countReset("nonexistent")`);
      assert.deepStrictEqual(countResetCalls, ["nonexistent"]);
    });

    test("getCounters returns correct state", async () => {
      const handle = await setupConsole(context);
      context.evalSync(`console.count("a")`);
      context.evalSync(`console.count("a")`);
      context.evalSync(`console.count("b")`);

      const counters = handle.getCounters();
      assert.strictEqual(counters.get("a"), 2);
      assert.strictEqual(counters.get("b"), 1);
    });
  });

  describe("grouping methods", () => {
    test("console.group increments depth", async () => {
      const groupCalls: Array<{ label: string; collapsed: boolean }> = [];
      const handle = await setupConsole(context, {
        onGroup: (label, collapsed) => groupCalls.push({ label, collapsed }),
      });
      assert.strictEqual(handle.getGroupDepth(), 0);
      context.evalSync(`console.group("Group 1")`);
      assert.strictEqual(handle.getGroupDepth(), 1);
      assert.deepStrictEqual(groupCalls[0], {
        label: "Group 1",
        collapsed: false,
      });
    });

    test("console.groupCollapsed increments depth with collapsed flag", async () => {
      const groupCalls: Array<{ label: string; collapsed: boolean }> = [];
      const handle = await setupConsole(context, {
        onGroup: (label, collapsed) => groupCalls.push({ label, collapsed }),
      });
      context.evalSync(`console.groupCollapsed("Collapsed Group")`);
      assert.strictEqual(handle.getGroupDepth(), 1);
      assert.deepStrictEqual(groupCalls[0], {
        label: "Collapsed Group",
        collapsed: true,
      });
    });

    test("console.group uses default label", async () => {
      const groupCalls: Array<{ label: string; collapsed: boolean }> = [];
      await setupConsole(context, {
        onGroup: (label, collapsed) => groupCalls.push({ label, collapsed }),
      });
      context.evalSync(`console.group()`);
      assert.strictEqual(groupCalls[0].label, "default");
    });

    test("console.groupEnd decrements depth", async () => {
      let groupEndCalls = 0;
      const handle = await setupConsole(context, {
        onGroupEnd: () => groupEndCalls++,
      });
      context.evalSync(`console.group()`);
      context.evalSync(`console.group()`);
      assert.strictEqual(handle.getGroupDepth(), 2);

      context.evalSync(`console.groupEnd()`);
      assert.strictEqual(handle.getGroupDepth(), 1);
      assert.strictEqual(groupEndCalls, 1);
    });

    test("console.groupEnd at depth 0 stays at 0", async () => {
      let groupEndCalls = 0;
      const handle = await setupConsole(context, {
        onGroupEnd: () => groupEndCalls++,
      });
      context.evalSync(`console.groupEnd()`);
      assert.strictEqual(handle.getGroupDepth(), 0);
      assert.strictEqual(groupEndCalls, 1); // Handler still called
    });

    test("nested groups track depth correctly", async () => {
      const handle = await setupConsole(context);
      context.evalSync(`
        console.group("Level 1");
        console.group("Level 2");
        console.group("Level 3");
      `);
      assert.strictEqual(handle.getGroupDepth(), 3);

      context.evalSync(`
        console.groupEnd();
        console.groupEnd();
      `);
      assert.strictEqual(handle.getGroupDepth(), 1);
    });
  });

  describe("other methods", () => {
    test("console.clear calls onClear", async () => {
      let clearCalls = 0;
      await setupConsole(context, {
        onClear: () => clearCalls++,
      });
      context.evalSync(`console.clear()`);
      assert.strictEqual(clearCalls, 1);
    });

    test("console.assert with truthy condition does not call handler", async () => {
      const assertCalls: Array<{ condition: boolean; args: unknown[] }> = [];
      await setupConsole(context, {
        onAssert: (condition, ...args) =>
          assertCalls.push({ condition, args }),
      });
      context.evalSync(`console.assert(true, "should not appear")`);
      assert.strictEqual(assertCalls.length, 0);
    });

    test("console.assert with falsy condition calls handler", async () => {
      const assertCalls: Array<{ condition: boolean; args: unknown[] }> = [];
      await setupConsole(context, {
        onAssert: (condition, ...args) =>
          assertCalls.push({ condition, args }),
      });
      context.evalSync(`console.assert(false, "assertion failed", 123)`);
      assert.strictEqual(assertCalls.length, 1);
      assert.deepStrictEqual(assertCalls[0], {
        condition: false,
        args: ["assertion failed", 123],
      });
    });

    test("console.assert with undefined condition calls handler", async () => {
      const assertCalls: Array<{ condition: boolean; args: unknown[] }> = [];
      await setupConsole(context, {
        onAssert: (condition, ...args) =>
          assertCalls.push({ condition, args }),
      });
      context.evalSync(`console.assert(undefined)`);
      assert.strictEqual(assertCalls.length, 1);
    });

    test("console.assert with 0 calls handler", async () => {
      const assertCalls: Array<{ condition: boolean; args: unknown[] }> = [];
      await setupConsole(context, {
        onAssert: (condition, ...args) =>
          assertCalls.push({ condition, args }),
      });
      context.evalSync(`console.assert(0)`);
      assert.strictEqual(assertCalls.length, 1);
    });

    test("console.assert with empty string calls handler", async () => {
      const assertCalls: Array<{ condition: boolean; args: unknown[] }> = [];
      await setupConsole(context, {
        onAssert: (condition, ...args) =>
          assertCalls.push({ condition, args }),
      });
      context.evalSync(`console.assert("")`);
      assert.strictEqual(assertCalls.length, 1);
    });

    test("console.assert with null calls handler", async () => {
      const assertCalls: Array<{ condition: boolean; args: unknown[] }> = [];
      await setupConsole(context, {
        onAssert: (condition, ...args) =>
          assertCalls.push({ condition, args }),
      });
      context.evalSync(`console.assert(null)`);
      assert.strictEqual(assertCalls.length, 1);
    });
  });

  describe("handle methods", () => {
    test("reset() clears all state", async () => {
      const handle = await setupConsole(context);
      context.evalSync(`
        console.time("timer");
        console.count("counter");
        console.group("group");
      `);

      assert.strictEqual(handle.getTimers().size, 1);
      assert.strictEqual(handle.getCounters().size, 1);
      assert.strictEqual(handle.getGroupDepth(), 1);

      handle.reset();

      assert.strictEqual(handle.getTimers().size, 0);
      assert.strictEqual(handle.getCounters().size, 0);
      assert.strictEqual(handle.getGroupDepth(), 0);
    });

    test("getTimers returns a copy", async () => {
      const handle = await setupConsole(context);
      context.evalSync(`console.time("test")`);
      const timers1 = handle.getTimers();
      const timers2 = handle.getTimers();
      assert.notStrictEqual(timers1, timers2);
      assert.deepStrictEqual([...timers1.keys()], [...timers2.keys()]);
    });

    test("getCounters returns a copy", async () => {
      const handle = await setupConsole(context);
      context.evalSync(`console.count("test")`);
      const counters1 = handle.getCounters();
      const counters2 = handle.getCounters();
      assert.notStrictEqual(counters1, counters2);
      assert.deepStrictEqual(counters1, counters2);
    });
  });

  describe("no handlers", () => {
    test("works without handlers", async () => {
      // Create a new context without handlers
      const testIsolate = new ivm.Isolate();
      const testContext = await testIsolate.createContext();

      const h = await setupConsole(testContext); // No handlers

      const result = testContext.evalSync(`
        console.log("test");
        console.time("t");
        console.timeEnd("t");
        console.count("c");
        console.countReset("c");
        console.clear();
        console.assert(false);
        console.group("g");
        console.groupEnd();
        "done"
      `);

      assert.strictEqual(result, "done");

      h.dispose();
      testContext.release();
      testIsolate.dispose();
    });
  });
});
