# @ricsam/isolate-timers

Timer APIs with real-time execution for isolated-vm V8 sandbox.

## Installation

```bash
npm add @ricsam/isolate-timers
```

## Usage

```typescript
import { setupTimers } from "@ricsam/isolate-timers";

const handle = await setupTimers(context);

// Timers fire automatically based on real time
// Clear all pending timers if needed
handle.clearAll();

// Dispose when done
handle.dispose();
```

## Injected Globals

- `setTimeout(callback, ms, ...args)` - Schedule delayed execution
- `setInterval(callback, ms, ...args)` - Schedule repeated execution
- `clearTimeout(id)` - Cancel a timeout
- `clearInterval(id)` - Cancel an interval

## Usage in Isolate

```javascript
// One-shot timer - fires automatically after 1 second
const timeoutId = setTimeout(() => {
  console.log("Fired after 1 second!");
}, 1000);

// Repeating timer - fires automatically every 100ms
let count = 0;
const intervalId = setInterval(() => {
  count++;
  console.log("Tick", count);
  if (count >= 5) {
    clearInterval(intervalId);
  }
}, 100);

// Cancel a timer
clearTimeout(timeoutId);
```

## Handle API

```typescript
interface TimersHandle {
  /** Clear all pending timers */
  clearAll(): void;
  /** Dispose the timers handle */
  dispose(): void;
}
```

## License

MIT
