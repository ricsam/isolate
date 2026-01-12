# 02-console.md - @ricsam/isolate-console Implementation Plan

## Overview

The console package provides console logging APIs for the isolate sandbox.

## Implementation Steps

### 1. Console Object Setup
- [ ] Create console object in isolate context
- [ ] Implement console.log, console.warn, console.error, console.info, console.debug
- [ ] Pass log calls to host via callback
- [ ] Marshal arguments for proper display

### 2. Formatting
- [ ] Handle string interpolation (%s, %d, %o)
- [ ] Pretty-print objects and arrays
- [ ] Handle circular references in output

### 3. Additional Methods
- [ ] console.dir
- [ ] console.table
- [ ] console.group/groupEnd
- [ ] console.time/timeEnd
- [ ] console.count/countReset
- [ ] console.assert

## Test Coverage

- `setup.test.ts` - Console setup and method tests

### Test Implementation TODO

The test file `packages/console/src/setup.test.ts` contains comprehensive test stubs (marked `// TODO: Implement test`) covering:

- **Log-level methods** (10 tests): log, warn, error, debug, info, trace, dir, table
- **Timing methods** (7 tests): time, timeEnd, timeLog with various edge cases
- **Counting methods** (6 tests): count, countReset, getCounters
- **Grouping methods** (6 tests): group, groupCollapsed, groupEnd, nested groups
- **Other methods** (6 tests): clear, assert with various conditions
- **Handle methods** (3 tests): reset, getTimers, getCounters
- **No handlers** (1 test): works without handler callbacks

These tests need implementation as the console features are built.

## Dependencies

- `@ricsam/isolate-core`
- `isolated-vm`
