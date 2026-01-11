import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import ivm from "isolated-vm";
import { setupTestEnvironment } from "./index.ts";

describe("test hooks", () => {
  let isolate: ivm.Isolate;
  let context: ivm.Context;

  beforeEach(async () => {
    isolate = new ivm.Isolate();
    context = await isolate.createContext();
    await setupTestEnvironment(context);
  });

  afterEach(() => {
    context.release();
    isolate.dispose();
  });

  describe("beforeEach", () => {
    test("runs before each test", async () => {
      // TODO: Implement test
    });
  });

  describe("afterEach", () => {
    test("runs after each test", async () => {
      // TODO: Implement test
    });
  });

  describe("beforeAll", () => {
    test("runs once before all tests", async () => {
      // TODO: Implement test
    });
  });

  describe("afterAll", () => {
    test("runs once after all tests", async () => {
      // TODO: Implement test
    });
  });

  describe("nested describe", () => {
    test("hooks run in correct order", async () => {
      // TODO: Implement test
    });
  });
});
