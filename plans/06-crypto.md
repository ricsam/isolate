# 06-crypto.md - @ricsam/isolate-crypto Implementation Plan

## Overview

The crypto package provides Web Crypto API subset for the isolate.

## Implementation Steps

### 1. crypto.randomUUID
- [ ] Generate RFC 4122 compliant UUID v4
- [ ] Can use Node.js crypto.randomUUID on host
- [ ] Return string to isolate

### 2. crypto.getRandomValues
- [ ] Accept TypedArray input
- [ ] Fill with cryptographically random values
- [ ] Use Node.js crypto.randomFillSync on host
- [ ] Return the same array (modified in place)

### 3. SubtleCrypto (Optional/Future)
- [ ] crypto.subtle.digest
- [ ] crypto.subtle.encrypt/decrypt
- [ ] crypto.subtle.sign/verify
- [ ] crypto.subtle.generateKey/importKey

## Implementation Notes

The random functions require host-side implementation since isolated-vm doesn't have access to crypto APIs. Values must be generated on host and transferred to isolate.

## Test Coverage

- `setup.test.ts` - Crypto API tests

### Test Implementation TODO

The test file `packages/crypto/src/setup.test.ts` contains test stubs (marked `// TODO: Implement test`):

- **crypto.randomUUID** (2 tests): returns valid UUID, returns unique values
- **crypto.getRandomValues** (5 tests): fills Uint8Array, Uint16Array, Uint32Array, throws for non-typed arrays, throws for arrays > 65536 bytes

## Dependencies

- `@ricsam/isolate-core`
- `isolated-vm`
