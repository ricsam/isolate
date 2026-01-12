# 02-console.md - @ricsam/isolate-console Implementation Plan

## Overview

The console package provides console logging APIs for the isolate sandbox.

## Implementation Steps

### 1. Console Object Setup
- [x] Create console object in isolate context
- [x] Implement console.log, console.warn, console.error, console.info, console.debug
- [x] Pass log calls to host via callback
- [x] Marshal arguments for proper display

### 2. Formatting
- [x] Handle string interpolation (%s, %d, %o) - delegated to host callbacks
- [x] Pretty-print objects and arrays - delegated to host callbacks
- [x] Handle circular references in output - delegated to host callbacks

### 3. Additional Methods
- [x] console.dir
- [x] console.table
- [x] console.group/groupEnd
- [x] console.time/timeEnd
- [x] console.count/countReset
- [x] console.assert

## Test Coverage

- `setup.test.ts` - Console setup and method tests (40 tests, all passing)

### Test Implementation Status

All 40 tests are implemented and passing:

- **Log-level methods** (10 tests): log, warn, error, debug, info, trace, dir, table
- **Timing methods** (7 tests): time, timeEnd, timeLog with various edge cases
- **Counting methods** (6 tests): count, countReset, getCounters
- **Grouping methods** (6 tests): group, groupCollapsed, groupEnd, nested groups
- **Other methods** (7 tests): clear, assert with various conditions
- **Handle methods** (3 tests): reset, getTimers, getCounters
- **No handlers** (1 test): works without handler callbacks

## Dependencies

- `@ricsam/isolate-core`
- `isolated-vm`

## API Reference

### ConsoleOptions

```typescript
interface ConsoleOptions {
  onLog?: (level: string, ...args: unknown[]) => void;
  onTime?: (label: string, duration: number) => void;
  onTimeLog?: (label: string, duration: number, ...args: unknown[]) => void;
  onCount?: (label: string, count: number) => void;
  onCountReset?: (label: string) => void;
  onGroup?: (label: string, collapsed: boolean) => void;
  onGroupEnd?: () => void;
  onClear?: () => void;
  onAssert?: (condition: boolean, ...args: unknown[]) => void;
}
```

### ConsoleHandle

```typescript
interface ConsoleHandle {
  dispose(): void;
  reset(): void;
  getTimers(): Map<string, number>;
  getCounters(): Map<string, number>;
  getGroupDepth(): number;
}
```

### Usage

```typescript
import { setupConsole } from "@ricsam/isolate-console";

const handle = await setupConsole(context, {
  onLog: (level, ...args) => console.log(`[${level}]`, ...args),
  onTime: (label, duration) => console.log(`${label}: ${duration}ms`),
  onCount: (label, count) => console.log(`${label}: ${count}`),
});

// In isolate:
// console.log("hello", 123);
// console.time("test");
// console.timeEnd("test");
// console.count("myCounter");
```
