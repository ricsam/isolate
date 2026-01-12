# 01-core.md - @ricsam/isolate-core Implementation Plan

## Overview

The core package provides foundational utilities for working with isolated-vm, including:
- Marshalling/unmarshalling data between host and isolate
- Scope management for reference lifecycle
- Class and function builders for injecting APIs
- Web Streams (ReadableStream, WritableStream, TransformStream)
- Blob and File classes
- URL and URLSearchParams
- TextEncoder/TextDecoder

## Key API Mapping

| quickjs-emscripten | isolated-vm | Notes |
|-------------------|-------------|-------|
| `QuickJSContext` | `ivm.Context` | Main execution context |
| `QuickJSRuntime` | `ivm.Isolate` | V8 isolate instance |
| `QuickJSHandle` | `ivm.Reference` | Reference to value in isolate |
| `context.evalCode(code)` | `context.evalSync(code)` | Execute code |
| `context.newFunction(name, fn)` | `new ivm.Callback(fn)` | Create callable function |
| `context.dump(handle)` | `reference.copySync()` | Extract value |
| `handle.dispose()` | `reference.release()` | Release reference |

## Implementation Steps

### 1. Marshal/Unmarshal (Priority: High)
- [x] Implement `marshal(context, value)` to convert JS values to isolate References
- [x] Handle primitives (string, number, boolean, null, undefined)
- [x] Handle arrays and objects recursively
- [x] Handle Uint8Array and other typed arrays
- [x] Handle functions via `ivm.Callback`
- [x] Add circular reference detection
- [x] Add max depth limit
- [x] Implement `unmarshal(context, reference)` for reverse conversion

### 2. Scope Management (Priority: High)
- [x] Implement `withScope(context, callback)` for automatic reference cleanup
- [x] Implement `withScopeAsync(context, callback)` for async operations
- [x] Track references and release on scope exit
- [x] Handle exceptions properly

### 3. Function Builder (Priority: High)
- [x] Implement `defineFunction(context, name, fn)`
- [x] Implement `defineAsyncFunction(context, name, fn)`
- [x] Auto-marshal arguments and return values
- [x] Propagate errors correctly

### 4. Class Builder (Priority: High)
- [x] Implement `defineClass(context, definition)`
- [x] Support constructor, methods, properties
- [x] Support static methods and properties
- [x] Manage instance state on host side
- [x] Support inheritance (extends)

### 5. Web Streams (Priority: Medium)
- [x] Implement ReadableStream with controller
- [x] Implement WritableStream with controller
- [x] Implement TransformStream
- [x] Implement Reader and Writer classes
- [x] Support async iteration

### 6. Blob and File (Priority: Medium)
- [x] Implement Blob class with size, type, slice, text, arrayBuffer, stream
- [x] Implement File class extending Blob with name, lastModified
- [x] Handle native Blob/File → isolate conversion
- [x] Handle isolate Blob/File → native conversion

### 7. URL and URLSearchParams (Priority: Medium)
- [x] Implement URLSearchParams with full API
- [x] Implement URL with all properties
- [x] Link URL.searchParams to URLSearchParams instance
- [x] Handle native URL → isolate conversion

### 8. TextEncoder/TextDecoder (Priority: Low)
- [x] Can be pure JS implementation injected via eval
- [x] Support UTF-8 encoding/decoding

## Test Coverage

Tests in `packages/core/src/`:
- `index.test.ts` - Main API tests
- `marshal.test.ts` - Marshalling tests
- `scope.test.ts` - Scope management tests
- `class-builder.test.ts` - Class definition tests
- `function-builder.test.ts` - Function definition tests
- `blob.test.ts` - Blob class tests
- `file.test.ts` - File class tests
- `url.test.ts` - URL and URLSearchParams tests
- `streams/readable-stream.test.ts`
- `streams/writable-stream.test.ts`
- `streams/transform-stream.test.ts`
- `__tests__/handle-lifetime.test.ts` - Handle lifetime experiments
- `class-helpers.test.ts` - Class helper utilities
- `coerce.test.ts` - Coercer utilities
- `text-encoding.test.ts` - TextEncoder/TextDecoder

### Test Implementation Status

All tests are now implemented and passing (324 tests total):

**Completed test files:**
- [x] `__tests__/handle-lifetime.test.ts` - 9 experiment groups, ~20 tests
- [x] `class-helpers.test.ts` - isDefineClassInstance, isInstanceOf, getClassInstanceState, etc.
- [x] `coerce.test.ts` - createCoercer, coerceURL, coerceHeaders, coerceBody, etc.
- [x] `text-encoding.test.ts` - TextEncoder, TextDecoder, roundtrip tests
- [x] `blob.test.ts` - Native Blob → isolate (7 tests), Bidirectional Conversion (3 tests)
- [x] `file.test.ts` - Native File → isolate (8 tests), Bidirectional Conversion (4 tests)
- [x] `class-builder.test.ts` - createStateMap, getState/setState, getInstanceState, cleanup tests
- [x] `url.test.ts` - Spec examples (2 tests), Native URL → isolate (6 tests), Bidirectional (6 tests)
- [x] `streams/writable-stream.test.ts` - WritableStreamDefaultWriter (6 tests), error handling (6 tests)
- [x] `streams/transform-stream.test.ts` - readable/writable defined tests

## Dependencies

- `isolated-vm`: ^6

## Notes

- isolated-vm handles V8 microtasks automatically, unlike quickjs-emscripten
- References are garbage collected but can be explicitly released
- Use `ExternalCopy` for efficient data transfer of large objects
- Consider memory limits via `Isolate({ memoryLimit: ... })`
