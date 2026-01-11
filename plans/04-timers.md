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

## Dependencies

- `@ricsam/isolate-core`
- `isolated-vm`
