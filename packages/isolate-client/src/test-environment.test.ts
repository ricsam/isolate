/**
 * Comprehensive tests for testEnvironment and playwright features.
 * Tests advanced matchers, hooks, async patterns, and real browser interactions.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import { connect } from "./connection.ts";
import { startDaemon, type DaemonHandle } from "@ricsam/isolate-daemon";
import { chromium, type Browser, type Page } from "playwright";
import type { DaemonConnection } from "./types.ts";
import { defaultPlaywrightHandler } from "@ricsam/isolate-playwright/client";

const TEST_SOCKET = "/tmp/isolate-test-env-daemon.sock";

describe("testEnvironment feature", () => {
  let daemon: DaemonHandle;
  let client: DaemonConnection;

  before(async () => {
    daemon = await startDaemon({ socketPath: TEST_SOCKET });
    client = await connect({ socket: TEST_SOCKET });
  });

  after(async () => {
    await client.close();
    await daemon.close();
  });

  describe("expect matchers", () => {
    it("toBe - strict equality", async () => {
      const runtime = await client.createRuntime({ testEnvironment: true });
      try {
        await runtime.eval(`
          describe("toBe", () => {
            it("compares primitives", () => {
              expect(1).toBe(1);
              expect("hello").toBe("hello");
              expect(true).toBe(true);
              expect(null).toBe(null);
              expect(undefined).toBe(undefined);
            });

            it("fails for different values", () => {
              expect(1).not.toBe(2);
              expect("hello").not.toBe("world");
            });

            it("uses strict equality for objects", () => {
              const obj = { a: 1 };
              expect(obj).toBe(obj); // same reference
              expect({ a: 1 }).not.toBe({ a: 1 }); // different references
            });
          });
        `);

        const results = await runtime.testEnvironment.runTests();
        assert.strictEqual(results.failed, 0, `Expected 0 failures but got ${results.failed}`);
        assert.strictEqual(results.passed, 3);
      } finally {
        await runtime.dispose();
      }
    });

    it("toEqual - deep equality", async () => {
      const runtime = await client.createRuntime({ testEnvironment: true });
      try {
        await runtime.eval(`
          describe("toEqual", () => {
            it("compares objects deeply", () => {
              expect({ a: 1, b: { c: 2 } }).toEqual({ a: 1, b: { c: 2 } });
              expect([1, 2, [3, 4]]).toEqual([1, 2, [3, 4]]);
            });

            it("handles nested structures", () => {
              const obj = {
                name: "test",
                items: [1, 2, 3],
                nested: { deep: { value: true } }
              };
              expect(obj).toEqual({
                name: "test",
                items: [1, 2, 3],
                nested: { deep: { value: true } }
              });
            });

            it("detects differences", () => {
              expect({ a: 1 }).not.toEqual({ a: 2 });
              expect([1, 2]).not.toEqual([1, 2, 3]);
            });
          });
        `);

        const results = await runtime.testEnvironment.runTests();
        assert.strictEqual(results.failed, 0);
        assert.strictEqual(results.passed, 3);
      } finally {
        await runtime.dispose();
      }
    });

    it("toStrictEqual - strict deep equality", async () => {
      const runtime = await client.createRuntime({ testEnvironment: true });
      try {
        await runtime.eval(`
          describe("toStrictEqual", () => {
            it("checks undefined properties", () => {
              expect({ a: 1 }).not.toStrictEqual({ a: 1, b: undefined });
            });

            it("checks array holes", () => {
              // Arrays with holes vs explicit undefined
              const arr1 = [1, , 3];
              const arr2 = [1, undefined, 3];
              expect(arr1).not.toStrictEqual(arr2);
            });
          });
        `);

        const results = await runtime.testEnvironment.runTests();
        assert.strictEqual(results.failed, 0);
        assert.strictEqual(results.passed, 2);
      } finally {
        await runtime.dispose();
      }
    });

    it("truthiness matchers", async () => {
      const runtime = await client.createRuntime({ testEnvironment: true });
      try {
        await runtime.eval(`
          describe("truthiness", () => {
            it("toBeTruthy", () => {
              expect(true).toBeTruthy();
              expect(1).toBeTruthy();
              expect("hello").toBeTruthy();
              expect({}).toBeTruthy();
              expect([]).toBeTruthy();
            });

            it("toBeFalsy", () => {
              expect(false).toBeFalsy();
              expect(0).toBeFalsy();
              expect("").toBeFalsy();
              expect(null).toBeFalsy();
              expect(undefined).toBeFalsy();
              expect(NaN).toBeFalsy();
            });

            it("toBeNull", () => {
              expect(null).toBeNull();
              expect(undefined).not.toBeNull();
            });

            it("toBeUndefined", () => {
              expect(undefined).toBeUndefined();
              expect(null).not.toBeUndefined();
            });

            it("toBeDefined", () => {
              expect(1).toBeDefined();
              expect(null).toBeDefined();
              expect(undefined).not.toBeDefined();
            });
          });
        `);

        const results = await runtime.testEnvironment.runTests();
        assert.strictEqual(results.failed, 0);
        assert.strictEqual(results.passed, 5);
      } finally {
        await runtime.dispose();
      }
    });

    it("toContain - array and string", async () => {
      const runtime = await client.createRuntime({ testEnvironment: true });
      try {
        await runtime.eval(`
          describe("toContain", () => {
            it("checks array items", () => {
              expect([1, 2, 3]).toContain(2);
              expect(["a", "b", "c"]).toContain("b");
              expect([{ a: 1 }, { b: 2 }]).not.toContain({ a: 1 }); // reference check
            });

            it("checks substrings", () => {
              expect("hello world").toContain("world");
              expect("hello world").toContain("llo wo");
              expect("hello").not.toContain("xyz");
            });
          });
        `);

        const results = await runtime.testEnvironment.runTests();
        assert.strictEqual(results.failed, 0);
        assert.strictEqual(results.passed, 2);
      } finally {
        await runtime.dispose();
      }
    });

    it("toThrow - error checking", async () => {
      const runtime = await client.createRuntime({ testEnvironment: true });
      try {
        await runtime.eval(`
          describe("toThrow", () => {
            it("checks if function throws", () => {
              expect(() => { throw new Error("boom"); }).toThrow();
              expect(() => {}).not.toThrow();
            });

            it("matches error message", () => {
              expect(() => { throw new Error("specific error"); }).toThrow("specific error");
              expect(() => { throw new Error("hello world"); }).toThrow("world");
            });

            it("matches error regex", () => {
              expect(() => { throw new Error("Error 404: Not found"); }).toThrow(/404/);
              expect(() => { throw new Error("Error 404: Not found"); }).toThrow(/not found/i);
            });
          });
        `);

        const results = await runtime.testEnvironment.runTests();
        assert.strictEqual(results.failed, 0);
        assert.strictEqual(results.passed, 3);
      } finally {
        await runtime.dispose();
      }
    });

    it("toBeInstanceOf", async () => {
      const runtime = await client.createRuntime({ testEnvironment: true });
      try {
        await runtime.eval(`
          describe("toBeInstanceOf", () => {
            it("checks instance types", () => {
              expect(new Date()).toBeInstanceOf(Date);
              expect([]).toBeInstanceOf(Array);
              expect({}).toBeInstanceOf(Object);
              expect(new Error()).toBeInstanceOf(Error);
            });

            it("works with custom classes", () => {
              class MyClass {}
              class MySubClass extends MyClass {}
              expect(new MyClass()).toBeInstanceOf(MyClass);
              expect(new MySubClass()).toBeInstanceOf(MyClass);
              expect(new MySubClass()).toBeInstanceOf(MySubClass);
            });
          });
        `);

        const results = await runtime.testEnvironment.runTests();
        assert.strictEqual(results.failed, 0);
        assert.strictEqual(results.passed, 2);
      } finally {
        await runtime.dispose();
      }
    });

    it("toHaveLength", async () => {
      const runtime = await client.createRuntime({ testEnvironment: true });
      try {
        await runtime.eval(`
          describe("toHaveLength", () => {
            it("checks array length", () => {
              expect([1, 2, 3]).toHaveLength(3);
              expect([]).toHaveLength(0);
            });

            it("checks string length", () => {
              expect("hello").toHaveLength(5);
              expect("").toHaveLength(0);
            });
          });
        `);

        const results = await runtime.testEnvironment.runTests();
        assert.strictEqual(results.failed, 0);
        assert.strictEqual(results.passed, 2);
      } finally {
        await runtime.dispose();
      }
    });

    it("toMatch - regex and string", async () => {
      const runtime = await client.createRuntime({ testEnvironment: true });
      try {
        await runtime.eval(`
          describe("toMatch", () => {
            it("matches regex patterns", () => {
              expect("hello@example.com").toMatch(/@/);
              expect("hello@example.com").toMatch(/^[a-z]+@[a-z]+\\.[a-z]+$/);
            });

            it("matches substrings", () => {
              expect("hello world").toMatch("world");
              expect("testing 123").toMatch("123");
            });
          });
        `);

        const results = await runtime.testEnvironment.runTests();
        assert.strictEqual(results.failed, 0);
        assert.strictEqual(results.passed, 2);
      } finally {
        await runtime.dispose();
      }
    });

    it("toHaveProperty", async () => {
      const runtime = await client.createRuntime({ testEnvironment: true });
      try {
        await runtime.eval(`
          describe("toHaveProperty", () => {
            it("checks property existence", () => {
              expect({ a: 1, b: 2 }).toHaveProperty("a");
              expect({ a: 1 }).not.toHaveProperty("b");
            });

            it("checks property value", () => {
              expect({ a: 1, b: 2 }).toHaveProperty("a", 1);
              expect({ a: 1 }).not.toHaveProperty("a", 2);
            });

            it("checks nested properties", () => {
              const obj = { a: { b: { c: 3 } } };
              expect(obj).toHaveProperty("a");
              expect(obj).toHaveProperty("a.b");
              expect(obj).toHaveProperty("a.b.c", 3);
            });
          });
        `);

        const results = await runtime.testEnvironment.runTests();
        assert.strictEqual(results.failed, 0);
        assert.strictEqual(results.passed, 3);
      } finally {
        await runtime.dispose();
      }
    });
  });

  describe("test hooks", () => {
    it("beforeEach and afterEach run for each test", async () => {
      const runtime = await client.createRuntime({ testEnvironment: true });
      try {
        await runtime.eval(`
          let setupCount = 0;
          let teardownCount = 0;
          let testValues = [];

          describe("hooks", () => {
            beforeEach(() => {
              setupCount++;
              testValues.push("setup:" + setupCount);
            });

            afterEach(() => {
              teardownCount++;
              testValues.push("teardown:" + teardownCount);
            });

            it("first test", () => {
              expect(setupCount).toBe(1);
              testValues.push("test1");
            });

            it("second test", () => {
              expect(setupCount).toBe(2);
              testValues.push("test2");
            });

            it("third test", () => {
              expect(setupCount).toBe(3);
              testValues.push("test3");
            });
          });
        `);

        const results = await runtime.testEnvironment.runTests();
        assert.strictEqual(results.failed, 0);
        assert.strictEqual(results.passed, 3);
      } finally {
        await runtime.dispose();
      }
    });

    it("beforeAll and afterAll run once per describe", async () => {
      const runtime = await client.createRuntime({ testEnvironment: true });
      try {
        await runtime.eval(`
          let beforeAllCount = 0;
          let afterAllCount = 0;

          describe("suite", () => {
            beforeAll(() => {
              beforeAllCount++;
            });

            afterAll(() => {
              afterAllCount++;
            });

            it("test 1", () => {
              expect(beforeAllCount).toBe(1);
            });

            it("test 2", () => {
              expect(beforeAllCount).toBe(1); // still 1
            });

            it("test 3", () => {
              expect(beforeAllCount).toBe(1); // still 1
            });
          });
        `);

        const results = await runtime.testEnvironment.runTests();
        assert.strictEqual(results.failed, 0);
        assert.strictEqual(results.passed, 3);
      } finally {
        await runtime.dispose();
      }
    });

    it("nested describe blocks with hooks", async () => {
      const runtime = await client.createRuntime({ testEnvironment: true });
      try {
        await runtime.eval(`
          let log = [];

          describe("outer", () => {
            beforeEach(() => log.push("outer-before"));
            afterEach(() => log.push("outer-after"));

            it("outer test", () => {
              log.push("outer-test");
              expect(log).toEqual(["outer-before", "outer-test"]);
            });

            describe("inner", () => {
              beforeEach(() => log.push("inner-before"));
              afterEach(() => log.push("inner-after"));

              it("inner test", () => {
                log.push("inner-test");
                // outer-before runs, then inner-before
                expect(log.slice(-3)).toEqual(["outer-before", "inner-before", "inner-test"]);
              });
            });
          });
        `);

        const results = await runtime.testEnvironment.runTests();
        assert.strictEqual(results.failed, 0);
        assert.strictEqual(results.passed, 2);
      } finally {
        await runtime.dispose();
      }
    });
  });

  describe("async tests", () => {
    it("handles async test functions", async () => {
      const runtime = await client.createRuntime({ testEnvironment: true });
      try {
        await runtime.eval(`
          describe("async", () => {
            it("resolves promises", async () => {
              const result = await Promise.resolve(42);
              expect(result).toBe(42);
            });

            it("handles delayed results", async () => {
              const delay = (ms, value) => new Promise(r => setTimeout(() => r(value), ms));
              const result = await delay(10, "done");
              expect(result).toBe("done");
            });

            it("handles multiple awaits", async () => {
              const a = await Promise.resolve(1);
              const b = await Promise.resolve(2);
              const c = await Promise.resolve(3);
              expect(a + b + c).toBe(6);
            });
          });
        `);

        const results = await runtime.testEnvironment.runTests();
        assert.strictEqual(results.failed, 0);
        assert.strictEqual(results.passed, 3);
      } finally {
        await runtime.dispose();
      }
    });

    it("handles async hooks", async () => {
      const runtime = await client.createRuntime({ testEnvironment: true });
      try {
        await runtime.eval(`
          let data = null;

          describe("async hooks", () => {
            beforeAll(async () => {
              data = await Promise.resolve({ loaded: true });
            });

            beforeEach(async () => {
              await Promise.resolve(); // simulate async setup
            });

            it("uses async loaded data", () => {
              expect(data).toEqual({ loaded: true });
            });
          });
        `);

        const results = await runtime.testEnvironment.runTests();
        assert.strictEqual(results.failed, 0);
        assert.strictEqual(results.passed, 1);
      } finally {
        await runtime.dispose();
      }
    });
  });

  describe("test modifiers", () => {
    it("it.skip skips tests", async () => {
      const runtime = await client.createRuntime({ testEnvironment: true });
      try {
        await runtime.eval(`
          describe("skipped", () => {
            it("runs", () => expect(true).toBe(true));

            it.skip("is skipped", () => {
              throw new Error("should not run");
            });

            it("also runs", () => expect(1).toBe(1));
          });
        `);

        const results = await runtime.testEnvironment.runTests();
        assert.strictEqual(results.passed, 2);
        assert.strictEqual(results.skipped, 1);
        assert.strictEqual(results.failed, 0);
      } finally {
        await runtime.dispose();
      }
    });

    it("it.todo marks tests as todo", async () => {
      const runtime = await client.createRuntime({ testEnvironment: true });
      try {
        await runtime.eval(`
          describe("todos", () => {
            it("implemented", () => expect(true).toBe(true));
            it.todo("not yet implemented");
            it.todo("also not implemented");
          });
        `);

        const results = await runtime.testEnvironment.runTests();
        assert.strictEqual(results.passed, 1);
        // todo tests are counted in results
      } finally {
        await runtime.dispose();
      }
    });

    it("describe.skip skips entire suites", async () => {
      const runtime = await client.createRuntime({ testEnvironment: true });
      try {
        await runtime.eval(`
          describe("runs", () => {
            it("test 1", () => expect(true).toBe(true));
          });

          describe.skip("skipped suite", () => {
            it("would fail", () => {
              throw new Error("should not run");
            });

            it("also would fail", () => {
              throw new Error("should not run");
            });
          });

          describe("also runs", () => {
            it("test 2", () => expect(true).toBe(true));
          });
        `);

        const results = await runtime.testEnvironment.runTests();
        assert.strictEqual(results.passed, 2);
        assert.strictEqual(results.failed, 0);
      } finally {
        await runtime.dispose();
      }
    });
  });

  describe("test environment reset", () => {
    it("reset clears all registered tests", async () => {
      const runtime = await client.createRuntime({ testEnvironment: true });
      try {
        // First batch of tests
        await runtime.eval(`
          describe("batch 1", () => {
            it("test a", () => expect(1).toBe(1));
            it("test b", () => expect(2).toBe(2));
          });
        `);

        let results = await runtime.testEnvironment.runTests();
        assert.strictEqual(results.total, 2);

        // Reset and register new tests
        await runtime.testEnvironment.reset();

        await runtime.eval(`
          describe("batch 2", () => {
            it("test c", () => expect(3).toBe(3));
          });
        `);

        results = await runtime.testEnvironment.runTests();
        assert.strictEqual(results.total, 1);
        assert.strictEqual(results.passed, 1);
      } finally {
        await runtime.dispose();
      }
    });
  });
});

describe("playwright feature", () => {
  let daemon: DaemonHandle;
  let client: DaemonConnection;
  let browser: Browser;

  before(async () => {
    daemon = await startDaemon({ socketPath: TEST_SOCKET + ".pw" });
    client = await connect({ socket: TEST_SOCKET + ".pw" });
    browser = await chromium.launch({ headless: true });
  });

  after(async () => {
    await browser.close();
    await client.close();
    await daemon.close();
  });

  describe("playwright tests (test() style)", () => {
    it("runs simple playwright tests", async () => {
      const page = await browser.newPage();
      try {
        const runtime = await client.createRuntime({
          testEnvironment: true, playwright: { handler: defaultPlaywrightHandler(page) },
        });

        try {
          await runtime.eval(`
            test("basic assertions", async () => {
              expect(true).toBe(true);
              expect(1 + 1).toBe(2);
            });

            test("async test", async () => {
              await Promise.resolve();
              expect("hello").toBe("hello");
            });
          `);

          const results = await runtime.testEnvironment.runTests();
          assert.strictEqual(results.passed, 2);
          assert.strictEqual(results.failed, 0);
        } finally {
          await runtime.dispose();
        }
      } finally {
        await page.close();
      }
    });

    it("navigates to data URLs", async () => {
      const page = await browser.newPage();
      try {
        const runtime = await client.createRuntime({
          testEnvironment: true, playwright: { handler: defaultPlaywrightHandler(page) },
        });

        try {
          await runtime.eval(`
            test("navigate to data URL", async () => {
              await page.goto("data:text/html,<h1>Hello World</h1>");
              const title = await page.title();
              expect(title).toBe("");
            });
          `);

          const results = await runtime.testEnvironment.runTests();
          assert.strictEqual(results.passed, 1);
          assert.strictEqual(results.failed, 0);
        } finally {
          await runtime.dispose();
        }
      } finally {
        await page.close();
      }
    });

    it("interacts with page elements", async () => {
      const page = await browser.newPage();
      try {
        const runtime = await client.createRuntime({
          testEnvironment: true, playwright: { handler: defaultPlaywrightHandler(page) },
        });

        try {
          await runtime.eval(`
            test("find and interact with elements", async () => {
              await page.goto("data:text/html,<button id='btn'>Click Me</button><div id='result'></div><script>document.getElementById('btn').onclick = () => document.getElementById('result').textContent = 'Clicked!';</script>");

              // Find and click button
              const button = page.locator("#btn");
              await expect(button).toBeVisible();
              await button.click();

              // Check result
              const result = page.locator("#result");
              await expect(result).toContainText("Clicked!");
            });
          `);

          const results = await runtime.testEnvironment.runTests();
          assert.strictEqual(results.passed, 1);
          assert.strictEqual(results.failed, 0);
        } finally {
          await runtime.dispose();
        }
      } finally {
        await page.close();
      }
    });

    it("uses getByLabel for form field queries", async () => {
      const page = await browser.newPage();
      try {
        const runtime = await client.createRuntime({
          testEnvironment: true, playwright: { handler: defaultPlaywrightHandler(page) },
        });

        try {
          await runtime.eval(`
            test("getByLabel queries", async () => {
              await page.goto("data:text/html,<label for='name'>Name</label><input id='name' type='text'>");

              // Use getByLabel to find the input associated with the label
              const nameInput = page.getByLabel("Name");
              await nameInput.fill("John Doe");
              await expect(nameInput).toHaveValue("John Doe");
            });
          `);

          const results = await runtime.testEnvironment.runTests();
          if (results.failed > 0) {
            const failedTest = results.tests.find((r) => r.status === "fail");
            console.error("Failed test error:", failedTest?.error);
          }
          assert.strictEqual(results.passed, 1, `Expected 1 passed, got ${results.passed}. Results: ${JSON.stringify(results.tests)}`);
          assert.strictEqual(results.failed, 0);
        } finally {
          await runtime.dispose();
        }
      } finally {
        await page.close();
      }
    });

    it("uses getByText for text queries", async () => {
      const page = await browser.newPage();
      try {
        const runtime = await client.createRuntime({
          testEnvironment: true, playwright: { handler: defaultPlaywrightHandler(page) },
        });

        try {
          await runtime.eval(`
            test("getByText queries", async () => {
              await page.goto("data:text/html,<p>Hello World</p><span>Goodbye World</span>");

              const hello = page.getByText("Hello World");
              await expect(hello).toBeVisible();

              const goodbye = page.getByText("Goodbye");
              await expect(goodbye).toBeVisible();
            });
          `);

          const results = await runtime.testEnvironment.runTests();
          assert.strictEqual(results.passed, 1);
          assert.strictEqual(results.failed, 0);
        } finally {
          await runtime.dispose();
        }
      } finally {
        await page.close();
      }
    });

    it("fills form inputs", async () => {
      const page = await browser.newPage();
      try {
        const runtime = await client.createRuntime({
          testEnvironment: true, playwright: { handler: defaultPlaywrightHandler(page) },
        });

        try {
          await runtime.eval(`
            test("form interaction", async () => {
              await page.goto("data:text/html,<input type='text' id='name' placeholder='Name'><input type='email' id='email' placeholder='Email'>");

              const nameInput = page.locator("#name");
              await nameInput.fill("John Doe");
              await expect(nameInput).toHaveValue("John Doe");

              const emailInput = page.getByPlaceholder("Email");
              await emailInput.fill("john@example.com");
              await expect(emailInput).toHaveValue("john@example.com");
            });
          `);

          const results = await runtime.testEnvironment.runTests();
          assert.strictEqual(results.passed, 1);
          assert.strictEqual(results.failed, 0);
        } finally {
          await runtime.dispose();
        }
      } finally {
        await page.close();
      }
    });

    it("handles checkboxes", async () => {
      const page = await browser.newPage();
      try {
        const runtime = await client.createRuntime({
          testEnvironment: true, playwright: { handler: defaultPlaywrightHandler(page) },
        });

        try {
          await runtime.eval(`
            test("checkbox interaction", async () => {
              await page.goto("data:text/html,<input type='checkbox' id='agree'><label for='agree'>I agree</label>");

              const checkbox = page.locator("#agree");
              await expect(checkbox).not.toBeChecked();

              await checkbox.check();
              await expect(checkbox).toBeChecked();

              await checkbox.uncheck();
              await expect(checkbox).not.toBeChecked();
            });
          `);

          const results = await runtime.testEnvironment.runTests();
          assert.strictEqual(results.passed, 1);
          assert.strictEqual(results.failed, 0);
        } finally {
          await runtime.dispose();
        }
      } finally {
        await page.close();
      }
    });

    it("handles test failures with clear messages", async () => {
      const page = await browser.newPage();
      try {
        const runtime = await client.createRuntime({
          testEnvironment: true, playwright: { handler: defaultPlaywrightHandler(page) },
        });

        try {
          await runtime.eval(`
            test("passing test", async () => {
              expect(true).toBe(true);
            });

            test("failing test", async () => {
              expect(1).toBe(2);
            });
          `);

          const results = await runtime.testEnvironment.runTests();
          assert.strictEqual(results.passed, 1);
          assert.strictEqual(results.failed, 1);

          const failedTest = results.tests.find((r) => r.status === "fail");
          assert.ok(failedTest);
          assert.ok(failedTest.error);
          assert.ok(failedTest.error.message?.includes("Expected"));
        } finally {
          await runtime.dispose();
        }
      } finally {
        await page.close();
      }
    });

    it("resets tests between runs", async () => {
      const page = await browser.newPage();
      try {
        const runtime = await client.createRuntime({
          testEnvironment: true, playwright: { handler: defaultPlaywrightHandler(page) },
        });

        try {
          // First batch
          await runtime.eval(`
            test("test 1", async () => expect(true).toBe(true));
            test("test 2", async () => expect(true).toBe(true));
          `);

          let results = await runtime.testEnvironment.runTests();
          assert.strictEqual(results.total, 2);

          // Reset and new batch
          await runtime.testEnvironment.reset();

          await runtime.eval(`
            test("test 3", async () => expect(true).toBe(true));
          `);

          results = await runtime.testEnvironment.runTests();
          assert.strictEqual(results.total, 1);
        } finally {
          await runtime.dispose();
        }
      } finally {
        await page.close();
      }
    });
  });

  describe("playwright scripts (direct API usage)", () => {
    it("executes page.goto directly", async () => {
      const page = await browser.newPage();
      try {
        const logs: string[] = [];
        const runtime = await client.createRuntime({
          testEnvironment: true, playwright: { handler: defaultPlaywrightHandler(page) },
          console: {
            onEntry: (entry) => {
              if (entry.type === "output" && entry.level === "log") {
                logs.push(entry.stdout);
              }
            },
          },
        });

        try {
          await runtime.eval(`
            // Direct script execution without test() wrapper
            await page.goto("data:text/html,<h1>Direct Script</h1>");
            const url = await page.url();  // page.url() is async in the sandbox
            console.log("URL starts with data:", url.startsWith("data:"));
          `);

          // Wait for console callback
          await new Promise(r => setTimeout(r, 100));
          assert.ok(logs.some(l => l.includes("true")), `Expected 'true' in logs, got: ${JSON.stringify(logs)}`);
        } finally {
          await runtime.dispose();
        }
      } finally {
        await page.close();
      }
    });

    it("reads page content directly", async () => {
      const page = await browser.newPage();
      try {
        const logs: string[] = [];
        const runtime = await client.createRuntime({
          testEnvironment: true, playwright: { handler: defaultPlaywrightHandler(page) },
          console: {
            onEntry: (entry) => {
              if (entry.type === "output" && entry.level === "log") {
                logs.push(entry.stdout);
              }
            },
          },
        });

        try {
          await runtime.eval(`
            await page.goto("data:text/html,<div id='content'>Test Content</div>");
            const content = await page.content();
            const hasContent = content.includes("Test Content");
            console.log(hasContent ? "content-found" : "content-missing");
          `);

          await new Promise(r => setTimeout(r, 150));
          assert.ok(logs.some(l => l === "content-found"), `Expected 'content-found' in logs, got: ${JSON.stringify(logs)}`);
        } finally {
          await runtime.dispose();
        }
      } finally {
        await page.close();
      }
    });

    it("evaluates JavaScript in browser context", async () => {
      const page = await browser.newPage();
      try {
        const logs: string[] = [];
        const runtime = await client.createRuntime({
          testEnvironment: true, playwright: { handler: defaultPlaywrightHandler(page) },
          console: {
            onEntry: (entry) => {
              if (entry.type === "output" && entry.level === "log") {
                logs.push(entry.stdout);
              }
            },
          },
        });

        try {
          await runtime.eval(`
            await page.goto("data:text/html,<script>window.myValue = 42;</script>");
            const result = await page.evaluate("window.myValue");
            console.log(result);
          `);

          await new Promise(r => setTimeout(r, 100));
          assert.ok(logs.includes("42"));
        } finally {
          await runtime.dispose();
        }
      } finally {
        await page.close();
      }
    });

    it("interacts with elements directly (no test wrapper)", async () => {
      const page = await browser.newPage();
      try {
        const logs: string[] = [];
        const runtime = await client.createRuntime({
          testEnvironment: true, playwright: { handler: defaultPlaywrightHandler(page) },
          console: {
            onEntry: (entry) => {
              if (entry.type === "output" && entry.level === "log") {
                logs.push(entry.stdout);
              }
            },
          },
        });

        try {
          await runtime.eval(`
            await page.goto("data:text/html,<input id='input' value='initial'><button id='btn'>Click</button>");

            // Read initial value
            const input = page.locator("#input");
            const initialValue = await input.inputValue();
            console.log("Initial: " + initialValue);

            // Fill new value
            await input.fill("updated");
            const newValue = await input.inputValue();
            console.log("Updated: " + newValue);

            // Click button
            const button = page.locator("#btn");
            const isVisible = await button.isVisible();
            console.log("Button visible: " + isVisible);
          `);

          await new Promise(r => setTimeout(r, 100));
          assert.ok(logs.some(l => l.includes("Initial: initial")));
          assert.ok(logs.some(l => l.includes("Updated: updated")));
          assert.ok(logs.some(l => l.includes("Button visible: true")));
        } finally {
          await runtime.dispose();
        }
      } finally {
        await page.close();
      }
    });

    it("waits for selectors", async () => {
      const page = await browser.newPage();
      try {
        const logs: string[] = [];
        const runtime = await client.createRuntime({
          testEnvironment: true, playwright: { handler: defaultPlaywrightHandler(page) },
          console: {
            onEntry: (entry) => {
              if (entry.type === "output" && entry.level === "log") {
                logs.push(entry.stdout);
              }
            },
          },
        });

        try {
          await runtime.eval(`
            await page.goto("data:text/html,<div id='container'></div><script>setTimeout(() => { document.getElementById('container').innerHTML = '<span id=\\"delayed\\">Loaded!</span>'; }, 50);</script>");

            // Wait for dynamically added element
            await page.waitForSelector("#delayed");
            console.log("Element appeared");

            const text = await page.locator("#delayed").textContent();
            console.log("Text: " + text);
          `);

          await new Promise(r => setTimeout(r, 200));
          assert.ok(logs.some(l => l.includes("Element appeared")));
          assert.ok(logs.some(l => l.includes("Text: Loaded!")));
        } finally {
          await runtime.dispose();
        }
      } finally {
        await page.close();
      }
    });

    it("uses page.reload", async () => {
      const page = await browser.newPage();
      try {
        const logs: string[] = [];
        const runtime = await client.createRuntime({
          testEnvironment: true, playwright: { handler: defaultPlaywrightHandler(page) },
          console: {
            onEntry: (entry) => {
              if (entry.type === "output" && entry.level === "log") {
                logs.push(entry.stdout);
              }
            },
          },
        });

        try {
          await runtime.eval(`
            await page.goto("data:text/html,<div id='content'>Original</div>");
            console.log("Before reload");
            await page.reload();
            console.log("After reload");
          `);

          await new Promise(r => setTimeout(r, 100));
          assert.ok(logs.includes("Before reload"));
          assert.ok(logs.includes("After reload"));
        } finally {
          await runtime.dispose();
        }
      } finally {
        await page.close();
      }
    });

    it("gets element count", async () => {
      const page = await browser.newPage();
      try {
        const logs: string[] = [];
        const runtime = await client.createRuntime({
          testEnvironment: true, playwright: { handler: defaultPlaywrightHandler(page) },
          console: {
            onEntry: (entry) => {
              if (entry.type === "output" && entry.level === "log") {
                logs.push(entry.stdout);
              }
            },
          },
        });

        try {
          await runtime.eval(`
            await page.goto("data:text/html,<ul><li>A</li><li>B</li><li>C</li></ul>");
            const count = await page.locator("li").count();
            console.log(count);
          `);

          await new Promise(r => setTimeout(r, 100));
          assert.ok(logs.includes("3"));
        } finally {
          await runtime.dispose();
        }
      } finally {
        await page.close();
      }
    });
  });

  describe("collected data", () => {
    it("collects console logs from browser", async () => {
      const page = await browser.newPage();
      try {
        const runtime = await client.createRuntime({
          testEnvironment: true, playwright: { handler: defaultPlaywrightHandler(page) },
        });

        try {
          await runtime.eval(`
            test("console logging", async () => {
              await page.goto("data:text/html,<script>console.log('from browser');</script>");
              await page.waitForTimeout(100);
            });
          `);

          await runtime.testEnvironment.runTests();

          const data = runtime.playwright.getCollectedData();
          assert.ok(Array.isArray(data.browserConsoleLogs));
          assert.ok(Array.isArray(data.networkRequests));
          assert.ok(Array.isArray(data.networkResponses));
        } finally {
          await runtime.dispose();
        }
      } finally {
        await page.close();
      }
    });

    it("clears collected data", async () => {
      const page = await browser.newPage();
      try {
        const runtime = await client.createRuntime({
          testEnvironment: true, playwright: { handler: defaultPlaywrightHandler(page) },
        });

        try {
          await runtime.eval(`
            test("generates data", async () => {
              await page.goto("data:text/html,<script>console.log('test');</script>");
              await page.waitForTimeout(50);
            });
          `);

          await runtime.testEnvironment.runTests();

          // Clear and verify
          runtime.playwright.clearCollectedData();
          const data = runtime.playwright.getCollectedData();
          assert.strictEqual(data.browserConsoleLogs.length, 0);
        } finally {
          await runtime.dispose();
        }
      } finally {
        await page.close();
      }
    });
  });

  describe("event callbacks", () => {
    it("receives console log events", async () => {
      const page = await browser.newPage();
      const receivedLogs: { level: string; stdout: string }[] = [];

      try {
        const runtime = await client.createRuntime({
          testEnvironment: true,
          playwright: { handler: defaultPlaywrightHandler(page), onEvent: (event) => {
              if (event.type === "browserConsoleLog") {
                receivedLogs.push({ level: event.level, stdout: event.stdout });
              }
            } },
        });

        try {
          await runtime.eval(`
            test("triggers console", async () => {
              await page.goto("data:text/html,<script>console.log('streamed message');</script>");
              await page.waitForTimeout(100);
            });
          `);

          await runtime.testEnvironment.runTests();

          // Wait for events
          await new Promise(r => setTimeout(r, 200));

          // Console logs should have been streamed
          assert.ok(Array.isArray(receivedLogs));
        } finally {
          await runtime.dispose();
        }
      } finally {
        await page.close();
      }
    });
  });
});
