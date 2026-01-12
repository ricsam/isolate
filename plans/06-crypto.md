# 06-crypto.md - @ricsam/isolate-crypto Implementation Plan

## Overview

The crypto package provides Web Crypto API subset for the isolate.

## Implementation Steps

### 1. crypto.randomUUID
- [x] Generate RFC 4122 compliant UUID v4
- [x] Can use Node.js crypto.randomUUID on host
- [x] Return string to isolate

### 2. crypto.getRandomValues
- [x] Accept TypedArray input
- [x] Fill with cryptographically random values
- [x] Use Node.js crypto.randomFillSync on host
- [x] Return the same array (modified in place)

### 3. SubtleCrypto (Optional/Future)
- [ ] crypto.subtle.digest
- [ ] crypto.subtle.encrypt/decrypt
- [ ] crypto.subtle.sign/verify
- [ ] crypto.subtle.generateKey/importKey

## Implementation Notes

The random functions require host-side implementation since isolated-vm doesn't have access to crypto APIs. Values must be generated on host and transferred to isolate.

### Pattern Used

**Pattern #11 (Simple Callback-Based API)** - The crypto API is a single global object with stateless methods that proxy to host callbacks.

### Architecture

```
┌─────────────────────────────────────────────────────┐
│                    Host (Node.js)                    │
│  ┌─────────────────────────────────────────────┐    │
│  │  __crypto_randomUUID: crypto.randomUUID()   │    │
│  │  __crypto_getRandomValues: generates bytes  │    │
│  └─────────────────────────────────────────────┘    │
│                         │                            │
│              evalSync injects crypto object          │
│                         ▼                            │
│  ┌─────────────────────────────────────────────┐    │
│  │              V8 Isolate                      │    │
│  │  globalThis.crypto = {                       │    │
│  │    randomUUID() → calls __crypto_randomUUID │    │
│  │    getRandomValues(arr) → fills arr         │    │
│  │  }                                           │    │
│  └─────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────┘
```

### Key Implementation Details

- `randomUUID()`: Direct proxy to Node.js `crypto.randomUUID()`
- `getRandomValues(typedArray)`:
  - Validates input is an integer TypedArray (Int8Array, Uint8Array, etc.)
  - Validates byte length ≤ 65536 (throws `QuotaExceededError` per Web Crypto spec)
  - Host generates random bytes via `crypto.randomFillSync()`
  - Returns bytes as array, isolate copies into TypedArray
  - Returns the same array reference (modified in place)
- Includes DOMException polyfill (Pattern #12) for QuotaExceededError

## Test Coverage

- `setup.test.ts` - Crypto API tests

### Test Implementation ✅

All tests implemented in `packages/crypto/src/setup.test.ts`:

- **crypto.randomUUID** (2 tests): returns valid UUID, returns unique values
- **crypto.getRandomValues** (5 tests): fills Uint8Array, Uint16Array, Uint32Array, throws for non-typed arrays, throws for arrays > 65536 bytes

## Dependencies

- `@ricsam/isolate-core`
- `isolated-vm`
