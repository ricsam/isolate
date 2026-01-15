# @ricsam/isolate-test-environment

Test primitives for running tests in sandboxed V8. Provides a Jest/Vitest-compatible API.

## Installation

```bash
npm add @ricsam/isolate-test-environment
```

## Usage with isolate-runtime (Recommended)

The easiest way to use this package is through `@ricsam/isolate-runtime`:

```typescript
import { createRuntime } from "@ricsam/isolate-runtime";

const runtime = await createRuntime({
  testEnvironment: {
    onEvent: (event) => {
      // Receive lifecycle events during test execution
      if (event.type === "testEnd") {
        const icon = event.test.status === "pass" ? "✓" : "✗";
        console.log(`${icon} ${event.test.fullName}`);
      }
    },
  },
});

await runtime.eval(`
  describe("math", () => {
    it("adds numbers", () => {
      expect(1 + 1).toBe(2);
    });
    it.todo("subtract numbers");
  });
`);

const results = await runtime.testEnvironment.runTests();
console.log(`${results.passed}/${results.total} passed, ${results.todo} todo`);

// Check if tests exist before running
if (runtime.testEnvironment.hasTests()) {
  console.log(`Found ${runtime.testEnvironment.getTestCount()} tests`);
}
```

## Low-level Usage (Direct ivm)

For advanced use cases with direct isolated-vm access:

```typescript
import { setupTestEnvironment, runTests } from "@ricsam/isolate-test-environment";

const handle = await setupTestEnvironment(context);
```

## Injected Globals

- `describe`, `it`, `test` (with `.skip`, `.only`, `.todo` modifiers)
- `beforeAll`, `afterAll`, `beforeEach`, `afterEach`
- `expect` with matchers and `.not` modifier

## Expect Matchers

- `toBe(expected)` - Strict equality (`===`)
- `toEqual(expected)` - Deep equality
- `toStrictEqual(expected)` - Strict deep equality (includes prototype checks)
- `toBeTruthy()`, `toBeFalsy()`
- `toBeNull()`, `toBeUndefined()`, `toBeDefined()`
- `toContain(item)` - Array/string includes
- `toThrow(expected?)` - Function throws
- `toBeInstanceOf(cls)` - Instance check
- `toHaveLength(length)` - Array/string length
- `toMatch(pattern)` - String/regex match
- `toHaveProperty(path, value?)` - Object property check

## Usage in Isolate

```javascript
describe("Math operations", () => {
  beforeEach(() => {
    // setup before each test
  });

  it("should add numbers", () => {
    expect(1 + 1).toBe(2);
  });

  it("should multiply numbers", async () => {
    await Promise.resolve();
    expect(2 * 3).toEqual(6);
  });

  describe("edge cases", () => {
    it.skip("should handle infinity", () => {
      expect(1 / 0).toBe(Infinity);
    });

    it.todo("should handle NaN");
  });
});

// Negation with .not
expect(1).not.toBe(2);
expect([1, 2]).not.toContain(3);
```

## Running Tests from Host

```typescript
import { setupTestEnvironment, runTests, hasTests, getTestCount } from "@ricsam/isolate-test-environment";

// Setup test environment with optional event callback
const handle = await setupTestEnvironment(context, {
  onEvent: (event) => {
    switch (event.type) {
      case "runStart":
        console.log(`Running ${event.testCount} tests in ${event.suiteCount} suites`);
        break;
      case "testEnd":
        console.log(`${event.test.status}: ${event.test.fullName}`);
        break;
    }
  },
});

// Load test code
await context.eval(userProvidedTestCode, { promise: true });

// Check if any tests were registered
if (hasTests(context)) {
  console.log(`Found ${getTestCount(context)} tests`);
}

// Run all registered tests
const results = await runTests(context);
console.log(`${results.passed}/${results.total} passed`);

handle.dispose();
```

## Types

### RunResults

```typescript
interface RunResults {
  passed: number;
  failed: number;
  skipped: number;
  todo: number;
  total: number;
  duration: number;
  success: boolean;        // true if no failures
  suites: SuiteResult[];   // suite-level results
  tests: TestResult[];     // individual test results
}
```

### TestResult

```typescript
interface TestResult {
  name: string;
  suitePath: string[];     // suite ancestry
  fullName: string;        // "suite > nested > test name"
  status: "pass" | "fail" | "skip" | "todo";
  duration: number;
  error?: TestError;
}

interface TestError {
  message: string;
  stack?: string;
  expected?: unknown;      // for assertion failures
  actual?: unknown;
  matcherName?: string;    // e.g., "toBe", "toEqual"
}
```

### SuiteResult

```typescript
interface SuiteResult {
  name: string;
  path: string[];          // ancestry path
  fullName: string;        // "outer > inner"
  depth: number;           // nesting level (0 for root)
  passed: number;
  failed: number;
  skipped: number;
  todo: number;
  duration: number;
}
```

### TestEvent

```typescript
type TestEvent =
  | { type: "runStart"; testCount: number; suiteCount: number }
  | { type: "suiteStart"; suite: SuiteInfo }
  | { type: "suiteEnd"; suite: SuiteResult }
  | { type: "testStart"; test: TestInfo }
  | { type: "testEnd"; test: TestResult }
  | { type: "runEnd"; results: RunResults };
```

## License

MIT
