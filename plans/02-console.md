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

## Dependencies

- `@ricsam/isolate-core`
- `isolated-vm`
