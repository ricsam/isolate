# 04-timers.md - @ricsam/isolate-timers Implementation Plan

## Overview

The timers package provides setTimeout, setInterval, clearTimeout, clearInterval APIs.

## Implementation Steps

### 1. Timer Registry
- [ ] Create host-side timer registry
- [ ] Track pending timeouts and intervals
- [ ] Assign unique IDs

### 2. setTimeout
- [ ] Implement setTimeout(callback, delay, ...args)
- [ ] Return timer ID
- [ ] Store callback and args on host side
- [ ] Schedule execution

### 3. clearTimeout
- [ ] Implement clearTimeout(id)
- [ ] Remove from registry
- [ ] Cancel pending execution

### 4. setInterval
- [ ] Implement setInterval(callback, delay, ...args)
- [ ] Return timer ID
- [ ] Schedule repeated execution

### 5. clearInterval
- [ ] Implement clearInterval(id)
- [ ] Remove from registry
- [ ] Cancel repeated execution

### 6. Timer Processing
- [ ] Implement tick() method to process pending timers
- [ ] Handle timer ordering by scheduled time
- [ ] Support nested timer creation

## Implementation Notes

Unlike a real event loop, the host controls when timers execute via `tick()`. This gives deterministic control for testing.

## Test Coverage

- `setup.test.ts` - Timer setup and execution tests

### Test Implementation TODO

The test file `packages/timers/src/setup.test.ts` contains test stubs (marked `// TODO: Implement test`):

- **setTimeout** (3 tests): executes callback after delay, returns timer ID, passes arguments
- **clearTimeout** (2 tests): cancels pending timeout, handles invalid ID
- **setInterval** (2 tests): executes callback repeatedly, returns timer ID
- **clearInterval** (1 test): stops an interval
- **nested timers** (1 test): setTimeout inside setTimeout
- **handle.tick()** (1 test): processes pending timers
- **handle.clearAll()** (1 test): clears all pending timers

## Dependencies

- `@ricsam/isolate-core`
- `isolated-vm`
