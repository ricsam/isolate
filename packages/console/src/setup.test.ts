import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import ivm from "isolated-vm";
import { setupConsole, type ConsoleEntry } from "./index.ts";
import { simpleConsoleHandler } from "./utils.ts";

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

  describe("output entry types", () => {
    test("console.log emits output entry with log level", async () => {
      const entries: ConsoleEntry[] = [];
      await setupConsole(context, {
        onEntry: (entry) => entries.push(entry),
      });
      context.evalSync(`console.log("hello", 123)`);
      assert.strictEqual(entries.length, 1);
      assert.strictEqual(entries[0]!.type, "output");
      if (entries[0]!.type === "output") {
        assert.strictEqual(entries[0]!.level, "log");
        assert.strictEqual(entries[0]!.stdout, "hello 123");
        assert.strictEqual(entries[0]!.groupDepth, 0);
      }
    });

    test("console.warn emits output entry with warn level", async () => {
      const entries: ConsoleEntry[] = [];
      await setupConsole(context, {
        onEntry: (entry) => entries.push(entry),
      });
      context.evalSync(`console.warn("warning")`);
      assert.strictEqual(entries.length, 1);
      assert.strictEqual(entries[0]!.type, "output");
      if (entries[0]!.type === "output") {
        assert.strictEqual(entries[0]!.level, "warn");
        assert.strictEqual(entries[0]!.stdout, "warning");
      }
    });

    test("console.error emits output entry with error level", async () => {
      const entries: ConsoleEntry[] = [];
      await setupConsole(context, {
        onEntry: (entry) => entries.push(entry),
      });
      context.evalSync(`console.error("error message")`);
      assert.strictEqual(entries.length, 1);
      assert.strictEqual(entries[0]!.type, "output");
      if (entries[0]!.type === "output") {
        assert.strictEqual(entries[0]!.level, "error");
        assert.strictEqual(entries[0]!.stdout, "error message");
      }
    });

    test("console.debug emits output entry with debug level", async () => {
      const entries: ConsoleEntry[] = [];
      await setupConsole(context, {
        onEntry: (entry) => entries.push(entry),
      });
      context.evalSync(`console.debug("debug info")`);
      assert.strictEqual(entries.length, 1);
      assert.strictEqual(entries[0]!.type, "output");
      if (entries[0]!.type === "output") {
        assert.strictEqual(entries[0]!.level, "debug");
      }
    });

    test("console.info emits output entry with info level", async () => {
      const entries: ConsoleEntry[] = [];
      await setupConsole(context, {
        onEntry: (entry) => entries.push(entry),
      });
      context.evalSync(`console.info("information")`);
      assert.strictEqual(entries.length, 1);
      assert.strictEqual(entries[0]!.type, "output");
      if (entries[0]!.type === "output") {
        assert.strictEqual(entries[0]!.level, "info");
      }
    });

    test("console.log with no arguments", async () => {
      const entries: ConsoleEntry[] = [];
      await setupConsole(context, {
        onEntry: (entry) => entries.push(entry),
      });
      context.evalSync(`console.log()`);
      assert.strictEqual(entries.length, 1);
      if (entries[0]!.type === "output") {
        assert.strictEqual(entries[0]!.stdout, "");
      }
    });

    test("console.log with multiple arguments", async () => {
      const entries: ConsoleEntry[] = [];
      await setupConsole(context, {
        onEntry: (entry) => entries.push(entry),
      });
      context.evalSync(`console.log("a", "b", "c", 1, 2, 3)`);
      assert.strictEqual(entries.length, 1);
      if (entries[0]!.type === "output") {
        assert.strictEqual(entries[0]!.stdout, "a b c 1 2 3");
      }
    });

    test("console.log with circular reference", async () => {
      const entries: ConsoleEntry[] = [];
      await setupConsole(context, {
        onEntry: (entry) => entries.push(entry),
      });
      context.evalSync(`
        const obj = { name: "test" };
        obj.self = obj;
        console.log(obj);
      `);
      assert.strictEqual(entries.length, 1);
      if (entries[0]!.type === "output") {
        assert.strictEqual(entries[0]!.stdout, "{ name: 'test', self: [Circular] }");
      }
    });

    test("console.log with nested circular reference", async () => {
      const entries: ConsoleEntry[] = [];
      await setupConsole(context, {
        onEntry: (entry) => entries.push(entry),
      });
      context.evalSync(`
        const a = { name: "a" };
        const b = { name: "b", ref: a };
        a.ref = b;
        console.log(a);
      `);
      assert.strictEqual(entries.length, 1);
      if (entries[0]!.type === "output") {
        // a -> b -> a (circular)
        assert.strictEqual(entries[0]!.stdout, "{ name: 'a', ref: { name: 'b', ref: [Circular] } }");
      }
    });

    test("console.log with circular array", async () => {
      const entries: ConsoleEntry[] = [];
      await setupConsole(context, {
        onEntry: (entry) => entries.push(entry),
      });
      context.evalSync(`
        const arr = [1, 2];
        arr.push(arr);
        console.log(arr);
      `);
      assert.strictEqual(entries.length, 1);
      if (entries[0]!.type === "output") {
        assert.strictEqual(entries[0]!.stdout, "[ 1, 2, [Circular] ]");
      }
    });

    test("console.log with named function", async () => {
      const entries: ConsoleEntry[] = [];
      await setupConsole(context, {
        onEntry: (entry) => entries.push(entry),
      });
      context.evalSync(`
        function myFunction() { return 42; }
        console.log(myFunction);
      `);
      assert.strictEqual(entries.length, 1);
      if (entries[0]!.type === "output") {
        assert.strictEqual(entries[0]!.stdout, "[Function: myFunction]");
      }
    });

    test("console.log with anonymous function", async () => {
      const entries: ConsoleEntry[] = [];
      await setupConsole(context, {
        onEntry: (entry) => entries.push(entry),
      });
      context.evalSync(`console.log(function() {})`);
      assert.strictEqual(entries.length, 1);
      if (entries[0]!.type === "output") {
        assert.strictEqual(entries[0]!.stdout, "[Function: (anonymous)]");
      }
    });

    test("console.log with arrow function", async () => {
      const entries: ConsoleEntry[] = [];
      await setupConsole(context, {
        onEntry: (entry) => entries.push(entry),
      });
      context.evalSync(`
        const arrowFn = () => {};
        console.log(arrowFn);
      `);
      assert.strictEqual(entries.length, 1);
      if (entries[0]!.type === "output") {
        assert.strictEqual(entries[0]!.stdout, "[Function: arrowFn]");
      }
    });

    test("console.log with Symbol", async () => {
      const entries: ConsoleEntry[] = [];
      await setupConsole(context, {
        onEntry: (entry) => entries.push(entry),
      });
      context.evalSync(`console.log(Symbol("mySymbol"))`);
      assert.strictEqual(entries.length, 1);
      if (entries[0]!.type === "output") {
        assert.strictEqual(entries[0]!.stdout, "Symbol(mySymbol)");
      }
    });

    test("console.log with Promise", async () => {
      const entries: ConsoleEntry[] = [];
      await setupConsole(context, {
        onEntry: (entry) => entries.push(entry),
      });
      context.evalSync(`console.log(Promise.resolve(42))`);
      assert.strictEqual(entries.length, 1);
      if (entries[0]!.type === "output") {
        assert.strictEqual(entries[0]!.stdout, "Promise { <pending> }");
      }
    });

    test("console.log with Map", async () => {
      const entries: ConsoleEntry[] = [];
      await setupConsole(context, {
        onEntry: (entry) => entries.push(entry),
      });
      context.evalSync(`console.log(new Map([["a", 1], ["b", 2]]))`);
      assert.strictEqual(entries.length, 1);
      if (entries[0]!.type === "output") {
        assert.strictEqual(entries[0]!.stdout, "Map(2) { 'a' => 1, 'b' => 2 }");
      }
    });

    test("console.log with Set", async () => {
      const entries: ConsoleEntry[] = [];
      await setupConsole(context, {
        onEntry: (entry) => entries.push(entry),
      });
      context.evalSync(`console.log(new Set([1, 2, 3]))`);
      assert.strictEqual(entries.length, 1);
      if (entries[0]!.type === "output") {
        assert.strictEqual(entries[0]!.stdout, "Set(3) { 1, 2, 3 }");
      }
    });

    test("console.log with Date", async () => {
      const entries: ConsoleEntry[] = [];
      await setupConsole(context, {
        onEntry: (entry) => entries.push(entry),
      });
      context.evalSync(`console.log(new Date("2024-01-15T10:30:00.000Z"))`);
      assert.strictEqual(entries.length, 1);
      if (entries[0]!.type === "output") {
        assert.strictEqual(entries[0]!.stdout, "2024-01-15T10:30:00.000Z");
      }
    });

    test("console.log with RegExp", async () => {
      const entries: ConsoleEntry[] = [];
      await setupConsole(context, {
        onEntry: (entry) => entries.push(entry),
      });
      context.evalSync(`console.log(/test.*pattern/gi)`);
      assert.strictEqual(entries.length, 1);
      if (entries[0]!.type === "output") {
        assert.strictEqual(entries[0]!.stdout, "/test.*pattern/gi");
      }
    });

    test("console.log with Error", async () => {
      const entries: ConsoleEntry[] = [];
      await setupConsole(context, {
        onEntry: (entry) => entries.push(entry),
      });
      context.evalSync(`console.log(new Error("something went wrong"))`);
      assert.strictEqual(entries.length, 1);
      if (entries[0]!.type === "output") {
        assert.ok(entries[0]!.stdout.startsWith("Error: something went wrong"));
        // Should include stack trace
        assert.ok(entries[0]!.stdout.includes("at"));
      }
    });

    test("console.log with TypeError", async () => {
      const entries: ConsoleEntry[] = [];
      await setupConsole(context, {
        onEntry: (entry) => entries.push(entry),
      });
      context.evalSync(`console.log(new TypeError("not a number"))`);
      assert.strictEqual(entries.length, 1);
      if (entries[0]!.type === "output") {
        assert.ok(entries[0]!.stdout.startsWith("TypeError: not a number"));
      }
    });

    test("console.log with object containing function", async () => {
      const entries: ConsoleEntry[] = [];
      await setupConsole(context, {
        onEntry: (entry) => entries.push(entry),
      });
      context.evalSync(`
        const obj = {
          name: "test",
          callback: function handler() {}
        };
        console.log(obj);
      `);
      assert.strictEqual(entries.length, 1);
      if (entries[0]!.type === "output") {
        assert.strictEqual(entries[0]!.stdout, "{ name: 'test', callback: [Function: handler] }");
      }
    });

    test("console.log with bigint", async () => {
      const entries: ConsoleEntry[] = [];
      await setupConsole(context, {
        onEntry: (entry) => entries.push(entry),
      });
      context.evalSync(`console.log(9007199254740991n)`);
      assert.strictEqual(entries.length, 1);
      if (entries[0]!.type === "output") {
        assert.strictEqual(entries[0]!.stdout, "9007199254740991n");
      }
    });

    test("console.log with Uint8Array", async () => {
      const entries: ConsoleEntry[] = [];
      await setupConsole(context, {
        onEntry: (entry) => entries.push(entry),
      });
      context.evalSync(`console.log(new Uint8Array([1, 2, 3]))`);
      assert.strictEqual(entries.length, 1);
      if (entries[0]!.type === "output") {
        assert.strictEqual(entries[0]!.stdout, "Uint8Array(3) [ 1, 2, 3 ]");
      }
    });

    test("console.log with ArrayBuffer", async () => {
      const entries: ConsoleEntry[] = [];
      await setupConsole(context, {
        onEntry: (entry) => entries.push(entry),
      });
      context.evalSync(`console.log(new ArrayBuffer(16))`);
      assert.strictEqual(entries.length, 1);
      if (entries[0]!.type === "output") {
        assert.strictEqual(entries[0]!.stdout, "ArrayBuffer { byteLength: 16 }");
      }
    });
  });

  describe("dir entry type", () => {
    test("console.dir emits dir entry", async () => {
      const entries: ConsoleEntry[] = [];
      await setupConsole(context, {
        onEntry: (entry) => entries.push(entry),
      });
      context.evalSync(`console.dir({ key: "value" })`);
      assert.strictEqual(entries.length, 1);
      assert.strictEqual(entries[0]!.type, "dir");
      if (entries[0]!.type === "dir") {
        assert.strictEqual(entries[0]!.stdout, "{ key: 'value' }");
        assert.strictEqual(entries[0]!.groupDepth, 0);
      }
    });
  });

  describe("table entry type", () => {
    test("console.table emits table entry", async () => {
      const entries: ConsoleEntry[] = [];
      await setupConsole(context, {
        onEntry: (entry) => entries.push(entry),
      });
      context.evalSync(`console.table([1, 2, 3])`);
      assert.strictEqual(entries.length, 1);
      assert.strictEqual(entries[0]!.type, "table");
      if (entries[0]!.type === "table") {
        // Table is now formatted as ASCII table
        assert.ok(entries[0]!.stdout.includes("(index)"));
        assert.ok(entries[0]!.stdout.includes("Values"));
        assert.strictEqual(entries[0]!.groupDepth, 0);
      }
    });

    test("console.table with columns", async () => {
      const entries: ConsoleEntry[] = [];
      await setupConsole(context, {
        onEntry: (entry) => entries.push(entry),
      });
      context.evalSync(
        `console.table([{a: 1, b: 2}, {a: 3, b: 4}], ["a", "b"])`
      );
      assert.strictEqual(entries.length, 1);
      assert.strictEqual(entries[0]!.type, "table");
      if (entries[0]!.type === "table") {
        // Table is now formatted as ASCII table with specified columns
        assert.ok(entries[0]!.stdout.includes("a"));
        assert.ok(entries[0]!.stdout.includes("b"));
      }
    });
  });

  describe("trace entry type", () => {
    test("console.trace emits trace entry with stack", async () => {
      const entries: ConsoleEntry[] = [];
      await setupConsole(context, {
        onEntry: (entry) => entries.push(entry),
      });
      context.evalSync(`console.trace("trace message")`);
      assert.strictEqual(entries.length, 1);
      assert.strictEqual(entries[0]!.type, "trace");
      if (entries[0]!.type === "trace") {
        assert.strictEqual(entries[0]!.stdout, "trace message");
        assert.ok(typeof entries[0]!.stack === "string");
        assert.ok(entries[0]!.stack.includes("Trace: trace message"));
        assert.strictEqual(entries[0]!.groupDepth, 0);
      }
    });
  });

  describe("timing entry types", () => {
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

    test("console.timeEnd emits time entry", async () => {
      const entries: ConsoleEntry[] = [];
      const handle = await setupConsole(context, {
        onEntry: (entry) => entries.push(entry),
      });
      context.evalSync(`console.time("test")`);
      await new Promise((resolve) => setTimeout(resolve, 10));
      context.evalSync(`console.timeEnd("test")`);

      assert.strictEqual(entries.length, 1);
      assert.strictEqual(entries[0]!.type, "time");
      if (entries[0]!.type === "time") {
        assert.strictEqual(entries[0]!.label, "test");
        assert.ok(entries[0]!.duration >= 0);
        assert.strictEqual(entries[0]!.groupDepth, 0);
      }
      assert.strictEqual(handle.getTimers().has("test"), false);
    });

    test("console.timeEnd with default label", async () => {
      const entries: ConsoleEntry[] = [];
      await setupConsole(context, {
        onEntry: (entry) => entries.push(entry),
      });
      context.evalSync(`console.time()`);
      await new Promise((resolve) => setTimeout(resolve, 5));
      context.evalSync(`console.timeEnd()`);

      assert.strictEqual(entries.length, 1);
      if (entries[0]!.type === "time") {
        assert.strictEqual(entries[0]!.label, "default");
      }
    });

    test("console.timeEnd with non-existent timer is no-op", async () => {
      const entries: ConsoleEntry[] = [];
      await setupConsole(context, {
        onEntry: (entry) => entries.push(entry),
      });
      context.evalSync(`console.timeEnd("nonexistent")`);
      assert.strictEqual(entries.length, 0);
    });

    test("console.timeLog emits timeLog entry without ending timer", async () => {
      const entries: ConsoleEntry[] = [];
      const handle = await setupConsole(context, {
        onEntry: (entry) => entries.push(entry),
      });
      context.evalSync(`console.time("test")`);
      await new Promise((resolve) => setTimeout(resolve, 5));
      context.evalSync(`console.timeLog("test", "additional", "args")`);

      assert.strictEqual(entries.length, 1);
      assert.strictEqual(entries[0]!.type, "timeLog");
      if (entries[0]!.type === "timeLog") {
        assert.strictEqual(entries[0]!.label, "test");
        assert.strictEqual(entries[0]!.stdout, "additional args");
        assert.ok(entries[0]!.duration >= 0);
      }
      assert.strictEqual(handle.getTimers().has("test"), true); // Timer still running
    });

    test("console.timeLog with non-existent timer is no-op", async () => {
      const entries: ConsoleEntry[] = [];
      await setupConsole(context, {
        onEntry: (entry) => entries.push(entry),
      });
      context.evalSync(`console.timeLog("nonexistent")`);
      assert.strictEqual(entries.length, 0);
    });
  });

  describe("count entry types", () => {
    test("console.count emits count entry", async () => {
      const entries: ConsoleEntry[] = [];
      await setupConsole(context, {
        onEntry: (entry) => entries.push(entry),
      });
      context.evalSync(`console.count("test")`);
      assert.strictEqual(entries.length, 1);
      assert.strictEqual(entries[0]!.type, "count");
      if (entries[0]!.type === "count") {
        assert.strictEqual(entries[0]!.label, "test");
        assert.strictEqual(entries[0]!.count, 1);
        assert.strictEqual(entries[0]!.groupDepth, 0);
      }

      context.evalSync(`console.count("test")`);
      assert.strictEqual(entries.length, 2);
      if (entries[1]!.type === "count") {
        assert.strictEqual(entries[1]!.count, 2);
      }
    });

    test("console.count uses default label", async () => {
      const entries: ConsoleEntry[] = [];
      await setupConsole(context, {
        onEntry: (entry) => entries.push(entry),
      });
      context.evalSync(`console.count()`);
      if (entries[0]!.type === "count") {
        assert.strictEqual(entries[0]!.label, "default");
      }
    });

    test("console.countReset emits countReset entry", async () => {
      const entries: ConsoleEntry[] = [];
      const handle = await setupConsole(context, {
        onEntry: (entry) => entries.push(entry),
      });
      context.evalSync(`console.count("test")`);
      context.evalSync(`console.count("test")`);
      context.evalSync(`console.countReset("test")`);

      assert.strictEqual(entries.length, 3);
      assert.strictEqual(entries[2]!.type, "countReset");
      if (entries[2]!.type === "countReset") {
        assert.strictEqual(entries[2]!.label, "test");
        assert.strictEqual(entries[2]!.groupDepth, 0);
      }
      assert.strictEqual(handle.getCounters().has("test"), false);

      // After reset, count starts from 1 again
      context.evalSync(`console.count("test")`);
      if (entries[3]!.type === "count") {
        assert.strictEqual(entries[3]!.count, 1);
      }
    });

    test("console.countReset with default label", async () => {
      const entries: ConsoleEntry[] = [];
      await setupConsole(context, {
        onEntry: (entry) => entries.push(entry),
      });
      context.evalSync(`console.count()`);
      context.evalSync(`console.countReset()`);
      if (entries[1]!.type === "countReset") {
        assert.strictEqual(entries[1]!.label, "default");
      }
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

  describe("group entry types", () => {
    test("console.group emits group entry and increments depth", async () => {
      const entries: ConsoleEntry[] = [];
      const handle = await setupConsole(context, {
        onEntry: (entry) => entries.push(entry),
      });
      assert.strictEqual(handle.getGroupDepth(), 0);
      context.evalSync(`console.group("Group 1")`);
      assert.strictEqual(handle.getGroupDepth(), 1);
      assert.strictEqual(entries.length, 1);
      assert.strictEqual(entries[0]!.type, "group");
      if (entries[0]!.type === "group") {
        assert.strictEqual(entries[0]!.label, "Group 1");
        assert.strictEqual(entries[0]!.collapsed, false);
        assert.strictEqual(entries[0]!.groupDepth, 0); // Depth before increment
      }
    });

    test("console.groupCollapsed emits group entry with collapsed=true", async () => {
      const entries: ConsoleEntry[] = [];
      const handle = await setupConsole(context, {
        onEntry: (entry) => entries.push(entry),
      });
      context.evalSync(`console.groupCollapsed("Collapsed Group")`);
      assert.strictEqual(handle.getGroupDepth(), 1);
      assert.strictEqual(entries[0]!.type, "group");
      if (entries[0]!.type === "group") {
        assert.strictEqual(entries[0]!.label, "Collapsed Group");
        assert.strictEqual(entries[0]!.collapsed, true);
      }
    });

    test("console.group uses default label", async () => {
      const entries: ConsoleEntry[] = [];
      await setupConsole(context, {
        onEntry: (entry) => entries.push(entry),
      });
      context.evalSync(`console.group()`);
      if (entries[0]!.type === "group") {
        assert.strictEqual(entries[0]!.label, "default");
      }
    });

    test("console.groupEnd emits groupEnd entry and decrements depth", async () => {
      const entries: ConsoleEntry[] = [];
      const handle = await setupConsole(context, {
        onEntry: (entry) => entries.push(entry),
      });
      context.evalSync(`console.group()`);
      context.evalSync(`console.group()`);
      assert.strictEqual(handle.getGroupDepth(), 2);

      context.evalSync(`console.groupEnd()`);
      assert.strictEqual(handle.getGroupDepth(), 1);
      assert.strictEqual(entries[2]!.type, "groupEnd");
      if (entries[2]!.type === "groupEnd") {
        assert.strictEqual(entries[2]!.groupDepth, 1); // Depth after decrement
      }
    });

    test("console.groupEnd at depth 0 stays at 0", async () => {
      const entries: ConsoleEntry[] = [];
      const handle = await setupConsole(context, {
        onEntry: (entry) => entries.push(entry),
      });
      context.evalSync(`console.groupEnd()`);
      assert.strictEqual(handle.getGroupDepth(), 0);
      assert.strictEqual(entries.length, 1);
      assert.strictEqual(entries[0]!.type, "groupEnd");
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

    test("groupDepth is included in output entries", async () => {
      const entries: ConsoleEntry[] = [];
      await setupConsole(context, {
        onEntry: (entry) => entries.push(entry),
      });
      context.evalSync(`
        console.log("depth 0");
        console.group("group");
        console.log("depth 1");
        console.group("nested");
        console.log("depth 2");
      `);
      const outputEntries = entries.filter((e) => e.type === "output");
      assert.strictEqual(outputEntries.length, 3);
      assert.strictEqual(
        (outputEntries[0] as { groupDepth: number }).groupDepth,
        0
      );
      assert.strictEqual(
        (outputEntries[1] as { groupDepth: number }).groupDepth,
        1
      );
      assert.strictEqual(
        (outputEntries[2] as { groupDepth: number }).groupDepth,
        2
      );
    });
  });

  describe("clear entry type", () => {
    test("console.clear emits clear entry", async () => {
      const entries: ConsoleEntry[] = [];
      await setupConsole(context, {
        onEntry: (entry) => entries.push(entry),
      });
      context.evalSync(`console.clear()`);
      assert.strictEqual(entries.length, 1);
      assert.strictEqual(entries[0]!.type, "clear");
    });
  });

  describe("assert entry type", () => {
    test("console.assert with truthy condition does not emit", async () => {
      const entries: ConsoleEntry[] = [];
      await setupConsole(context, {
        onEntry: (entry) => entries.push(entry),
      });
      context.evalSync(`console.assert(true, "should not appear")`);
      assert.strictEqual(entries.length, 0);
    });

    test("console.assert with falsy condition emits assert entry", async () => {
      const entries: ConsoleEntry[] = [];
      await setupConsole(context, {
        onEntry: (entry) => entries.push(entry),
      });
      context.evalSync(`console.assert(false, "assertion failed", 123)`);
      assert.strictEqual(entries.length, 1);
      assert.strictEqual(entries[0]!.type, "assert");
      if (entries[0]!.type === "assert") {
        assert.strictEqual(entries[0]!.stdout, "Assertion failed: assertion failed 123");
        assert.strictEqual(entries[0]!.groupDepth, 0);
      }
    });

    test("console.assert with undefined condition emits", async () => {
      const entries: ConsoleEntry[] = [];
      await setupConsole(context, {
        onEntry: (entry) => entries.push(entry),
      });
      context.evalSync(`console.assert(undefined)`);
      assert.strictEqual(entries.length, 1);
    });

    test("console.assert with 0 emits", async () => {
      const entries: ConsoleEntry[] = [];
      await setupConsole(context, {
        onEntry: (entry) => entries.push(entry),
      });
      context.evalSync(`console.assert(0)`);
      assert.strictEqual(entries.length, 1);
    });

    test("console.assert with empty string emits", async () => {
      const entries: ConsoleEntry[] = [];
      await setupConsole(context, {
        onEntry: (entry) => entries.push(entry),
      });
      context.evalSync(`console.assert("")`);
      assert.strictEqual(entries.length, 1);
    });

    test("console.assert with null emits", async () => {
      const entries: ConsoleEntry[] = [];
      await setupConsole(context, {
        onEntry: (entry) => entries.push(entry),
      });
      context.evalSync(`console.assert(null)`);
      assert.strictEqual(entries.length, 1);
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
        console.dir({});
        console.table([1,2,3]);
        console.trace("trace");
        "done"
      `);

      assert.strictEqual(result, "done");

      h.dispose();
      testContext.release();
      testIsolate.dispose();
    });
  });

  describe("simpleConsoleHandler helper", () => {
    test("routes output entries to level callbacks", async () => {
      const logs: string[] = [];
      const warns: string[] = [];
      const errors: string[] = [];

      await setupConsole(
        context,
        simpleConsoleHandler({
          log: (msg) => logs.push(msg),
          warn: (msg) => warns.push(msg),
          error: (msg) => errors.push(msg),
        })
      );

      context.evalSync(`
        console.log("log message", 1);
        console.warn("warn message", 2);
        console.error("error message", 3);
      `);

      assert.deepStrictEqual(logs, ["log message 1"]);
      assert.deepStrictEqual(warns, ["warn message 2"]);
      assert.deepStrictEqual(errors, ["error message 3"]);
    });

    test("routes assert to error callback", async () => {
      const errors: string[] = [];

      await setupConsole(
        context,
        simpleConsoleHandler({
          error: (msg) => errors.push(msg),
        })
      );

      context.evalSync(`console.assert(false, "assertion", "args")`);

      assert.strictEqual(errors.length, 1);
      assert.strictEqual(errors[0], "Assertion failed: assertion args");
    });

    test("routes trace to log callback with stack", async () => {
      const logs: string[] = [];

      await setupConsole(
        context,
        simpleConsoleHandler({
          log: (msg) => logs.push(msg),
        })
      );

      context.evalSync(`console.trace("trace message")`);

      assert.strictEqual(logs.length, 1);
      assert.ok(logs[0]!.includes("Trace: trace message"));
    });

    test("routes dir and table to log callback", async () => {
      const logs: string[] = [];

      await setupConsole(
        context,
        simpleConsoleHandler({
          log: (msg) => logs.push(msg),
        })
      );

      context.evalSync(`
        console.dir({ key: "value" });
        console.table([1, 2, 3]);
      `);

      assert.strictEqual(logs.length, 2);
      assert.strictEqual(logs[0], "{ key: 'value' }");
      assert.ok(logs[1]!.includes("(index)"));
    });

    test("routes time and timeLog to log callback", async () => {
      const logs: string[] = [];

      await setupConsole(
        context,
        simpleConsoleHandler({
          log: (msg) => logs.push(msg),
        })
      );

      context.evalSync(`
        console.time("timer");
        console.timeLog("timer", "progress");
        console.timeEnd("timer");
      `);

      assert.strictEqual(logs.length, 2);
      assert.ok(logs[0]!.includes("timer:"));
      assert.ok(logs[0]!.includes("ms"));
      assert.ok(logs[0]!.includes("progress"));
      assert.ok(logs[1]!.includes("timer:"));
    });

    test("routes count to log callback", async () => {
      const logs: string[] = [];

      await setupConsole(
        context,
        simpleConsoleHandler({
          log: (msg) => logs.push(msg),
        })
      );

      context.evalSync(`
        console.count("clicks");
        console.count("clicks");
      `);

      assert.strictEqual(logs.length, 2);
      assert.strictEqual(logs[0], "clicks: 1");
      assert.strictEqual(logs[1], "clicks: 2");
    });

    test("silently ignores group, groupEnd, countReset, clear", async () => {
      const logs: string[] = [];

      await setupConsole(
        context,
        simpleConsoleHandler({
          log: (msg) => logs.push(msg),
        })
      );

      context.evalSync(`
        console.group("group");
        console.groupCollapsed("collapsed");
        console.groupEnd();
        console.countReset("x");
        console.clear();
      `);

      assert.strictEqual(logs.length, 0);
    });
  });
});
