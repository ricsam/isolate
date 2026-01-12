# 10-test-utils.md - @ricsam/isolate-test-utils Implementation Plan

## Overview

The test-utils package provides testing helpers for writing tests against isolated-vm contexts.

## Implementation Steps

### 1. Test Context Creation
- [x] createTestContext() - basic context with core APIs
- [x] createCoreTestContext() - context with core APIs (Blob, File, URL, etc.)
- [x] createFsTestContext() - context with file system APIs
- [x] createRuntimeTestContext() - full runtime context

### 2. Code Evaluation Helpers
- [x] evalCode<T>(context, code) - sync evaluation
- [x] evalCodeAsync<T>(context, code) - async evaluation with promise resolution
- [x] evalCodeJson<T>(context, code) - sync evaluation with JSON parsing
- [x] evalCodeJsonAsync<T>(context, code) - async evaluation with JSON parsing
- [x] injectGlobals(context, values) - inject values into isolate

### 3. Input/Output Helpers
- [x] injectGlobals() - inject test input into isolate
- [x] RuntimeTestContext.logs - capture logged output
- [x] evalCodeJson/evalCodeJsonAsync - return unmarshalled results

### 4. Integration Testing
- [x] startIntegrationServer(port?) - start HTTP server for fetch tests
- [x] MockFileSystem - mock file system handler

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
    const result = evalCode<number>(ctx.context, `1 + 1`);
    assert.strictEqual(result, 2);
  });
});
```

## Test Coverage

33 tests passing:
- createTestContext (2 tests)
- createCoreTestContext (3 tests)
- evalCode (2 tests)
- evalCodeAsync (2 tests)
- evalCodeJson (1 test)
- evalCodeJsonAsync (1 test)
- injectGlobals (2 tests)
- MockFileSystem (9 tests)
- createFsTestContext (2 tests)
- createRuntimeTestContext (4 tests)
- startIntegrationServer (5 tests)

## Dependencies

- All @ricsam/isolate-* packages (peer dependencies)
- `isolated-vm`
