import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import ivm from "isolated-vm";
import { setupTestEnvironment, runTests } from "./index.ts";

describe("Test Modifiers", () => {
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

  test("it.todo marks tests as todo", async () => {
    context.evalSync(`
      describe("Feature tests", () => {
        it.todo("should implement this later");

        test("regular test", () => {
          expect(true).toBe(true);
        });
      });
    `);

    const results = await runTests(context);

    // todo tests should be tracked separately
    assert.strictEqual(results.passed, 1);
    // Check if todo is tracked (may need to look at results structure)
    const todoResult = results.results.find((r: any) => r.name.includes("implement this later"));
    assert.ok(todoResult, "todo test should be in results");
  });

  test("describe.only runs only specific suites", async () => {
    context.evalSync(`
      describe.only("critical tests", () => {
        it("this will run", () => {
          expect(true).toBe(true);
        });
      });

      describe("regular tests", () => {
        it("this won't run because describe.only is used", () => {
          expect(false).toBe(true); // Would fail if run
        });
      });
    `);

    const results = await runTests(context);

    assert.strictEqual(results.passed, 1);
    assert.strictEqual(results.failed, 0);
  });

  test("describe.only with nested tests", async () => {
    context.evalSync(`
      describe("outer", () => {
        describe.only("inner only", () => {
          it("should run", () => {
            expect(1).toBe(1);
          });
        });

        describe("inner regular", () => {
          it("should not run", () => {
            expect(false).toBe(true);
          });
        });
      });
    `);

    const results = await runTests(context);

    assert.strictEqual(results.passed, 1);
    assert.strictEqual(results.failed, 0);
  });
});

describe("Test Handle Methods", () => {
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

  test("hasTests returns false when no tests registered", async () => {
    // Assuming hasTests() is exposed or we can check via results
    const results = await runTests(context);
    assert.strictEqual(results.total, 0);
  });

  test("hasTests returns true when tests are registered", async () => {
    context.evalSync(`
      describe("suite", () => {
        it("test 1", () => {});
        it("test 2", () => {});
      });
    `);

    const results = await runTests(context);
    assert.ok(results.total > 0);
  });

  test("getTestCount returns accurate count", async () => {
    context.evalSync(`
      describe("suite", () => {
        it("test 1", () => {});
        it("test 2", () => {});
        describe("nested", () => {
          it("test 3", () => {});
        });
      });
    `);

    const results = await runTests(context);
    assert.strictEqual(results.total, 3);
  });

  test("reset clears tests", async () => {
    context.evalSync(`
      it("test", () => {});
    `);

    // First run should have 1 test
    const results1 = await runTests(context);
    assert.strictEqual(results1.total, 1);

    // Reset the test environment
    context.evalSync("__resetTestEnvironment()");

    // After reset, should have 0 tests
    const results2 = await runTests(context);
    assert.strictEqual(results2.total, 0);
  });

  test("reset allows registering new tests", async () => {
    context.evalSync(`it("test 1", () => {});`);
    const results1 = await runTests(context);
    assert.strictEqual(results1.total, 1);

    context.evalSync("__resetTestEnvironment()");

    context.evalSync(`it("test 2", () => {}); it("test 3", () => {});`);
    const results2 = await runTests(context);
    assert.strictEqual(results2.total, 2);
    assert.strictEqual(results2.passed, 2);
  });
});

describe("Error Scenarios", () => {
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

  test("syntax error in test code throws", async () => {
    assert.throws(() => {
      context.evalSync(`
        describe("suite", () => {
          it("test", () => {
            invalid syntax here
          });
        });
      `);
    });
  });

  test("runtime error in test captures error message", async () => {
    context.evalSync(`
      describe("suite", () => {
        it("throws", () => {
          throw new Error("intentional error");
        });
      });
    `);

    const results = await runTests(context);

    assert.strictEqual(results.failed, 1);
    assert.ok(results.results[0]!.error?.includes("intentional error"));
  });

  test("assertion error includes expected and actual values", async () => {
    context.evalSync(`
      describe("suite", () => {
        it("assertion fails", () => {
          expect(42).toBe(100);
        });
      });
    `);

    const results = await runTests(context);

    assert.strictEqual(results.failed, 1);
    const error = results.results[0]!.error;
    assert.ok(error?.includes("42"), "Error should mention actual value");
    assert.ok(error?.includes("100"), "Error should mention expected value");
  });

  test("toEqual assertion error shows both values", async () => {
    context.evalSync(`
      describe("suite", () => {
        it("deep equal fails", () => {
          expect({ a: 1 }).toEqual({ a: 2 });
        });
      });
    `);

    const results = await runTests(context);

    assert.strictEqual(results.failed, 1);
    assert.ok(results.results[0]!.error);
  });

  test("multiple test failures are all captured", async () => {
    context.evalSync(`
      describe("suite", () => {
        it("fail 1", () => {
          expect(1).toBe(2);
        });
        it("fail 2", () => {
          throw new Error("error 2");
        });
        it("pass", () => {
          expect(true).toBe(true);
        });
      });
    `);

    const results = await runTests(context);

    assert.strictEqual(results.failed, 2);
    assert.strictEqual(results.passed, 1);
    assert.strictEqual(results.total, 3);
  });
});

describe("Basic Test Execution", () => {
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

  test("SPEC example: basic test execution", async () => {
    context.evalSync(`
      describe("Math operations", () => {
        it("should add numbers", () => {
          expect(1 + 1).toBe(2);
        });

        it("should multiply numbers", () => {
          expect(2 * 3).toEqual(6);
        });
      });
    `);

    const results = await runTests(context);

    assert.strictEqual(results.passed, 2);
    assert.strictEqual(results.failed, 0);
    assert.ok(results.results.some((r: any) => r.name.includes("should add numbers")));
    assert.ok(results.results.some((r: any) => r.name.includes("should multiply numbers")));
  });

  test("SPEC example: with all hooks", async () => {
    context.evalSync(`
      describe("Database tests", () => {
        let db;

        beforeAll(() => {
          db = {
            data: [],
            clear() { this.data = []; },
            insert(r) { this.data.push(r); },
            count() { return this.data.length; },
            findById(id) { return this.data.find(r => r.id === id); }
          };
        });

        afterAll(() => {
          db = null;
        });

        beforeEach(() => {
          db.clear();
        });

        afterEach(() => {
          // cleanup after each test
        });

        it("should insert record", () => {
          db.insert({ id: 1, name: "test" });
          expect(db.count()).toBe(1);
        });

        it("should query records", () => {
          db.insert({ id: 1, name: "test" });
          const result = db.findById(1);
          expect(result).toEqual({ id: 1, name: "test" });
        });
      });
    `);

    const results = await runTests(context);

    assert.strictEqual(results.passed, 2);
    assert.strictEqual(results.failed, 0);
  });
});
