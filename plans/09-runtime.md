# 09-runtime.md - @ricsam/isolate-runtime Implementation Plan

## Overview

The runtime package aggregates all other packages and provides a simple API to create a fully configured isolate with all WHATWG APIs.

## Implementation Steps

### 1. createRuntime Function
- [x] Create new Isolate with configurable limits
- [x] Create Context
- [x] Call all setup functions in order:
  1. setupCore
  2. setupConsole
  3. setupEncoding
  4. setupTimers
  5. setupPath
  6. setupCrypto
  7. setupFetch
  8. setupFs (if handler provided)
- [x] Return RuntimeHandle with isolate, context, tick(), dispose()

### 2. Configuration Options
- [x] Memory limit
- [x] Console options (onLog callback)
- [x] Fetch options (onFetch callback)
- [x] File system options (handler)
- [ ] Timeout settings (not implemented - users can use isolate timeout options directly)

### 3. Resource Management
- [x] Proper cleanup on dispose()
- [x] Handle isolate termination
- [x] Clear all timers on dispose

### 4. Convenience Methods
- [x] runtime.context.eval(code) - evaluate code (exposed via context property)
- [x] runtime.context.eval(code, { promise: true }) - evaluate async code
- [x] runtime.tick() - process pending timers

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

- `index.test.ts` - Runtime creation and integration tests (13 passing)

### Implemented Tests

- **createRuntime** (4 tests): creates with default options, has all globals defined, dispose cleans up resources, accepts memory limit option
- **console integration** (1 test): console.log is captured
- **fetch integration** (1 test): fetch calls onFetch handler
- **timers integration** (2 tests): setTimeout works with tick(), setInterval works with tick()
- **crypto integration** (1 test): crypto.randomUUID generates valid UUIDs
- **path integration** (1 test): path.join works correctly
- **encoding integration** (1 test): btoa and atob work correctly
- **GC disposal** (1 test): resources are cleaned up on dispose
- **fs integration** (1 test): navigator.storage.getDirectory works when handler provided

## Dependencies

- All @ricsam/isolate-* packages
- `isolated-vm`
