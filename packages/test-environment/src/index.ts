import type ivm from "isolated-vm";

export interface TestEnvironmentHandle {
  dispose(): void;
}

export interface TestResults {
  passed: number;
  failed: number;
  total: number;
  results: TestResult[];
}

export interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
  duration: number;
  skipped?: boolean;
}

const testEnvironmentCode = `
(function() {
  // ============================================================
  // Internal State
  // ============================================================

  function createSuite(name, skip = false, only = false) {
    return {
      name,
      tests: [],
      children: [],
      beforeAll: [],
      afterAll: [],
      beforeEach: [],
      afterEach: [],
      skip,
      only,
    };
  }

  const rootSuite = createSuite('root');
  let currentSuite = rootSuite;
  const suiteStack = [rootSuite];

  // ============================================================
  // Deep Equality Helper
  // ============================================================

  function deepEqual(a, b) {
    if (a === b) return true;
    if (typeof a !== typeof b) return false;
    if (typeof a !== 'object' || a === null || b === null) return false;

    if (Array.isArray(a) !== Array.isArray(b)) return false;

    const keysA = Object.keys(a);
    const keysB = Object.keys(b);
    if (keysA.length !== keysB.length) return false;

    for (const key of keysA) {
      if (!keysB.includes(key)) return false;
      if (!deepEqual(a[key], b[key])) return false;
    }
    return true;
  }

  function strictDeepEqual(a, b) {
    if (a === b) return true;
    if (typeof a !== typeof b) return false;
    if (typeof a !== 'object' || a === null || b === null) return false;

    // Check prototypes
    if (Object.getPrototypeOf(a) !== Object.getPrototypeOf(b)) return false;

    if (Array.isArray(a) !== Array.isArray(b)) return false;

    // For arrays, check sparse arrays (holes)
    if (Array.isArray(a)) {
      if (a.length !== b.length) return false;
      for (let i = 0; i < a.length; i++) {
        const aHasIndex = i in a;
        const bHasIndex = i in b;
        if (aHasIndex !== bHasIndex) return false;
        if (aHasIndex && !strictDeepEqual(a[i], b[i])) return false;
      }
      return true;
    }

    // Check for undefined properties vs missing properties
    const keysA = Object.keys(a);
    const keysB = Object.keys(b);
    if (keysA.length !== keysB.length) return false;

    for (const key of keysA) {
      if (!keysB.includes(key)) return false;
      if (!strictDeepEqual(a[key], b[key])) return false;
    }

    // Check for symbol properties
    const symbolsA = Object.getOwnPropertySymbols(a);
    const symbolsB = Object.getOwnPropertySymbols(b);
    if (symbolsA.length !== symbolsB.length) return false;

    for (const sym of symbolsA) {
      if (!symbolsB.includes(sym)) return false;
      if (!strictDeepEqual(a[sym], b[sym])) return false;
    }

    return true;
  }

  function getNestedProperty(obj, path) {
    const parts = path.split('.');
    let current = obj;
    for (const part of parts) {
      if (current == null || !(part in current)) {
        return { exists: false };
      }
      current = current[part];
    }
    return { exists: true, value: current };
  }

  function formatValue(val) {
    if (val === null) return 'null';
    if (val === undefined) return 'undefined';
    if (typeof val === 'string') return JSON.stringify(val);
    if (typeof val === 'object') {
      try {
        return JSON.stringify(val);
      } catch {
        return String(val);
      }
    }
    return String(val);
  }

  // ============================================================
  // expect() Implementation
  // ============================================================

  function expect(actual) {
    function createMatchers(negated = false) {
      const assert = (condition, message) => {
        const pass = negated ? !condition : condition;
        if (!pass) {
          throw new Error(message);
        }
      };

      const matchers = {
        toBe(expected) {
          assert(
            actual === expected,
            negated
              ? \`Expected \${formatValue(actual)} not to be \${formatValue(expected)}\`
              : \`Expected \${formatValue(actual)} to be \${formatValue(expected)}\`
          );
        },

        toEqual(expected) {
          assert(
            deepEqual(actual, expected),
            negated
              ? \`Expected \${formatValue(actual)} not to equal \${formatValue(expected)}\`
              : \`Expected \${formatValue(actual)} to equal \${formatValue(expected)}\`
          );
        },

        toStrictEqual(expected) {
          assert(
            strictDeepEqual(actual, expected),
            negated
              ? \`Expected \${formatValue(actual)} not to strictly equal \${formatValue(expected)}\`
              : \`Expected \${formatValue(actual)} to strictly equal \${formatValue(expected)}\`
          );
        },

        toBeTruthy() {
          assert(
            !!actual,
            negated
              ? \`Expected \${formatValue(actual)} not to be truthy\`
              : \`Expected \${formatValue(actual)} to be truthy\`
          );
        },

        toBeFalsy() {
          assert(
            !actual,
            negated
              ? \`Expected \${formatValue(actual)} not to be falsy\`
              : \`Expected \${formatValue(actual)} to be falsy\`
          );
        },

        toBeNull() {
          assert(
            actual === null,
            negated
              ? \`Expected \${formatValue(actual)} not to be null\`
              : \`Expected \${formatValue(actual)} to be null\`
          );
        },

        toBeUndefined() {
          assert(
            actual === undefined,
            negated
              ? \`Expected \${formatValue(actual)} not to be undefined\`
              : \`Expected \${formatValue(actual)} to be undefined\`
          );
        },

        toBeDefined() {
          assert(
            actual !== undefined,
            negated
              ? \`Expected \${formatValue(actual)} not to be defined\`
              : \`Expected \${formatValue(actual)} to be defined\`
          );
        },

        toContain(item) {
          let contains = false;
          if (Array.isArray(actual)) {
            contains = actual.includes(item);
          } else if (typeof actual === 'string') {
            contains = actual.includes(item);
          }
          assert(
            contains,
            negated
              ? \`Expected \${formatValue(actual)} not to contain \${formatValue(item)}\`
              : \`Expected \${formatValue(actual)} to contain \${formatValue(item)}\`
          );
        },

        toThrow(expected) {
          if (typeof actual !== 'function') {
            throw new Error('toThrow requires a function');
          }

          let threw = false;
          let error = null;
          try {
            actual();
          } catch (e) {
            threw = true;
            error = e;
          }

          if (expected !== undefined) {
            const matches = threw && (
              (typeof expected === 'string' && error.message.includes(expected)) ||
              (expected instanceof RegExp && expected.test(error.message)) ||
              (typeof expected === 'function' && error instanceof expected)
            );
            assert(
              matches,
              negated
                ? \`Expected function not to throw \${formatValue(expected)}\`
                : \`Expected function to throw \${formatValue(expected)}, but \${threw ? \`threw: \${error.message}\` : 'did not throw'}\`
            );
          } else {
            assert(
              threw,
              negated
                ? \`Expected function not to throw\`
                : \`Expected function to throw\`
            );
          }
        },

        toBeInstanceOf(cls) {
          assert(
            actual instanceof cls,
            negated
              ? \`Expected \${formatValue(actual)} not to be instance of \${cls.name || cls}\`
              : \`Expected \${formatValue(actual)} to be instance of \${cls.name || cls}\`
          );
        },

        toHaveLength(length) {
          const actualLength = actual?.length;
          assert(
            actualLength === length,
            negated
              ? \`Expected length not to be \${length}, but got \${actualLength}\`
              : \`Expected length to be \${length}, but got \${actualLength}\`
          );
        },

        toMatch(pattern) {
          let matches = false;
          if (typeof pattern === 'string') {
            matches = actual.includes(pattern);
          } else if (pattern instanceof RegExp) {
            matches = pattern.test(actual);
          }
          assert(
            matches,
            negated
              ? \`Expected \${formatValue(actual)} not to match \${pattern}\`
              : \`Expected \${formatValue(actual)} to match \${pattern}\`
          );
        },

        toHaveProperty(path, value) {
          const prop = getNestedProperty(actual, path);
          const hasProperty = prop.exists;
          const valueMatches = arguments.length < 2 || deepEqual(prop.value, value);

          assert(
            hasProperty && valueMatches,
            negated
              ? \`Expected \${formatValue(actual)} not to have property \${path}\${arguments.length >= 2 ? \` with value \${formatValue(value)}\` : ''}\`
              : \`Expected \${formatValue(actual)} to have property \${path}\${arguments.length >= 2 ? \` with value \${formatValue(value)}\` : ''}\`
          );
        },
      };

      return matchers;
    }

    const matchers = createMatchers(false);
    matchers.not = createMatchers(true);

    return matchers;
  }

  // ============================================================
  // Test Registration Functions
  // ============================================================

  function describe(name, fn) {
    const suite = createSuite(name);
    currentSuite.children.push(suite);

    const parentSuite = currentSuite;
    currentSuite = suite;
    suiteStack.push(suite);

    fn();

    suiteStack.pop();
    currentSuite = parentSuite;
  }

  describe.skip = function(name, fn) {
    const suite = createSuite(name, true, false);
    currentSuite.children.push(suite);

    const parentSuite = currentSuite;
    currentSuite = suite;
    suiteStack.push(suite);

    fn();

    suiteStack.pop();
    currentSuite = parentSuite;
  };

  describe.only = function(name, fn) {
    const suite = createSuite(name, false, true);
    currentSuite.children.push(suite);

    const parentSuite = currentSuite;
    currentSuite = suite;
    suiteStack.push(suite);

    fn();

    suiteStack.pop();
    currentSuite = parentSuite;
  };

  function test(name, fn) {
    currentSuite.tests.push({
      name,
      fn,
      skip: false,
      only: false,
    });
  }

  test.skip = function(name, fn) {
    currentSuite.tests.push({
      name,
      fn,
      skip: true,
      only: false,
    });
  };

  test.only = function(name, fn) {
    currentSuite.tests.push({
      name,
      fn,
      skip: false,
      only: true,
    });
  };

  const it = test;
  it.skip = test.skip;
  it.only = test.only;

  // ============================================================
  // Lifecycle Hooks
  // ============================================================

  function beforeEach(fn) {
    currentSuite.beforeEach.push(fn);
  }

  function afterEach(fn) {
    currentSuite.afterEach.push(fn);
  }

  function beforeAll(fn) {
    currentSuite.beforeAll.push(fn);
  }

  function afterAll(fn) {
    currentSuite.afterAll.push(fn);
  }

  // ============================================================
  // Test Runner
  // ============================================================

  function checkForOnly(suite) {
    if (suite.only) return true;
    for (const t of suite.tests) {
      if (t.only) return true;
    }
    for (const child of suite.children) {
      if (checkForOnly(child)) return true;
    }
    return false;
  }

  function suiteHasOnly(suite) {
    if (suite.only) return true;
    for (const t of suite.tests) {
      if (t.only) return true;
    }
    for (const child of suite.children) {
      if (suiteHasOnly(child)) return true;
    }
    return false;
  }

  async function __runAllTests() {
    const results = [];
    const hasOnly = checkForOnly(rootSuite);

    async function runSuite(suite, parentHooks, namePath) {
      // Skip if this suite doesn't have any .only when .only exists elsewhere
      if (hasOnly && !suiteHasOnly(suite)) return;

      // Skip if suite is marked as skip
      if (suite.skip) {
        // Mark all tests in this suite as skipped
        for (const t of suite.tests) {
          results.push({
            name: namePath ? namePath + ' > ' + t.name : t.name,
            passed: true,
            skipped: true,
            duration: 0,
          });
        }
        return;
      }

      // Run beforeAll hooks
      for (const hook of suite.beforeAll) {
        await hook();
      }

      // Run tests
      for (const t of suite.tests) {
        const testName = namePath ? namePath + ' > ' + t.name : t.name;

        // Skip if .only is used and this test isn't .only
        if (hasOnly && !t.only) continue;

        // Skip if test is marked as skip
        if (t.skip) {
          results.push({
            name: testName,
            passed: true,
            skipped: true,
            duration: 0,
          });
          continue;
        }

        const start = Date.now();
        try {
          // Run all beforeEach hooks (parent first, then current)
          for (const hook of [...parentHooks.beforeEach, ...suite.beforeEach]) {
            await hook();
          }

          // Run test
          await t.fn();

          // Run all afterEach hooks (current first, then parent)
          for (const hook of [...suite.afterEach, ...parentHooks.afterEach]) {
            await hook();
          }

          results.push({
            name: testName,
            passed: true,
            duration: Date.now() - start,
          });
        } catch (err) {
          results.push({
            name: testName,
            passed: false,
            error: err.message || String(err),
            duration: Date.now() - start,
          });
        }
      }

      // Run child suites
      for (const child of suite.children) {
        const childPath = namePath ? namePath + ' > ' + child.name : child.name;
        await runSuite(child, {
          beforeEach: [...parentHooks.beforeEach, ...suite.beforeEach],
          afterEach: [...suite.afterEach, ...parentHooks.afterEach],
        }, childPath);
      }

      // Run afterAll hooks
      for (const hook of suite.afterAll) {
        await hook();
      }
    }

    await runSuite(rootSuite, { beforeEach: [], afterEach: [] }, '');

    const passed = results.filter(r => r.passed && !r.skipped).length;
    const failed = results.filter(r => !r.passed).length;
    const skipped = results.filter(r => r.skipped).length;

    return JSON.stringify({
      passed,
      failed,
      skipped,
      total: results.length,
      results,
    });
  }

  // Reset function to clear state between runs
  function __resetTestEnvironment() {
    rootSuite.tests = [];
    rootSuite.children = [];
    rootSuite.beforeAll = [];
    rootSuite.afterAll = [];
    rootSuite.beforeEach = [];
    rootSuite.afterEach = [];
    currentSuite = rootSuite;
    suiteStack.length = 0;
    suiteStack.push(rootSuite);
  }

  // ============================================================
  // Expose Globals
  // ============================================================

  globalThis.describe = describe;
  globalThis.test = test;
  globalThis.it = it;
  globalThis.expect = expect;
  globalThis.beforeEach = beforeEach;
  globalThis.afterEach = afterEach;
  globalThis.beforeAll = beforeAll;
  globalThis.afterAll = afterAll;
  globalThis.__runAllTests = __runAllTests;
  globalThis.__resetTestEnvironment = __resetTestEnvironment;
})();
`;

/**
 * Setup test environment primitives in an isolated-vm context
 *
 * Provides Jest/Vitest-compatible test primitives:
 * - describe, test, it
 * - beforeEach, afterEach, beforeAll, afterAll
 * - expect matchers
 *
 * @example
 * const handle = await setupTestEnvironment(context);
 *
 * await context.eval(`
 *   describe("my tests", () => {
 *     test("example", () => {
 *       expect(1 + 1).toBe(2);
 *     });
 *   });
 * `);
 */
export async function setupTestEnvironment(
  context: ivm.Context
): Promise<TestEnvironmentHandle> {
  context.evalSync(testEnvironmentCode);

  return {
    dispose() {
      // Reset the test environment state
      try {
        context.evalSync("__resetTestEnvironment()");
      } catch {
        // Context may already be released
      }
    },
  };
}

/**
 * Run tests in the context and return results
 */
export async function runTests(context: ivm.Context): Promise<TestResults> {
  const resultJson = await context.eval("__runAllTests()", { promise: true });
  return JSON.parse(resultJson as string);
}
