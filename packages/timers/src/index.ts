import ivm from "isolated-vm";

export interface TimersHandle {
  /** Advance virtual time by ms and process due timers */
  tick(ms?: number): Promise<void>;
  /** Clear all pending timers */
  clearAll(): void;
  /** Dispose the timers handle */
  dispose(): void;
}

interface TimerEntry {
  id: number;
  delay: number;
  scheduledTime: number;
  type: "timeout" | "interval";
}

/**
 * Setup timer APIs in an isolated-vm context
 *
 * Injects setTimeout, setInterval, clearTimeout, clearInterval
 *
 * Uses virtual time - timers only execute when tick(ms) is called.
 *
 * @example
 * const handle = await setupTimers(context);
 * await context.eval(`
 *   setTimeout(() => console.log("hello"), 1000);
 * `);
 * await handle.tick(1000); // Process pending timers
 */
export async function setupTimers(
  context: ivm.Context
): Promise<TimersHandle> {
  // Host-side state
  let nextTimerId = 1;
  const pendingTimers = new Map<number, TimerEntry>();
  let currentTime = 0;

  const global = context.global;

  // Register timer on host, return ID
  global.setSync(
    "__timers_register",
    new ivm.Callback((type: string, delay: number) => {
      const id = nextTimerId++;
      const normalizedDelay = Math.max(0, delay || 0);
      pendingTimers.set(id, {
        id,
        delay: normalizedDelay,
        scheduledTime: currentTime + normalizedDelay,
        type: type as "timeout" | "interval",
      });
      return id;
    })
  );

  // Clear timer by ID
  global.setSync(
    "__timers_clear",
    new ivm.Callback((id: number) => {
      pendingTimers.delete(id);
    })
  );

  // Inject JavaScript timer APIs
  const timersCode = `
(function() {
  const __timers_callbacks = new Map();

  globalThis.setTimeout = function(callback, delay, ...args) {
    if (typeof callback !== 'function') {
      throw new TypeError('Callback must be a function');
    }
    const id = __timers_register('timeout', delay || 0);
    __timers_callbacks.set(id, { callback, args });
    return id;
  };

  globalThis.setInterval = function(callback, delay, ...args) {
    if (typeof callback !== 'function') {
      throw new TypeError('Callback must be a function');
    }
    const id = __timers_register('interval', delay || 0);
    __timers_callbacks.set(id, { callback, args });
    return id;
  };

  globalThis.clearTimeout = function(id) {
    __timers_clear(id);
    __timers_callbacks.delete(id);
  };

  globalThis.clearInterval = globalThis.clearTimeout;

  // Called by host tick() to execute a timer callback
  globalThis.__timers_execute = function(id) {
    const entry = __timers_callbacks.get(id);
    if (entry) {
      entry.callback(...entry.args);
    }
  };

  // Called by host clearAll() to clear all callbacks
  globalThis.__timers_clearCallbacks = function() {
    __timers_callbacks.clear();
  };

  // Called to remove a one-shot timeout callback after execution
  globalThis.__timers_removeCallback = function(id) {
    __timers_callbacks.delete(id);
  };
})();
`;

  context.evalSync(timersCode);

  return {
    async tick(ms: number = 0) {
      currentTime += ms;

      // Process timers in scheduled order, one at a time
      // (to handle nested timer creation correctly)
      while (true) {
        const dueTimers = [...pendingTimers.values()]
          .filter((t) => t.scheduledTime <= currentTime)
          .sort((a, b) => a.scheduledTime - b.scheduledTime);

        const timer = dueTimers[0];
        if (!timer) break;

        // Execute callback in isolate
        context.evalSync(`__timers_execute(${timer.id})`);

        if (timer.type === "timeout") {
          pendingTimers.delete(timer.id);
          context.evalSync(`__timers_removeCallback(${timer.id})`);
        } else {
          // Reschedule interval for next execution
          timer.scheduledTime = currentTime + timer.delay;
        }
      }
    },

    clearAll() {
      pendingTimers.clear();
      context.evalSync("__timers_clearCallbacks()");
    },

    dispose() {
      pendingTimers.clear();
      context.evalSync("__timers_clearCallbacks()");
      currentTime = 0;
      nextTimerId = 1;
    },
  };
}
