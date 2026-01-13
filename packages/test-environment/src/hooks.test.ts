import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import ivm from "isolated-vm";
import { setupTestEnvironment, runTests } from "./index.ts";

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
      context.evalSync(`
        let counter = 0;

        describe("suite", () => {
          beforeEach(() => {
            counter++;
          });

          test("first test", () => {
            expect(counter).toBe(1);
          });

          test("second test", () => {
            expect(counter).toBe(2);
          });
        });
      `);
      const results = await runTests(context);
      assert.strictEqual(results.passed, 2);
      assert.strictEqual(results.failed, 0);
    });
  });

  describe("afterEach", () => {
    test("runs after each test", async () => {
      context.evalSync(`
        let log = [];

        describe("suite", () => {
          afterEach(() => {
            log.push("afterEach");
          });

          test("first test", () => {
            log.push("test1");
          });

          test("second test", () => {
            log.push("test2");
            expect(log).toEqual(["test1", "afterEach", "test2"]);
          });
        });
      `);
      const results = await runTests(context);
      assert.strictEqual(results.passed, 2);
      assert.strictEqual(results.failed, 0);
    });
  });

  describe("beforeAll", () => {
    test("runs once before all tests", async () => {
      context.evalSync(`
        let setupCount = 0;

        describe("suite", () => {
          beforeAll(() => {
            setupCount++;
          });

          test("first test", () => {
            expect(setupCount).toBe(1);
          });

          test("second test", () => {
            expect(setupCount).toBe(1);
          });

          test("third test", () => {
            expect(setupCount).toBe(1);
          });
        });
      `);
      const results = await runTests(context);
      assert.strictEqual(results.passed, 3);
      assert.strictEqual(results.failed, 0);
    });
  });

  describe("afterAll", () => {
    test("runs once after all tests", async () => {
      context.evalSync(`
        let log = [];

        describe("suite", () => {
          afterAll(() => {
            log.push("afterAll");
          });

          test("first test", () => {
            log.push("test1");
          });

          test("second test", () => {
            log.push("test2");
          });
        });

        // We can check in a sibling suite that afterAll ran
        describe("verification", () => {
          test("afterAll was called", () => {
            expect(log).toEqual(["test1", "test2", "afterAll"]);
          });
        });
      `);
      const results = await runTests(context);
      assert.strictEqual(results.passed, 3);
      assert.strictEqual(results.failed, 0);
    });
  });

  describe("nested describe", () => {
    test("hooks run in correct order", async () => {
      context.evalSync(`
        let log = [];

        describe("outer", () => {
          beforeAll(() => log.push("outer beforeAll"));
          afterAll(() => log.push("outer afterAll"));
          beforeEach(() => log.push("outer beforeEach"));
          afterEach(() => log.push("outer afterEach"));

          describe("inner", () => {
            beforeAll(() => log.push("inner beforeAll"));
            afterAll(() => log.push("inner afterAll"));
            beforeEach(() => log.push("inner beforeEach"));
            afterEach(() => log.push("inner afterEach"));

            test("nested test", () => {
              log.push("test");
            });
          });
        });

        describe("check results", () => {
          test("hooks ran in correct order", () => {
            expect(log).toEqual([
              "outer beforeAll",
              "inner beforeAll",
              "outer beforeEach",
              "inner beforeEach",
              "test",
              "inner afterEach",
              "outer afterEach",
              "inner afterAll",
              "outer afterAll"
            ]);
          });
        });
      `);
      const results = await runTests(context);
      assert.strictEqual(results.passed, 2);
      assert.strictEqual(results.failed, 0);
    });
  });

  describe("test.skip", () => {
    test("skips tests marked with skip", async () => {
      context.evalSync(`
        describe("suite", () => {
          test("normal test", () => {
            expect(true).toBe(true);
          });

          test.skip("skipped test", () => {
            expect(true).toBe(false); // This would fail if run
          });
        });
      `);
      const results = await runTests(context);
      assert.strictEqual(results.passed, 1);
      assert.strictEqual(results.failed, 0);
      assert.strictEqual(results.results.filter((r: any) => r.skipped).length, 1);
    });
  });

  describe("test.only", () => {
    test("runs only tests marked with only", async () => {
      context.evalSync(`
        describe("suite", () => {
          test("should not run", () => {
            expect(true).toBe(false); // Would fail if run
          });

          test.only("should run", () => {
            expect(true).toBe(true);
          });

          test("also should not run", () => {
            expect(true).toBe(false); // Would fail if run
          });
        });
      `);
      const results = await runTests(context);
      assert.strictEqual(results.passed, 1);
      assert.strictEqual(results.failed, 0);
      assert.strictEqual(results.total, 1);
    });
  });

  describe("describe.skip", () => {
    test("skips all tests in skipped describe", async () => {
      context.evalSync(`
        describe.skip("skipped suite", () => {
          test("test 1", () => {
            expect(true).toBe(false);
          });

          test("test 2", () => {
            expect(true).toBe(false);
          });
        });

        describe("normal suite", () => {
          test("normal test", () => {
            expect(true).toBe(true);
          });
        });
      `);
      const results = await runTests(context);
      assert.strictEqual(results.passed, 1);
      assert.strictEqual(results.failed, 0);
      assert.strictEqual(results.results.filter((r: any) => r.skipped).length, 2);
    });
  });

  describe("async tests", () => {
    test("supports async test functions", async () => {
      context.evalSync(`
        describe("async suite", () => {
          test("async test", async () => {
            await Promise.resolve();
            expect(1 + 1).toBe(2);
          });
        });
      `);
      const results = await runTests(context);
      assert.strictEqual(results.passed, 1);
      assert.strictEqual(results.failed, 0);
    });

    test("supports async hooks", async () => {
      context.evalSync(`
        let value = 0;

        describe("async hooks", () => {
          beforeEach(async () => {
            await Promise.resolve();
            value = 42;
          });

          test("value is set", () => {
            expect(value).toBe(42);
          });
        });
      `);
      const results = await runTests(context);
      assert.strictEqual(results.passed, 1);
      assert.strictEqual(results.failed, 0);
    });
  });

  describe("it alias", () => {
    test("it works as alias for test", async () => {
      context.evalSync(`
        describe("suite", () => {
          it("uses it instead of test", () => {
            expect(1).toBe(1);
          });

          it.skip("skipped with it", () => {
            expect(true).toBe(false);
          });
        });
      `);
      const results = await runTests(context);
      assert.strictEqual(results.passed, 1);
      assert.strictEqual(results.failed, 0);
      assert.strictEqual(results.results.filter((r: any) => r.skipped).length, 1);
    });
  });
});
