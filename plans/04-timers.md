# 04-timers.md - @ricsam/isolate-timers Implementation Plan

## Overview

The timers package provides setTimeout, setInterval, clearTimeout, clearInterval APIs.

## Implementation Steps

### 1. Timer Registry
- [x] Create host-side timer registry
- [x] Track pending timeouts and intervals
- [x] Assign unique IDs

### 2. setTimeout
- [x] Implement setTimeout(callback, delay, ...args)
- [x] Return timer ID
- [x] Store callback and args on host side
- [x] Schedule execution

### 3. clearTimeout
- [x] Implement clearTimeout(id)
- [x] Remove from registry
- [x] Cancel pending execution

### 4. setInterval
- [x] Implement setInterval(callback, delay, ...args)
- [x] Return timer ID
- [x] Schedule repeated execution

### 5. clearInterval
- [x] Implement clearInterval(id)
- [x] Remove from registry
- [x] Cancel repeated execution

### 6. Timer Processing
- [x] Implement tick() method to process pending timers
- [x] Handle timer ordering by scheduled time
- [x] Support nested timer creation

## Implementation Notes

Unlike a real event loop, the host controls when timers execute via `tick(ms)`. This gives deterministic control for testing.

**Architecture:**
- Host tracks timer metadata (id, delay, scheduledTime, type)
- Isolate stores actual callbacks in a Map
- `tick(ms)` advances virtual time and executes due timers
- Timers execute in scheduled order (earliest first)
- Nested timer creation is supported

## Test Coverage

- `setup.test.ts` - 15 passing tests

### Implemented Tests

- **setTimeout** (3 tests): executes callback after delay, returns timer ID, passes arguments
- **clearTimeout** (2 tests): cancels pending timeout, handles invalid ID
- **setInterval** (2 tests): executes callback repeatedly, returns timer ID
- **clearInterval** (1 test): stops an interval
- **nested timers** (1 test): setTimeout inside setTimeout
- **handle.tick()** (1 test): processes pending timers in correct order
- **handle.clearAll()** (1 test): clears all pending timers
- **edge cases** (4 tests): delay 0, negative delay, multiple intervals, clearTimeout inside callback

## Dependencies

- `isolated-vm`
