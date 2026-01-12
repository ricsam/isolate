# 09-runtime.md - @ricsam/isolate-runtime Implementation Plan

## Overview

The runtime package aggregates all other packages and provides a simple API to create a fully configured isolate with all WHATWG APIs.

## Implementation Steps

### 1. createRuntime Function
- [ ] Create new Isolate with configurable limits
- [ ] Create Context
- [ ] Call all setup functions in order:
  1. setupCore
  2. setupConsole
  3. setupEncoding
  4. setupTimers
  5. setupPath
  6. setupCrypto
  7. setupFetch
  8. setupFs (if handler provided)
- [ ] Return RuntimeHandle with isolate, context, tick(), dispose()

### 2. Configuration Options
- [ ] Memory limit
- [ ] Console options (onLog callback)
- [ ] Fetch options (onFetch callback)
- [ ] File system options (handler)
- [ ] Timeout settings

### 3. Resource Management
- [ ] Proper cleanup on dispose()
- [ ] Handle isolate termination
- [ ] Clear all timers on dispose

### 4. Convenience Methods
- [ ] runtime.eval(code) - evaluate code
- [ ] runtime.evalAsync(code) - evaluate async code
- [ ] runtime.tick() - process pending timers

## Implementation Notes

The runtime is the main entry point for users. It should be simple to use:

```typescript
const runtime = await createRuntime({
  console: { onLog: console.log },
  fetch: { onFetch: fetch },
});

await runtime.context.eval(`
  console.log("Hello!");
  const res = await fetch("https://api.example.com");
`);

runtime.dispose();
```

## Test Coverage

- `index.test.ts` - Runtime creation and integration tests

### Test Implementation TODO

The test file `packages/runtime/src/index.test.ts` contains test stubs (marked `// TODO: Implement test`):

- **createRuntime** (3 tests): creates with default options, has all globals defined, dispose cleans up resources
- **console integration** (1 test): console.log is captured
- **fetch integration** (1 test): fetch calls onFetch handler
- **timers integration** (1 test): setTimeout works with tick()
- **GC disposal** (1 test): resources are cleaned up on dispose

## Dependencies

- All @ricsam/isolate-* packages
- `isolated-vm`
