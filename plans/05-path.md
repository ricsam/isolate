# 05-path.md - @ricsam/isolate-path Implementation Plan

## Overview

The path package provides path manipulation utilities similar to Node.js path module.

## Implementation Steps

### 1. Path Functions
- [ ] path.join(...segments)
- [ ] path.dirname(path)
- [ ] path.basename(path, ext?)
- [ ] path.extname(path)
- [ ] path.normalize(path)
- [ ] path.isAbsolute(path)
- [ ] path.resolve(...segments)
- [ ] path.relative(from, to)
- [ ] path.parse(path)
- [ ] path.format(pathObject)

### 2. Path Constants
- [ ] path.sep (separator: '/' or '\\')
- [ ] path.delimiter (':' or ';')

## Implementation Notes

This can be a pure JavaScript implementation. Consider using POSIX-style paths only (always use '/') for simplicity in the sandbox.

## Test Coverage

- `setup.test.ts` - Path utility tests

### Test Implementation TODO

The test file `packages/path/src/setup.test.ts` contains test stubs (marked `// TODO: Implement test`):

- **path.join** (2 tests): joins path segments, normalizes result
- **path.dirname** (1 test): returns directory name
- **path.basename** (2 tests): returns file name, removes extension
- **path.extname** (1 test): returns file extension
- **path.normalize** (2 tests): normalizes separators, resolves . and ..
- **path.isAbsolute** (2 tests): returns true/false for absolute/relative paths

## Dependencies

- `@ricsam/isolate-core`
- `isolated-vm`
