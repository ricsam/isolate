import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import ivm from "isolated-vm";
import { setupConsole } from "./index.ts";

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
      // TODO: Implement test
      // const logCalls: Array<{ level: string; args: unknown[] }> = [];
      // await setupConsole(context, {
      //   onLog: (level, ...args) => logCalls.push({ level, args })
      // });
      // await context.eval(`console.log("hello", 123)`);
      // assert.strictEqual(logCalls.length, 1);
      // assert.strictEqual(logCalls[0].level, "log");
      // assert.deepStrictEqual(logCalls[0].args, ["hello", 123]);
    });

    test("console.warn calls onLog with warn level", async () => {
      // TODO: Implement test
      // evalCode(`console.warn("warning")`);
      // assert.strictEqual(logCalls.length, 1);
      // assert.strictEqual(logCalls[0].level, "warn");
      // assert.deepStrictEqual(logCalls[0].args, ["warning"]);
    });

    test("console.error calls onLog with error level", async () => {
      // TODO: Implement test
      // evalCode(`console.error("error message")`);
      // assert.strictEqual(logCalls.length, 1);
      // assert.strictEqual(logCalls[0].level, "error");
      // assert.deepStrictEqual(logCalls[0].args, ["error message"]);
    });

    test("console.debug calls onLog with debug level", async () => {
      // TODO: Implement test
      // evalCode(`console.debug("debug info")`);
      // assert.strictEqual(logCalls.length, 1);
      // assert.strictEqual(logCalls[0].level, "debug");
    });

    test("console.info calls onLog with info level", async () => {
      // TODO: Implement test
      // evalCode(`console.info("information")`);
      // assert.strictEqual(logCalls.length, 1);
      // assert.strictEqual(logCalls[0].level, "info");
    });

    test("console.trace calls onLog with trace level", async () => {
      // TODO: Implement test
      // evalCode(`console.trace("trace")`);
      // assert.strictEqual(logCalls.length, 1);
      // assert.strictEqual(logCalls[0].level, "trace");
    });

    test("console.dir calls onLog with dir level", async () => {
      // TODO: Implement test
      // evalCode(`console.dir({ key: "value" })`);
      // assert.strictEqual(logCalls.length, 1);
      // assert.strictEqual(logCalls[0].level, "dir");
      // assert.deepStrictEqual(logCalls[0].args, [{ key: "value" }]);
    });

    test("console.table calls onLog with table level", async () => {
      // TODO: Implement test
      // evalCode(`console.table([1, 2, 3])`);
      // assert.strictEqual(logCalls.length, 1);
      // assert.strictEqual(logCalls[0].level, "table");
      // assert.deepStrictEqual(logCalls[0].args, [[1, 2, 3]]);
    });

    test("console.log with no arguments", async () => {
      // TODO: Implement test
      // evalCode(`console.log()`);
      // assert.strictEqual(logCalls.length, 1);
      // assert.deepStrictEqual(logCalls[0].args, []);
    });

    test("console.log with multiple arguments", async () => {
      // TODO: Implement test
      // evalCode(`console.log("a", "b", "c", 1, 2, 3)`);
      // assert.strictEqual(logCalls.length, 1);
      // assert.deepStrictEqual(logCalls[0].args, ["a", "b", "c", 1, 2, 3]);
    });
  });

  describe("timing methods", () => {
    test("console.time starts a timer", async () => {
      // TODO: Implement test
      // evalCode(`console.time("test")`);
      // assert.strictEqual(handle.getTimers().has("test"), true);
    });

    test("console.time uses default label", async () => {
      // TODO: Implement test
      // evalCode(`console.time()`);
      // assert.strictEqual(handle.getTimers().has("default"), true);
    });

    test("console.timeEnd reports duration", async () => {
      // TODO: Implement test
      // evalCode(`console.time("test")`);
      // await new Promise((resolve) => setTimeout(resolve, 10));
      // evalCode(`console.timeEnd("test")`);
      //
      // assert.strictEqual(timeCalls.length, 1);
      // assert.strictEqual(timeCalls[0].label, "test");
      // assert.ok(timeCalls[0].duration >= 0);
      // assert.strictEqual(handle.getTimers().has("test"), false);
    });

    test("console.timeEnd with default label", async () => {
      // TODO: Implement test
      // evalCode(`console.time()`);
      // await new Promise((resolve) => setTimeout(resolve, 5));
      // evalCode(`console.timeEnd()`);
      //
      // assert.strictEqual(timeCalls.length, 1);
      // assert.strictEqual(timeCalls[0].label, "default");
    });

    test("console.timeEnd with non-existent timer is no-op", async () => {
      // TODO: Implement test
      // evalCode(`console.timeEnd("nonexistent")`);
      // assert.strictEqual(timeCalls.length, 0);
    });

    test("console.timeLog reports duration without ending", async () => {
      // TODO: Implement test
      // evalCode(`console.time("test")`);
      // await new Promise((resolve) => setTimeout(resolve, 5));
      // evalCode(`console.timeLog("test", "additional", "args")`);
      //
      // assert.strictEqual(timeLogCalls.length, 1);
      // assert.strictEqual(timeLogCalls[0].label, "test");
      // assert.deepStrictEqual(timeLogCalls[0].args, ["additional", "args"]);
      // assert.strictEqual(handle.getTimers().has("test"), true); // Timer still running
    });

    test("console.timeLog with non-existent timer is no-op", async () => {
      // TODO: Implement test
      // evalCode(`console.timeLog("nonexistent")`);
      // assert.strictEqual(timeLogCalls.length, 0);
    });
  });

  describe("counting methods", () => {
    test("console.count increments counter", async () => {
      // TODO: Implement test
      // evalCode(`console.count("test")`);
      // assert.strictEqual(countCalls.length, 1);
      // assert.deepStrictEqual(countCalls[0], { label: "test", count: 1 });
      //
      // evalCode(`console.count("test")`);
      // assert.strictEqual(countCalls.length, 2);
      // assert.deepStrictEqual(countCalls[1], { label: "test", count: 2 });
    });

    test("console.count uses default label", async () => {
      // TODO: Implement test
      // evalCode(`console.count()`);
      // assert.strictEqual(countCalls[0].label, "default");
    });

    test("console.countReset clears counter", async () => {
      // TODO: Implement test
      // evalCode(`console.count("test")`);
      // evalCode(`console.count("test")`);
      // evalCode(`console.countReset("test")`);
      //
      // assert.deepStrictEqual(countResetCalls, ["test"]);
      // assert.strictEqual(handle.getCounters().has("test"), false);
      //
      // // After reset, count starts from 1 again
      // evalCode(`console.count("test")`);
      // assert.deepStrictEqual(countCalls[countCalls.length - 1], { label: "test", count: 1 });
    });

    test("console.countReset with default label", async () => {
      // TODO: Implement test
      // evalCode(`console.count()`);
      // evalCode(`console.countReset()`);
      // assert.deepStrictEqual(countResetCalls, ["default"]);
    });

    test("console.countReset with non-existent counter still calls handler", async () => {
      // TODO: Implement test
      // evalCode(`console.countReset("nonexistent")`);
      // assert.deepStrictEqual(countResetCalls, ["nonexistent"]);
    });

    test("getCounters returns correct state", async () => {
      // TODO: Implement test
      // evalCode(`console.count("a")`);
      // evalCode(`console.count("a")`);
      // evalCode(`console.count("b")`);
      //
      // const counters = handle.getCounters();
      // assert.strictEqual(counters.get("a"), 2);
      // assert.strictEqual(counters.get("b"), 1);
    });
  });

  describe("grouping methods", () => {
    test("console.group increments depth", async () => {
      // TODO: Implement test
      // assert.strictEqual(handle.getGroupDepth(), 0);
      // evalCode(`console.group("Group 1")`);
      // assert.strictEqual(handle.getGroupDepth(), 1);
      // assert.deepStrictEqual(groupCalls[0], { label: "Group 1", collapsed: false });
    });

    test("console.groupCollapsed increments depth with collapsed flag", async () => {
      // TODO: Implement test
      // evalCode(`console.groupCollapsed("Collapsed Group")`);
      // assert.strictEqual(handle.getGroupDepth(), 1);
      // assert.deepStrictEqual(groupCalls[0], { label: "Collapsed Group", collapsed: true });
    });

    test("console.group uses default label", async () => {
      // TODO: Implement test
      // evalCode(`console.group()`);
      // assert.strictEqual(groupCalls[0].label, "default");
    });

    test("console.groupEnd decrements depth", async () => {
      // TODO: Implement test
      // evalCode(`console.group()`);
      // evalCode(`console.group()`);
      // assert.strictEqual(handle.getGroupDepth(), 2);
      //
      // evalCode(`console.groupEnd()`);
      // assert.strictEqual(handle.getGroupDepth(), 1);
      // assert.strictEqual(groupEndCalls, 1);
    });

    test("console.groupEnd at depth 0 stays at 0", async () => {
      // TODO: Implement test
      // evalCode(`console.groupEnd()`);
      // assert.strictEqual(handle.getGroupDepth(), 0);
      // assert.strictEqual(groupEndCalls, 1); // Handler still called
    });

    test("nested groups track depth correctly", async () => {
      // TODO: Implement test
      // evalCode(`
      //   console.group("Level 1");
      //   console.group("Level 2");
      //   console.group("Level 3");
      // `);
      // assert.strictEqual(handle.getGroupDepth(), 3);
      //
      // evalCode(`
      //   console.groupEnd();
      //   console.groupEnd();
      // `);
      // assert.strictEqual(handle.getGroupDepth(), 1);
    });
  });

  describe("other methods", () => {
    test("console.clear calls onClear", async () => {
      // TODO: Implement test
      // evalCode(`console.clear()`);
      // assert.strictEqual(clearCalls, 1);
    });

    test("console.assert with truthy condition does not call handler", async () => {
      // TODO: Implement test
      // evalCode(`console.assert(true, "should not appear")`);
      // assert.strictEqual(assertCalls.length, 0);
    });

    test("console.assert with falsy condition calls handler", async () => {
      // TODO: Implement test
      // evalCode(`console.assert(false, "assertion failed", 123)`);
      // assert.strictEqual(assertCalls.length, 1);
      // assert.deepStrictEqual(assertCalls[0], { assertion: false, args: ["assertion failed", 123] });
    });

    test("console.assert with undefined condition calls handler", async () => {
      // TODO: Implement test
      // evalCode(`console.assert(undefined)`);
      // assert.strictEqual(assertCalls.length, 1);
    });

    test("console.assert with 0 calls handler", async () => {
      // TODO: Implement test
      // evalCode(`console.assert(0)`);
      // assert.strictEqual(assertCalls.length, 1);
    });

    test("console.assert with empty string calls handler", async () => {
      // TODO: Implement test
      // evalCode(`console.assert("")`);
      // assert.strictEqual(assertCalls.length, 1);
    });

    test("console.assert with null calls handler", async () => {
      // TODO: Implement test
      // evalCode(`console.assert(null)`);
      // assert.strictEqual(assertCalls.length, 1);
    });
  });

  describe("handle methods", () => {
    test("reset() clears all state", async () => {
      // TODO: Implement test
      // evalCode(`
      //   console.time("timer");
      //   console.count("counter");
      //   console.group("group");
      // `);
      //
      // assert.strictEqual(handle.getTimers().size, 1);
      // assert.strictEqual(handle.getCounters().size, 1);
      // assert.strictEqual(handle.getGroupDepth(), 1);
      //
      // handle.reset();
      //
      // assert.strictEqual(handle.getTimers().size, 0);
      // assert.strictEqual(handle.getCounters().size, 0);
      // assert.strictEqual(handle.getGroupDepth(), 0);
    });

    test("getTimers returns a copy", async () => {
      // TODO: Implement test
      // evalCode(`console.time("test")`);
      // const timers1 = handle.getTimers();
      // const timers2 = handle.getTimers();
      // assert.notStrictEqual(timers1, timers2);
      // assert.deepStrictEqual(timers1, timers2);
    });

    test("getCounters returns a copy", async () => {
      // TODO: Implement test
      // evalCode(`console.count("test")`);
      // const counters1 = handle.getCounters();
      // const counters2 = handle.getCounters();
      // assert.notStrictEqual(counters1, counters2);
      // assert.deepStrictEqual(counters1, counters2);
    });
  });

  describe("no handlers", () => {
    test("works without handlers", async () => {
      // TODO: Implement test
      // // Create a new context without handlers
      // const testIsolate = new ivm.Isolate();
      // const testContext = await testIsolate.createContext();
      //
      // const h = setupConsole(testContext); // No handlers
      //
      // const result = await testContext.eval(`
      //   console.log("test");
      //   console.time("t");
      //   console.timeEnd("t");
      //   console.count("c");
      //   console.countReset("c");
      //   console.clear();
      //   console.assert(false);
      //   console.group("g");
      //   console.groupEnd();
      //   "done"
      // `);
      //
      // assert.strictEqual(result, "done");
      //
      // h.dispose();
      // testContext.release();
      // testIsolate.dispose();
    });
  });
});
