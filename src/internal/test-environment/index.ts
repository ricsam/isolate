import type ivm from "isolated-vm";
import IsolatedVM from "isolated-vm";

// ============================================================
// Test Environment Options
// ============================================================

export interface TestEnvironmentOptions {
  /** Receive test lifecycle events */
  onEvent?: (event: TestEvent) => void;
  /** Timeout for individual tests (ms) */
  testTimeout?: number;
}

// ============================================================
// Event Types (discriminated union)
// ============================================================

export type TestEvent =
  | { type: "runStart"; testCount: number; suiteCount: number }
  | { type: "suiteStart"; suite: SuiteInfo }
  | { type: "suiteEnd"; suite: SuiteResult }
  | { type: "testStart"; test: TestInfo }
  | { type: "testEnd"; test: TestResult }
  | { type: "runEnd"; results: RunResults };

// ============================================================
// Suite Types
// ============================================================

export interface SuiteInfo {
  name: string;
  /** Ancestry path: ["outer", "inner"] */
  path: string[];
  /** Full display name: "outer > inner" */
  fullName: string;
  /** Nesting depth (0 for root-level suites) */
  depth: number;
}

export interface SuiteResult extends SuiteInfo {
  passed: number;
  failed: number;
  skipped: number;
  todo: number;
  duration: number;
}

// ============================================================
// Test Types
// ============================================================

export interface TestInfo {
  name: string;
  /** Suite ancestry */
  suitePath: string[];
  /** Full display name: "suite > test name" */
  fullName: string;
}

export interface TestResult extends TestInfo {
  status: "pass" | "fail" | "skip" | "todo";
  duration: number;
  error?: TestError;
}

export interface TestError {
  message: string;
  stack?: string;
  /** For assertion failures */
  expected?: unknown;
  actual?: unknown;
  /** e.g., "toBe", "toEqual", "toContain" */
  matcherName?: string;
}

// ============================================================
// Run Results
// ============================================================

export interface RunResults {
  passed: number;
  failed: number;
  skipped: number;
  todo: number;
  total: number;
  duration: number;
  success: boolean;
  suites: SuiteResult[];
  tests: TestResult[];
}

// ============================================================
// Handle Interface
// ============================================================

export interface TestEnvironmentHandle {
  dispose(): void;
}

const testEnvironmentCode = `
(function() {
  // ============================================================
  // Internal State
  // ============================================================

  // Mock registry and call counter
  let __mockCallOrder = 0;
  const __mockRegistry = [];

  // Assertion counting state
  let __expectedAssertions = null;
  let __assertionCount = 0;
  let __hasAssertionsFlag = false;

  function createMockState() {
    return {
      calls: [],
      results: [],
      contexts: [],
      instances: [],
      invocationCallOrder: [],
      lastCall: undefined,
    };
  }

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

  // Event callback (set from host)
  let eventCallback = null;

  function emitEvent(event) {
    if (eventCallback) {
      try {
        eventCallback(JSON.stringify(event));
      } catch (e) {
        // Ignore callback errors
      }
    }
  }

  // ============================================================
  // TestError class for rich error info
  // ============================================================

  class TestError extends Error {
    constructor(message, matcherName, expected, actual) {
      super(message);
      this.name = 'TestError';
      this.matcherName = matcherName;
      this.expected = expected;
      this.actual = actual;
    }
  }

  // ============================================================
  // Asymmetric Matcher Infrastructure
  // ============================================================

  const ASYMMETRIC_MATCHER = Symbol('asymmetricMatcher');

  function isAsymmetricMatcher(obj) {
    return obj && obj[ASYMMETRIC_MATCHER] === true;
  }

  // Deep equality with asymmetric matcher support
  function asymmetricDeepEqual(a, b) {
    if (isAsymmetricMatcher(b)) return b.asymmetricMatch(a);
    if (isAsymmetricMatcher(a)) return a.asymmetricMatch(b);
    if (a === b) return true;
    if (typeof a !== typeof b) return false;
    if (typeof a !== 'object' || a === null || b === null) return false;
    if (Array.isArray(a) !== Array.isArray(b)) return false;
    const keysA = Object.keys(a);
    const keysB = Object.keys(b);
    if (keysA.length !== keysB.length) return false;
    for (const key of keysA) {
      if (!keysB.includes(key)) return false;
      if (!asymmetricDeepEqual(a[key], b[key])) return false;
    }
    return true;
  }

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
      const assert = (condition, message, matcherName, expected) => {
        __assertionCount++;
        const pass = negated ? !condition : condition;
        if (!pass) {
          throw new TestError(message, matcherName, expected, actual);
        }
      };

      const matchers = {
        toBe(expected) {
          assert(
            actual === expected,
            negated
              ? \`Expected \${formatValue(actual)} not to be \${formatValue(expected)}\`
              : \`Expected \${formatValue(actual)} to be \${formatValue(expected)}\`,
            'toBe',
            expected
          );
        },

        toEqual(expected) {
          assert(
            asymmetricDeepEqual(actual, expected),
            negated
              ? \`Expected \${formatValue(actual)} not to equal \${formatValue(expected)}\`
              : \`Expected \${formatValue(actual)} to equal \${formatValue(expected)}\`,
            'toEqual',
            expected
          );
        },

        toStrictEqual(expected) {
          assert(
            strictDeepEqual(actual, expected),
            negated
              ? \`Expected \${formatValue(actual)} not to strictly equal \${formatValue(expected)}\`
              : \`Expected \${formatValue(actual)} to strictly equal \${formatValue(expected)}\`,
            'toStrictEqual',
            expected
          );
        },

        toBeTruthy() {
          assert(
            !!actual,
            negated
              ? \`Expected \${formatValue(actual)} not to be truthy\`
              : \`Expected \${formatValue(actual)} to be truthy\`,
            'toBeTruthy',
            true
          );
        },

        toBeFalsy() {
          assert(
            !actual,
            negated
              ? \`Expected \${formatValue(actual)} not to be falsy\`
              : \`Expected \${formatValue(actual)} to be falsy\`,
            'toBeFalsy',
            false
          );
        },

        toBeNull() {
          assert(
            actual === null,
            negated
              ? \`Expected \${formatValue(actual)} not to be null\`
              : \`Expected \${formatValue(actual)} to be null\`,
            'toBeNull',
            null
          );
        },

        toBeUndefined() {
          assert(
            actual === undefined,
            negated
              ? \`Expected \${formatValue(actual)} not to be undefined\`
              : \`Expected \${formatValue(actual)} to be undefined\`,
            'toBeUndefined',
            undefined
          );
        },

        toBeDefined() {
          assert(
            actual !== undefined,
            negated
              ? \`Expected \${formatValue(actual)} not to be defined\`
              : \`Expected \${formatValue(actual)} to be defined\`,
            'toBeDefined',
            'defined'
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
              : \`Expected \${formatValue(actual)} to contain \${formatValue(item)}\`,
            'toContain',
            item
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
                : \`Expected function to throw \${formatValue(expected)}, but \${threw ? \`threw: \${error.message}\` : 'did not throw'}\`,
              'toThrow',
              expected
            );
          } else {
            assert(
              threw,
              negated
                ? \`Expected function not to throw\`
                : \`Expected function to throw\`,
              'toThrow',
              'any error'
            );
          }
        },

        toBeInstanceOf(cls) {
          assert(
            actual instanceof cls,
            negated
              ? \`Expected \${formatValue(actual)} not to be instance of \${cls.name || cls}\`
              : \`Expected \${formatValue(actual)} to be instance of \${cls.name || cls}\`,
            'toBeInstanceOf',
            cls.name || cls
          );
        },

        toHaveLength(length) {
          const actualLength = actual?.length;
          assert(
            actualLength === length,
            negated
              ? \`Expected length not to be \${length}, but got \${actualLength}\`
              : \`Expected length to be \${length}, but got \${actualLength}\`,
            'toHaveLength',
            length
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
              : \`Expected \${formatValue(actual)} to match \${pattern}\`,
            'toMatch',
            pattern
          );
        },

        toHaveProperty(path, value) {
          const prop = getNestedProperty(actual, path);
          const hasProperty = prop.exists;
          const valueMatches = arguments.length < 2 || asymmetricDeepEqual(prop.value, value);

          assert(
            hasProperty && valueMatches,
            negated
              ? \`Expected \${formatValue(actual)} not to have property \${path}\${arguments.length >= 2 ? \` with value \${formatValue(value)}\` : ''}\`
              : \`Expected \${formatValue(actual)} to have property \${path}\${arguments.length >= 2 ? \` with value \${formatValue(value)}\` : ''}\`,
            'toHaveProperty',
            arguments.length >= 2 ? { path, value } : { path }
          );
        },

        toBeGreaterThan(expected) {
          assert(
            actual > expected,
            negated
              ? \`Expected \${formatValue(actual)} not to be greater than \${formatValue(expected)}\`
              : \`Expected \${formatValue(actual)} to be greater than \${formatValue(expected)}\`,
            'toBeGreaterThan',
            expected
          );
        },

        toBeGreaterThanOrEqual(expected) {
          assert(
            actual >= expected,
            negated
              ? \`Expected \${formatValue(actual)} not to be greater than or equal to \${formatValue(expected)}\`
              : \`Expected \${formatValue(actual)} to be greater than or equal to \${formatValue(expected)}\`,
            'toBeGreaterThanOrEqual',
            expected
          );
        },

        toBeLessThan(expected) {
          assert(
            actual < expected,
            negated
              ? \`Expected \${formatValue(actual)} not to be less than \${formatValue(expected)}\`
              : \`Expected \${formatValue(actual)} to be less than \${formatValue(expected)}\`,
            'toBeLessThan',
            expected
          );
        },

        toBeLessThanOrEqual(expected) {
          assert(
            actual <= expected,
            negated
              ? \`Expected \${formatValue(actual)} not to be less than or equal to \${formatValue(expected)}\`
              : \`Expected \${formatValue(actual)} to be less than or equal to \${formatValue(expected)}\`,
            'toBeLessThanOrEqual',
            expected
          );
        },

        toBeCloseTo(expected, numDigits = 2) {
          const precision = Math.pow(10, -numDigits) / 2;
          const pass = Math.abs(actual - expected) < precision;
          assert(
            pass,
            negated
              ? \`Expected \${formatValue(actual)} not to be close to \${formatValue(expected)} (precision: \${numDigits} digits)\`
              : \`Expected \${formatValue(actual)} to be close to \${formatValue(expected)} (precision: \${numDigits} digits)\`,
            'toBeCloseTo',
            expected
          );
        },

        toBeNaN() {
          assert(
            Number.isNaN(actual),
            negated
              ? \`Expected \${formatValue(actual)} not to be NaN\`
              : \`Expected \${formatValue(actual)} to be NaN\`,
            'toBeNaN',
            NaN
          );
        },

        toMatchObject(expected) {
          function matchesObject(obj, pattern) {
            if (isAsymmetricMatcher(pattern)) return pattern.asymmetricMatch(obj);
            if (typeof pattern !== 'object' || pattern === null) return obj === pattern;
            if (typeof obj !== 'object' || obj === null) return false;
            for (const key of Object.keys(pattern)) {
              if (!(key in obj)) return false;
              if (!matchesObject(obj[key], pattern[key])) return false;
            }
            return true;
          }
          assert(
            matchesObject(actual, expected),
            negated
              ? \`Expected \${formatValue(actual)} not to match object \${formatValue(expected)}\`
              : \`Expected \${formatValue(actual)} to match object \${formatValue(expected)}\`,
            'toMatchObject',
            expected
          );
        },

        toContainEqual(item) {
          const contains = Array.isArray(actual) && actual.some(el => asymmetricDeepEqual(el, item));
          assert(
            contains,
            negated
              ? \`Expected array not to contain equal \${formatValue(item)}\`
              : \`Expected array to contain equal \${formatValue(item)}\`,
            'toContainEqual',
            item
          );
        },

        toBeTypeOf(expectedType) {
          const actualType = typeof actual;
          assert(
            actualType === expectedType,
            negated
              ? \`Expected typeof \${formatValue(actual)} not to be "\${expectedType}"\`
              : \`Expected typeof \${formatValue(actual)} to be "\${expectedType}", got "\${actualType}"\`,
            'toBeTypeOf',
            expectedType
          );
        },

        // Mock matchers
        toHaveBeenCalled() {
          if (!actual.__isMockFunction) throw new Error('toHaveBeenCalled requires a mock function');
          assert(actual.mock.calls.length > 0,
            negated ? \`Expected mock not to have been called\` : \`Expected mock to have been called\`,
            'toHaveBeenCalled', 'called');
        },

        toHaveBeenCalledTimes(n) {
          if (!actual.__isMockFunction) throw new Error('toHaveBeenCalledTimes requires a mock function');
          assert(actual.mock.calls.length === n,
            negated ? \`Expected mock not to have been called \${n} times\`
                    : \`Expected mock to be called \${n} times, got \${actual.mock.calls.length}\`,
            'toHaveBeenCalledTimes', n);
        },

        toHaveBeenCalledWith(...expectedArgs) {
          if (!actual.__isMockFunction) throw new Error('toHaveBeenCalledWith requires a mock function');
          const match = actual.mock.calls.some(args => asymmetricDeepEqual(args, expectedArgs));
          assert(match,
            negated ? \`Expected mock not to have been called with \${formatValue(expectedArgs)}\`
                    : \`Expected mock to have been called with \${formatValue(expectedArgs)}\`,
            'toHaveBeenCalledWith', expectedArgs);
        },

        toHaveBeenLastCalledWith(...expectedArgs) {
          if (!actual.__isMockFunction) throw new Error('toHaveBeenLastCalledWith requires a mock function');
          assert(actual.mock.lastCall && asymmetricDeepEqual(actual.mock.lastCall, expectedArgs),
            negated ? \`Expected last call not to be \${formatValue(expectedArgs)}\`
                    : \`Expected last call to be \${formatValue(expectedArgs)}, got \${formatValue(actual.mock.lastCall)}\`,
            'toHaveBeenLastCalledWith', expectedArgs);
        },

        toHaveBeenNthCalledWith(n, ...expectedArgs) {
          if (!actual.__isMockFunction) throw new Error('toHaveBeenNthCalledWith requires a mock function');
          const nthCall = actual.mock.calls[n - 1];
          assert(nthCall && asymmetricDeepEqual(nthCall, expectedArgs),
            negated ? \`Expected call \${n} not to be \${formatValue(expectedArgs)}\`
                    : \`Expected call \${n} to be \${formatValue(expectedArgs)}, got \${formatValue(nthCall)}\`,
            'toHaveBeenNthCalledWith', expectedArgs);
        },

        toHaveReturned() {
          if (!actual.__isMockFunction) throw new Error('toHaveReturned requires a mock function');
          const hasReturned = actual.mock.results.some(r => r.type === 'return');
          assert(hasReturned,
            negated ? \`Expected mock not to have returned\` : \`Expected mock to have returned\`,
            'toHaveReturned', 'returned');
        },

        toHaveReturnedWith(value) {
          if (!actual.__isMockFunction) throw new Error('toHaveReturnedWith requires a mock function');
          const match = actual.mock.results.some(r => r.type === 'return' && asymmetricDeepEqual(r.value, value));
          assert(match,
            negated ? \`Expected mock not to have returned \${formatValue(value)}\`
                    : \`Expected mock to have returned \${formatValue(value)}\`,
            'toHaveReturnedWith', value);
        },

        toHaveLastReturnedWith(value) {
          if (!actual.__isMockFunction) throw new Error('toHaveLastReturnedWith requires a mock function');
          const returns = actual.mock.results.filter(r => r.type === 'return');
          const last = returns[returns.length - 1];
          assert(last && asymmetricDeepEqual(last.value, value),
            negated ? \`Expected last return not to be \${formatValue(value)}\`
                    : \`Expected last return to be \${formatValue(value)}, got \${formatValue(last?.value)}\`,
            'toHaveLastReturnedWith', value);
        },

        toHaveReturnedTimes(n) {
          if (!actual.__isMockFunction) throw new Error('toHaveReturnedTimes requires a mock function');
          const returnCount = actual.mock.results.filter(r => r.type === 'return').length;
          assert(returnCount === n,
            negated ? \`Expected mock not to have returned \${n} times\`
                    : \`Expected mock to have returned \${n} times, got \${returnCount}\`,
            'toHaveReturnedTimes', n);
        },

        toHaveNthReturnedWith(n, value) {
          if (!actual.__isMockFunction) throw new Error('toHaveNthReturnedWith requires a mock function');
          const returns = actual.mock.results.filter(r => r.type === 'return');
          const nthReturn = returns[n - 1];
          assert(nthReturn && asymmetricDeepEqual(nthReturn.value, value),
            negated ? \`Expected return \${n} not to be \${formatValue(value)}\`
                    : \`Expected return \${n} to be \${formatValue(value)}, got \${formatValue(nthReturn?.value)}\`,
            'toHaveNthReturnedWith', value);
        },
      };

      return matchers;
    }

    const matchers = createMatchers(false);
    matchers.not = createMatchers(true);

    // Promise matchers using Proxy
    matchers.resolves = new Proxy({}, {
      get(_, matcherName) {
        if (matcherName === 'not') {
          return new Proxy({}, {
            get(_, negatedMatcherName) {
              return async (...args) => {
                const result = await actual;
                return expect(result).not[negatedMatcherName](...args);
              };
            }
          });
        }
        return async (...args) => {
          const result = await actual;
          return expect(result)[matcherName](...args);
        };
      }
    });

    matchers.rejects = new Proxy({}, {
      get(_, matcherName) {
        if (matcherName === 'not') {
          return new Proxy({}, {
            get(_, negatedMatcherName) {
              return async (...args) => {
                let error;
                try {
                  await actual;
                  throw new TestError('Expected promise to reject', 'rejects', 'rejection', undefined);
                } catch (e) {
                  if (e instanceof TestError && e.matcherName === 'rejects') throw e;
                  error = e;
                }
                return expect(error).not[negatedMatcherName](...args);
              };
            }
          });
        }
        return async (...args) => {
          let error;
          try {
            await actual;
            throw new TestError('Expected promise to reject', 'rejects', 'rejection', undefined);
          } catch (e) {
            if (e instanceof TestError && e.matcherName === 'rejects') throw e;
            error = e;
          }
          return expect(error)[matcherName](...args);
        };
      }
    });

    return matchers;
  }

  // Asymmetric matcher implementations
  expect.anything = () => ({
    [ASYMMETRIC_MATCHER]: true,
    asymmetricMatch: (other) => other !== null && other !== undefined,
    toString: () => 'anything()',
  });

  expect.any = (constructor) => ({
    [ASYMMETRIC_MATCHER]: true,
    asymmetricMatch: (other) => {
      if (constructor === String) return typeof other === 'string' || other instanceof String;
      if (constructor === Number) return typeof other === 'number' || other instanceof Number;
      if (constructor === Boolean) return typeof other === 'boolean' || other instanceof Boolean;
      if (constructor === Function) return typeof other === 'function';
      if (constructor === Object) return typeof other === 'object' && other !== null;
      if (constructor === Array) return Array.isArray(other);
      return other instanceof constructor;
    },
    toString: () => \`any(\${constructor.name || constructor})\`,
  });

  expect.stringContaining = (str) => ({
    [ASYMMETRIC_MATCHER]: true,
    asymmetricMatch: (other) => typeof other === 'string' && other.includes(str),
    toString: () => \`stringContaining("\${str}")\`,
  });

  expect.stringMatching = (pattern) => ({
    [ASYMMETRIC_MATCHER]: true,
    asymmetricMatch: (other) => {
      if (typeof other !== 'string') return false;
      return typeof pattern === 'string' ? other.includes(pattern) : pattern.test(other);
    },
    toString: () => \`stringMatching(\${pattern})\`,
  });

  expect.arrayContaining = (expected) => ({
    [ASYMMETRIC_MATCHER]: true,
    asymmetricMatch: (other) => {
      if (!Array.isArray(other)) return false;
      return expected.every(exp => other.some(item => asymmetricDeepEqual(item, exp)));
    },
    toString: () => \`arrayContaining(\${formatValue(expected)})\`,
  });

  expect.objectContaining = (expected) => ({
    [ASYMMETRIC_MATCHER]: true,
    asymmetricMatch: (other) => {
      if (typeof other !== 'object' || other === null) return false;
      for (const key of Object.keys(expected)) {
        if (!(key in other)) return false;
        if (!asymmetricDeepEqual(other[key], expected[key])) return false;
      }
      return true;
    },
    toString: () => \`objectContaining(\${formatValue(expected)})\`,
  });

  // Assertion counting
  expect.assertions = (n) => {
    __expectedAssertions = n;
  };

  expect.hasAssertions = () => {
    __hasAssertionsFlag = true;
  };

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

  test.todo = function(name) {
    currentSuite.tests.push({
      name,
      fn: null,
      skip: false,
      only: false,
      todo: true,
    });
  };

  const it = test;
  it.skip = test.skip;
  it.only = test.only;
  it.todo = test.todo;

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
  // Mock Implementation
  // ============================================================

  const mock = {
    fn(implementation) {
      const mockState = createMockState();
      let defaultImpl = implementation;
      const onceImpls = [];
      const onceReturns = [];
      let returnVal, resolvedVal, rejectedVal;
      let returnSet = false, resolvedSet = false, rejectedSet = false;

      function mockFn(...args) {
        mockState.calls.push(args);
        mockState.contexts.push(this);
        mockState.lastCall = args;
        mockState.invocationCallOrder.push(++__mockCallOrder);

        let result;
        try {
          if (onceImpls.length > 0) {
            result = onceImpls.shift().apply(this, args);
          } else if (onceReturns.length > 0) {
            result = onceReturns.shift();
          } else if (returnSet) {
            result = returnVal;
          } else if (resolvedSet) {
            result = Promise.resolve(resolvedVal);
          } else if (rejectedSet) {
            result = Promise.reject(rejectedVal);
          } else if (defaultImpl) {
            result = defaultImpl.apply(this, args);
          }
          mockState.results.push({ type: 'return', value: result });
          return result;
        } catch (e) {
          mockState.results.push({ type: 'throw', value: e });
          throw e;
        }
      }

      mockFn.__isMockFunction = true;
      mockFn.mock = mockState;

      // Configuration methods
      mockFn.mockReturnValue = (v) => { returnVal = v; returnSet = true; return mockFn; };
      mockFn.mockReturnValueOnce = (v) => { onceReturns.push(v); return mockFn; };
      mockFn.mockResolvedValue = (v) => { resolvedVal = v; resolvedSet = true; return mockFn; };
      mockFn.mockRejectedValue = (v) => { rejectedVal = v; rejectedSet = true; return mockFn; };
      mockFn.mockImplementation = (fn) => { defaultImpl = fn; return mockFn; };
      mockFn.mockImplementationOnce = (fn) => { onceImpls.push(fn); return mockFn; };

      // Clearing methods
      mockFn.mockClear = () => {
        mockState.calls = []; mockState.results = []; mockState.contexts = [];
        mockState.instances = []; mockState.invocationCallOrder = []; mockState.lastCall = undefined;
        return mockFn;
      };
      mockFn.mockReset = () => {
        mockFn.mockClear();
        defaultImpl = undefined; returnVal = resolvedVal = rejectedVal = undefined;
        returnSet = resolvedSet = rejectedSet = false;
        onceImpls.length = 0; onceReturns.length = 0;
        return mockFn;
      };
      mockFn.mockRestore = () => mockFn.mockReset();

      __mockRegistry.push(mockFn);
      return mockFn;
    },

    spyOn(object, methodName) {
      const original = object[methodName];
      if (typeof original !== 'function') {
        throw new Error(\`Cannot spy on \${methodName}: not a function\`);
      }
      const spy = mock.fn(original);
      spy.__originalMethod = original;
      spy.__spyTarget = object;
      spy.__spyMethodName = methodName;
      spy.__isSpyFunction = true;
      spy.mockRestore = () => {
        object[methodName] = original;
        const idx = __mockRegistry.indexOf(spy);
        if (idx !== -1) __mockRegistry.splice(idx, 1);
        return spy;
      };
      object[methodName] = spy;
      return spy;
    },

    clearAllMocks() {
      for (const fn of __mockRegistry) fn.mockClear();
    },

    resetAllMocks() {
      for (const fn of __mockRegistry) fn.mockReset();
    },

    restoreAllMocks() {
      for (let i = __mockRegistry.length - 1; i >= 0; i--) {
        if (__mockRegistry[i].__isSpyFunction) __mockRegistry[i].mockRestore();
      }
    },
  };

  // ============================================================
  // Test Runner Helpers
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

  function countTests(suite, hasOnly) {
    let count = 0;
    if (hasOnly && !suiteHasOnly(suite)) return 0;
    if (suite.skip) return suite.tests.length;

    for (const t of suite.tests) {
      if (hasOnly && !t.only && !suite.only) continue;
      count++;
    }
    for (const child of suite.children) {
      count += countTests(child, hasOnly);
    }
    return count;
  }

  function countSuites(suite, hasOnly) {
    let count = 0;
    if (hasOnly && !suiteHasOnly(suite)) return 0;

    for (const child of suite.children) {
      count++;
      count += countSuites(child, hasOnly);
    }
    return count;
  }

  // ============================================================
  // Test Runner
  // ============================================================

  async function __runAllTests() {
    const testResults = [];
    const suiteResults = [];
    const hasOnly = checkForOnly(rootSuite);
    const runStart = Date.now();

    // Emit runStart
    const testCount = countTests(rootSuite, hasOnly);
    const suiteCount = countSuites(rootSuite, hasOnly);
    emitEvent({ type: 'runStart', testCount, suiteCount });

    async function runSuite(suite, parentHooks, pathArray, depth) {
      // Skip if this suite doesn't have any .only when .only exists elsewhere
      if (hasOnly && !suiteHasOnly(suite)) return;

      const suitePath = [...pathArray];
      const fullName = suitePath.join(' > ');
      const suiteInfo = {
        name: suite.name,
        path: suitePath.slice(0, -1),
        fullName,
        depth,
      };

      // Emit suiteStart (only for non-root suites)
      if (suite !== rootSuite) {
        emitEvent({ type: 'suiteStart', suite: suiteInfo });
      }

      const suiteStart = Date.now();
      let suitePassed = 0;
      let suiteFailed = 0;
      let suiteSkipped = 0;
      let suiteTodo = 0;

      // Skip if suite is marked as skip
      if (suite.skip) {
        // Mark all tests in this suite as skipped
        for (const t of suite.tests) {
          const testFullName = fullName ? fullName + ' > ' + t.name : t.name;
          const testInfo = {
            name: t.name,
            suitePath: suitePath,
            fullName: testFullName,
          };
          emitEvent({ type: 'testStart', test: testInfo });

          const testResult = {
            name: t.name,
            suitePath: suitePath,
            fullName: testFullName,
            status: 'skip',
            duration: 0,
          };
          testResults.push(testResult);
          suiteSkipped++;

          emitEvent({ type: 'testEnd', test: testResult });
        }
      } else {
        // Run beforeAll hooks
        for (const hook of suite.beforeAll) {
          await hook();
        }

        // Run tests
        for (const t of suite.tests) {
          const testFullName = fullName ? fullName + ' > ' + t.name : t.name;
          const testInfo = {
            name: t.name,
            suitePath: suitePath,
            fullName: testFullName,
          };

          // Skip if .only is used and this test isn't .only AND the suite doesn't have .only
          if (hasOnly && !t.only && !suite.only) continue;

          emitEvent({ type: 'testStart', test: testInfo });

          // Skip if test is marked as skip
          if (t.skip) {
            const testResult = {
              name: t.name,
              suitePath: suitePath,
              fullName: testFullName,
              status: 'skip',
              duration: 0,
            };
            testResults.push(testResult);
            suiteSkipped++;
            emitEvent({ type: 'testEnd', test: testResult });
            continue;
          }

          // Handle todo tests (no function provided)
          if (t.todo) {
            const testResult = {
              name: t.name,
              suitePath: suitePath,
              fullName: testFullName,
              status: 'todo',
              duration: 0,
            };
            testResults.push(testResult);
            suiteTodo++;
            emitEvent({ type: 'testEnd', test: testResult });
            continue;
          }

          const testStart = Date.now();
          // Reset assertion counting state before each test
          __expectedAssertions = null;
          __assertionCount = 0;
          __hasAssertionsFlag = false;

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

            // Verify assertion counts after test passes
            if (__hasAssertionsFlag && __assertionCount === 0) {
              throw new TestError('Expected at least one assertion', 'hasAssertions', '>0', 0);
            }
            if (__expectedAssertions !== null && __assertionCount !== __expectedAssertions) {
              throw new TestError(
                \`Expected \${__expectedAssertions} assertions, got \${__assertionCount}\`,
                'assertions', __expectedAssertions, __assertionCount
              );
            }

            const testResult = {
              name: t.name,
              suitePath: suitePath,
              fullName: testFullName,
              status: 'pass',
              duration: Date.now() - testStart,
            };
            testResults.push(testResult);
            suitePassed++;
            emitEvent({ type: 'testEnd', test: testResult });
          } catch (err) {
            const testError = {
              message: err.message || String(err),
              stack: err.stack,
            };
            // If it's a TestError, include matcher info
            if (err.matcherName !== undefined) {
              testError.matcherName = err.matcherName;
              testError.expected = err.expected;
              testError.actual = err.actual;
            }
            const testResult = {
              name: t.name,
              suitePath: suitePath,
              fullName: testFullName,
              status: 'fail',
              duration: Date.now() - testStart,
              error: testError,
            };
            testResults.push(testResult);
            suiteFailed++;
            emitEvent({ type: 'testEnd', test: testResult });
          }
        }

        // Run child suites
        for (const child of suite.children) {
          const childPath = [...suitePath, child.name];
          await runSuite(child, {
            beforeEach: [...parentHooks.beforeEach, ...suite.beforeEach],
            afterEach: [...suite.afterEach, ...parentHooks.afterEach],
          }, childPath, depth + 1);
        }

        // Run afterAll hooks
        for (const hook of suite.afterAll) {
          await hook();
        }
      }

      // Emit suiteEnd (only for non-root suites)
      if (suite !== rootSuite) {
        const suiteResult = {
          ...suiteInfo,
          passed: suitePassed,
          failed: suiteFailed,
          skipped: suiteSkipped,
          todo: suiteTodo,
          duration: Date.now() - suiteStart,
        };
        suiteResults.push(suiteResult);
        emitEvent({ type: 'suiteEnd', suite: suiteResult });
      }
    }

    await runSuite(rootSuite, { beforeEach: [], afterEach: [] }, [], -1);

    const passed = testResults.filter(r => r.status === 'pass').length;
    const failed = testResults.filter(r => r.status === 'fail').length;
    const skipped = testResults.filter(r => r.status === 'skip').length;
    const todo = testResults.filter(r => r.status === 'todo').length;

    const runResults = {
      passed,
      failed,
      skipped,
      todo,
      total: testResults.length,
      duration: Date.now() - runStart,
      success: failed === 0,
      suites: suiteResults,
      tests: testResults,
    };

    emitEvent({ type: 'runEnd', results: runResults });

    return JSON.stringify(runResults);
  }

  // ============================================================
  // Helper Functions
  // ============================================================

  function __hasTests() {
    function checkSuite(suite) {
      if (suite.tests.length > 0) return true;
      for (const child of suite.children) {
        if (checkSuite(child)) return true;
      }
      return false;
    }
    return checkSuite(rootSuite);
  }

  function __getTestCount() {
    function countInSuite(suite) {
      let count = suite.tests.length;
      for (const child of suite.children) {
        count += countInSuite(child);
      }
      return count;
    }
    return countInSuite(rootSuite);
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
    // Clear mocks
    __mockCallOrder = 0;
    mock.restoreAllMocks();
    __mockRegistry.length = 0;
  }

  function __setEventCallback(callback) {
    eventCallback = callback;
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
  globalThis.mock = mock;
  globalThis.jest = mock;  // Jest compatibility alias
  globalThis.__runAllTests = __runAllTests;
  globalThis.__resetTestEnvironment = __resetTestEnvironment;
  globalThis.__hasTests = __hasTests;
  globalThis.__getTestCount = __getTestCount;
  globalThis.__setEventCallback = __setEventCallback;
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
 * const handle = await setupTestEnvironment(context, {
 *   onEvent: (event) => console.log(event),
 * });
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
  context: ivm.Context,
  options?: TestEnvironmentOptions
): Promise<TestEnvironmentHandle> {
  context.evalSync(testEnvironmentCode);

  // Set up event callback if provided
  if (options?.onEvent) {
    const eventCallbackRef = new IsolatedVM.Reference((eventJson: string) => {
      try {
        const event = JSON.parse(eventJson);
        options.onEvent!(event);
      } catch {
        // Ignore parse errors
      }
    });

    const global = context.global;
    global.setSync("__eventCallbackRef", eventCallbackRef);
    context.evalSync(`
      __setEventCallback((eventJson) => {
        __eventCallbackRef.applySync(undefined, [eventJson]);
      });
    `);
  }

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
export async function runTests(context: ivm.Context): Promise<RunResults> {
  const resultJson = await context.eval("__runAllTests()", { promise: true });
  return JSON.parse(resultJson as string);
}

/**
 * Check if any tests are registered
 */
export function hasTests(context: ivm.Context): boolean {
  return context.evalSync("__hasTests()") as boolean;
}

/**
 * Get the count of registered tests
 */
export function getTestCount(context: ivm.Context): number {
  return context.evalSync("__getTestCount()") as number;
}
