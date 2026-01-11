# 03-encoding.md - @ricsam/isolate-encoding Implementation Plan

## Overview

The encoding package provides Base64 encoding/decoding via atob and btoa.

## Implementation Steps

### 1. btoa (Base64 Encode)
- [ ] Implement btoa function
- [ ] Handle string input
- [ ] Proper error handling for invalid characters

### 2. atob (Base64 Decode)
- [ ] Implement atob function
- [ ] Handle Base64 input
- [ ] Proper error handling for invalid Base64

## Implementation Notes

This can be a pure JavaScript implementation injected via eval, as btoa/atob are simple string operations.

```javascript
globalThis.btoa = function(str) {
  return Buffer.from(str, 'binary').toString('base64');
};

globalThis.atob = function(str) {
  return Buffer.from(str, 'base64').toString('binary');
};
```

For isolated-vm, we need to inject this code into the context.

## Test Coverage

- `setup.test.ts` - btoa/atob tests

## Dependencies

- `@ricsam/isolate-core`
- `isolated-vm`
