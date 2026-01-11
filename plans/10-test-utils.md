# 10-test-utils.md - @ricsam/isolate-test-utils Implementation Plan

## Overview

The test-utils package provides testing helpers for writing tests against isolated-vm contexts.

## Implementation Steps

### 1. Test Context Creation
- [ ] createTestContext() - basic context with core APIs
- [ ] createFetchTestContext() - context with fetch APIs
- [ ] createFsTestContext() - context with file system APIs
- [ ] createRuntimeTestContext() - full runtime context

### 2. Code Evaluation Helpers
- [ ] evalCode<T>(context, code) - sync evaluation
- [ ] evalCodeAsync<T>(context, code) - async evaluation with promise resolution
- [ ] runTestCode(context, code) - with input/output helpers

### 3. Input/Output Helpers
- [ ] Inject test input into isolate
- [ ] Capture logged output
- [ ] Return unmarshalled results

### 4. Integration Testing
- [ ] startIntegrationServer(port?) - start HTTP server for fetch tests
- [ ] Mock file system handler

## Implementation Notes

The test utilities should make it easy to write tests:

```typescript
describe("my feature", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await createTestContext();
  });

  afterEach(() => {
    ctx.dispose();
  });

  test("example", async () => {
    const result = await evalCode<number>(ctx.context, `1 + 1`);
    assert.strictEqual(result, 2);
  });
});
```

## Test Coverage

This package itself doesn't need many tests, as it's testing infrastructure.

## Dependencies

- All @ricsam/isolate-* packages (peer dependencies)
- `isolated-vm`
