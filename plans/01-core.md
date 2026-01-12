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
- [ ] Implement `marshal(context, value)` to convert JS values to isolate References
- [ ] Handle primitives (string, number, boolean, null, undefined)
- [ ] Handle arrays and objects recursively
- [ ] Handle Uint8Array and other typed arrays
- [ ] Handle functions via `ivm.Callback`
- [ ] Add circular reference detection
- [ ] Add max depth limit
- [ ] Implement `unmarshal(context, reference)` for reverse conversion

### 2. Scope Management (Priority: High)
- [ ] Implement `withScope(context, callback)` for automatic reference cleanup
- [ ] Implement `withScopeAsync(context, callback)` for async operations
- [ ] Track references and release on scope exit
- [ ] Handle exceptions properly

### 3. Function Builder (Priority: High)
- [ ] Implement `defineFunction(context, name, fn)`
- [ ] Implement `defineAsyncFunction(context, name, fn)`
- [ ] Auto-marshal arguments and return values
- [ ] Propagate errors correctly

### 4. Class Builder (Priority: High)
- [ ] Implement `defineClass(context, definition)`
- [ ] Support constructor, methods, properties
- [ ] Support static methods and properties
- [ ] Manage instance state on host side
- [ ] Support inheritance (extends)

### 5. Web Streams (Priority: Medium)
- [ ] Implement ReadableStream with controller
- [ ] Implement WritableStream with controller
- [ ] Implement TransformStream
- [ ] Implement Reader and Writer classes
- [ ] Support async iteration

### 6. Blob and File (Priority: Medium)
- [ ] Implement Blob class with size, type, slice, text, arrayBuffer, stream
- [ ] Implement File class extending Blob with name, lastModified
- [ ] Handle native Blob/File → isolate conversion
- [ ] Handle isolate Blob/File → native conversion

### 7. URL and URLSearchParams (Priority: Medium)
- [ ] Implement URLSearchParams with full API
- [ ] Implement URL with all properties
- [ ] Link URL.searchParams to URLSearchParams instance
- [ ] Handle native URL → isolate conversion

### 8. TextEncoder/TextDecoder (Priority: Low)
- [ ] Can be pure JS implementation injected via eval
- [ ] Support UTF-8 encoding/decoding

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

### Test Implementation TODO

Many tests are currently stubs with commented-out bodies (marked `// TODO: Implement test`). These need implementation as the corresponding features are built:

**New test files (all tests are TODO):**
- `__tests__/handle-lifetime.test.ts` - 9 experiment groups, ~20 tests
- `class-helpers.test.ts` - isDefineClassInstance, isInstanceOf, getClassInstanceState, etc.
- `coerce.test.ts` - createCoercer, coerceURL, coerceHeaders, coerceBody, etc.
- `text-encoding.test.ts` - TextEncoder, TextDecoder, roundtrip tests

**Existing files with TODO tests:**
- `blob.test.ts` - Native Blob → isolate (7 tests), Bidirectional Conversion (3 tests)
- `file.test.ts` - Native File → isolate (8 tests), Bidirectional Conversion (4 tests)
- `class-builder.test.ts` - createStateMap, getState/setState, getInstanceState, cleanup tests
- `url.test.ts` - Spec examples (2 tests), Native URL → isolate (6 tests), Bidirectional (6 tests)
- `streams/writable-stream.test.ts` - WritableStreamDefaultWriter (6 tests), error handling (6 tests)
- `streams/transform-stream.test.ts` - readable/writable defined tests

## Dependencies

- `isolated-vm`: ^6

## Notes

- isolated-vm handles V8 microtasks automatically, unlike quickjs-emscripten
- References are garbage collected but can be explicitly released
- Use `ExternalCopy` for efficient data transfer of large objects
- Consider memory limits via `Isolate({ memoryLimit: ... })`
