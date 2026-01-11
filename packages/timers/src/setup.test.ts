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
      // TODO: Implement test
    });

    test("returns a timer ID", async () => {
      // TODO: Implement test
    });

    test("passes arguments to callback", async () => {
      // TODO: Implement test
    });
  });

  describe("clearTimeout", () => {
    test("cancels a pending timeout", async () => {
      // TODO: Implement test
    });

    test("does nothing for invalid ID", async () => {
      // TODO: Implement test
    });
  });

  describe("setInterval", () => {
    test("executes callback repeatedly", async () => {
      // TODO: Implement test
    });

    test("returns a timer ID", async () => {
      // TODO: Implement test
    });
  });

  describe("clearInterval", () => {
    test("stops an interval", async () => {
      // TODO: Implement test
    });
  });

  describe("nested timers", () => {
    test("setTimeout inside setTimeout works", async () => {
      // TODO: Implement test
    });
  });

  describe("handle.tick()", () => {
    test("processes pending timers", async () => {
      // TODO: Implement test
    });
  });

  describe("handle.clearAll()", () => {
    test("clears all pending timers", async () => {
      // TODO: Implement test
    });
  });
});
