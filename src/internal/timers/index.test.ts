import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import ivm from "@ricsam/isolated-vm";
import { setupTimers, type TimersHandle } from "./index.ts";

describe("isolate timers", () => {
  let isolate: ivm.Isolate;
  let context: ivm.Context;
  let timers: TimersHandle;

  before(async () => {
    isolate = new ivm.Isolate();
    context = await isolate.createContext();
    timers = await setupTimers(context);
  });

  after(() => {
    timers.dispose();
    context.release();
    isolate.dispose();
  });

  const read = <T>(expression: string): T =>
    JSON.parse(context.evalSync(`JSON.stringify(${expression})`) as string) as T;

  test("runs timeouts with arguments and intervals until they are cleared", async () => {
    context.evalSync(`
      globalThis.events = [];
      setTimeout((a, b) => events.push("timeout " + a + b), 5, "x", "y");
      const cancelled = setTimeout(() => events.push("cancelled"), 5);
      clearTimeout(cancelled);
      let ticks = 0;
      const interval = setInterval(() => {
        ticks += 1;
        events.push("tick " + ticks);
        if (ticks === 3) clearInterval(interval);
      }, 2);
    `);
    await delay(80);
    const events = read<string[]>("events");
    assert.deepEqual(events.filter((event) => !event.startsWith("tick")), ["timeout xy"]);
    assert.deepEqual(events.filter((event) => event.startsWith("tick")), ["tick 1", "tick 2", "tick 3"]);
  });

  test("a timer that fires before setTimeout() returns still runs exactly once", async () => {
    // isolated-vm unlocks the isolate while it runs a host callback, so the
    // host may fire a short timer before the isolate code that registered it
    // continues. Simulate that by firing it from inside the registration.
    context.evalSync(`
      globalThis.fired = 0;
      const register = __timers_registerTimeout;
      __timers_registerTimeout = (id, ms) => {
        register(id, ms);
        __timers_execute(id);
        __timers_removeCallback(id);
      };
      try {
        setTimeout(() => {
          fired += 1;
        }, 1);
      } finally {
        __timers_registerTimeout = register;
      }
    `);
    await delay(30);
    assert.equal(read<number>("fired"), 1);
  });

  test("the host rejects invalid timer ids", () => {
    assert.throws(
      () => context.evalSync(`__timers_registerTimeout(-1, 10)`),
      /Invalid timer id/,
    );
  });
});
