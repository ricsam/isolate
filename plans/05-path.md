# 05-path.md - @ricsam/isolate-path Implementation Plan

## Overview

The path package provides path manipulation utilities similar to Node.js path module.

## Implementation Steps

### 1. Path Functions
- [x] path.join(...segments)
- [x] path.dirname(path)
- [x] path.basename(path, ext?)
- [x] path.extname(path)
- [x] path.normalize(path)
- [x] path.isAbsolute(path)
- [x] path.resolve(...segments)
- [x] path.relative(from, to)
- [x] path.parse(path)
- [x] path.format(pathObject)

### 2. Path Constants
- [x] path.sep (separator: '/')
- [x] path.delimiter (':')

## Implementation Notes

Implemented as a pure JavaScript injection (Pattern #7 from PATTERNS.md). Uses POSIX-style paths only (always uses '/' as separator) for simplicity in the sandbox. The `path.posix` property references the same object for compatibility.

## Test Coverage

- `setup.test.ts` - Path utility tests (51 tests)

### Implemented Tests

- **path.sep and path.delimiter** (2 tests): verifies constants
- **path.join** (5 tests): joins segments, normalizes, handles empty segments, handles multiple separators
- **path.dirname** (4 tests): returns directory name, handles root-level, relative paths, trailing slashes
- **path.basename** (4 tests): returns file name, removes extension, handles non-matching extension, trailing slashes
- **path.extname** (5 tests): returns extension, handles no extension, multiple dots, dotfiles
- **path.normalize** (6 tests): normalizes separators, resolves . and .., preserves trailing slash, handles relative paths
- **path.isAbsolute** (4 tests): returns true/false for absolute/relative paths, root, empty string
- **path.resolve** (4 tests): resolves absolute paths, later absolute takes precedence, relative from root, normalizes
- **path.relative** (4 tests): relative path between paths, same path, deeply nested, parent paths
- **path.parse** (4 tests): parses absolute/relative paths, paths without extension, root-level files
- **path.format** (4 tests): formats path object, uses name/ext, base precedence, uses root
- **path.posix** (1 test): verifies posix equals path
- **error handling** (4 tests): TypeErrors for invalid inputs

## Dependencies

- `@ricsam/isolate-core` (peer dependency, not actually used - pure JS implementation)
- `isolated-vm`
