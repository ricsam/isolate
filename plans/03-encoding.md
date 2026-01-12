# 03-encoding.md - @ricsam/isolate-encoding Implementation Plan

## Overview

The encoding package provides Base64 encoding/decoding via atob and btoa.

**Status: ✅ Complete**

## Implementation Steps

### 1. btoa (Base64 Encode)
- [x] Implement btoa function
- [x] Handle string input (converts non-strings via String())
- [x] Proper error handling for invalid characters (throws InvalidCharacterError for chars > 255)

### 2. atob (Base64 Decode)
- [x] Implement atob function
- [x] Handle Base64 input (with and without padding)
- [x] Proper error handling for invalid Base64 (throws InvalidCharacterError)
- [x] Whitespace handling (ignored per spec)

### 3. DOMException Polyfill
- [x] Define DOMException class if not available in isolate
- [x] Support InvalidCharacterError name

## Implementation Notes

Uses Pure JS Injection Pattern (Pattern #7) - no host callbacks needed. The isolated-vm context doesn't have Node.js Buffer, so pure JavaScript character code manipulation is used.

Key implementation details:
- Base64 alphabet: `A-Za-z0-9+/`
- btoa accepts Latin-1 strings only (char codes 0-255)
- atob handles both padded and unpadded input
- DOMException polyfill provides InvalidCharacterError support

## Test Coverage

- `setup.test.ts` - 12 tests passing

### Test Summary

- **btoa** (5 tests): encodes string to base64, handles empty string, handles Latin-1 characters, throws on chars outside Latin-1 range, converts non-string arguments
- **atob** (5 tests): decodes base64 to string, handles empty string, throws on invalid base64, handles input without padding, ignores whitespace
- **roundtrip** (2 tests): btoa and atob are inverse operations, handles binary data roundtrip

## Dependencies

- `@ricsam/isolate-core`
- `isolated-vm`
