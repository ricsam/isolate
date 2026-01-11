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

## Dependencies

- `@ricsam/isolate-core`
- `isolated-vm`
