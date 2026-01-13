# 11-test-environment.md - @ricsam/isolate-test-environment Implementation Plan

## Overview

The test-environment package provides Jest/Vitest-compatible test primitives that run inside the isolate, allowing users to write tests in sandboxed code.

## Implementation Steps

### 1. Test Registration
- [x] describe(name, fn) - group tests
- [x] test(name, fn) / it(name, fn) - define tests
- [x] test.skip / describe.skip
- [x] test.only / describe.only

### 2. Lifecycle Hooks
- [x] beforeEach(fn)
- [x] afterEach(fn)
- [x] beforeAll(fn)
- [x] afterAll(fn)

### 3. Expect Matchers
- [x] toBe(expected) - strict equality
- [x] toEqual(expected) - deep equality
- [x] toStrictEqual(expected) - strict deep equality
- [x] toBeTruthy() / toBeFalsy()
- [x] toBeNull() / toBeUndefined() / toBeDefined()
- [x] toContain(item)
- [x] toThrow(error?)
- [x] toBeInstanceOf(class)
- [x] toHaveLength(length)
- [x] toMatch(regexp)
- [x] toHaveProperty(path, value?)
- [x] not modifier

### 4. Test Runner
- [x] runTests(context) - execute all registered tests
- [x] Return TestResults with pass/fail counts
- [x] Capture error messages and stack traces

## Implementation Notes

This is useful for running user-provided tests in the sandbox:

```typescript
const handle = await setupTestEnvironment(context);

await context.eval(`
  describe("sandbox tests", () => {
    test("math works", () => {
      expect(1 + 1).toBe(2);
    });
  });
`);

const results = await runTests(context);
console.log(`${results.passed}/${results.total} tests passed`);
```

## Test Coverage

- `expect.test.ts` - 21 tests for expect matchers (toBe, toEqual, toStrictEqual, not modifier, toBeTruthy, toBeFalsy, toBeNull, toBeUndefined, toBeDefined, toContain, toThrow, toBeInstanceOf, toHaveLength, toMatch, toHaveProperty)
- `hooks.test.ts` - 12 tests for lifecycle hooks (beforeEach, afterEach, beforeAll, afterAll, nested describe, test.skip, test.only, describe.skip, async tests, it alias)

**Total: 33 passing tests**

## Dependencies

- `@ricsam/isolate-core`
- `isolated-vm`
