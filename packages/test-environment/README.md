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
  testEnvironment: true,
});

await runtime.eval(`
  describe("math", () => {
    it("adds numbers", () => {
      expect(1 + 1).toBe(2);
    });
  });
`);

const results = await runtime.testEnvironment.runTests();
console.log(`${results.passed}/${results.total} passed`);
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
import { setupTestEnvironment, runTests } from "@ricsam/isolate-test-environment";

// Setup test environment
const handle = await setupTestEnvironment(context);

// Load test code
await context.eval(userProvidedTestCode, { promise: true });

// Run all registered tests
const results = await runTests(context);
console.log(`${results.passed}/${results.total} passed`);

// Results structure:
// {
//   passed: number,
//   failed: number,
//   skipped: number,
//   total: number,
//   results: Array<{
//     name: string,
//     passed: boolean,
//     error?: string,
//     duration: number,
//     skipped?: boolean
//   }>
// }

handle.dispose();
```

## License

MIT
