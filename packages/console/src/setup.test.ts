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

  test("console.log calls onLog with correct level", async () => {
    // TODO: Implement test
    // const logCalls: Array<{ level: string; args: unknown[] }> = [];
    // await setupConsole(context, {
    //   onLog: (level, ...args) => logCalls.push({ level, args })
    // });
    // await context.eval(`console.log("hello", 123)`);
    // assert.strictEqual(logCalls.length, 1);
    // assert.strictEqual(logCalls[0].level, "log");
  });

  test("console.warn calls onLog with warn level", async () => {
    // TODO: Implement test
  });

  test("console.error calls onLog with error level", async () => {
    // TODO: Implement test
  });

  test("console.info calls onLog with info level", async () => {
    // TODO: Implement test
  });

  test("console.debug calls onLog with debug level", async () => {
    // TODO: Implement test
  });

  test("console methods handle multiple arguments", async () => {
    // TODO: Implement test
  });

  test("console methods handle objects and arrays", async () => {
    // TODO: Implement test
  });
});
