# 11-test-environment.md - @ricsam/isolate-test-environment Implementation Plan

## Overview

The test-environment package provides Jest/Vitest-compatible test primitives that run inside the isolate, allowing users to write tests in sandboxed code.

## Implementation Steps

### 1. Test Registration
- [ ] describe(name, fn) - group tests
- [ ] test(name, fn) / it(name, fn) - define tests
- [ ] test.skip / describe.skip
- [ ] test.only / describe.only

### 2. Lifecycle Hooks
- [ ] beforeEach(fn)
- [ ] afterEach(fn)
- [ ] beforeAll(fn)
- [ ] afterAll(fn)

### 3. Expect Matchers
- [ ] toBe(expected) - strict equality
- [ ] toEqual(expected) - deep equality
- [ ] toStrictEqual(expected) - strict deep equality
- [ ] toBeTruthy() / toBeFalsy()
- [ ] toBeNull() / toBeUndefined() / toBeDefined()
- [ ] toContain(item)
- [ ] toThrow(error?)
- [ ] toBeInstanceOf(class)
- [ ] toHaveLength(length)
- [ ] toMatch(regexp)
- [ ] toHaveProperty(path, value?)
- [ ] not modifier

### 4. Test Runner
- [ ] runTests(context) - execute all registered tests
- [ ] Return TestResults with pass/fail counts
- [ ] Capture error messages and stack traces

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

- `expect.test.ts` - Expect matcher tests
- `hooks.test.ts` - Lifecycle hook tests

## Dependencies

- `@ricsam/isolate-core`
- `isolated-vm`
