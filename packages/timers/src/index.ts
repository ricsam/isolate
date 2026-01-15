import ivm from "isolated-vm";

export interface TimersHandle {
  /** Clear all pending timers */
  clearAll(): void;
  /** Dispose the timers handle */
  dispose(): void;
}

/**
 * Setup timer APIs in an isolated-vm context
 *
 * Injects setTimeout, setInterval, clearTimeout, clearInterval
 *
 * Uses real time - timers fire automatically based on actual elapsed time.
 *
 * @example
 * const handle = await setupTimers(context);
 * await context.eval(`
 *   setTimeout(() => console.log("hello"), 1000);
 * `);
 * // Timer will fire automatically after 1 second
 */
export async function setupTimers(
  context: ivm.Context
): Promise<TimersHandle> {
  let nextTimerId = 1;
  const pendingTimers = new Map<number, NodeJS.Timeout>();
  let disposed = false;

  const global = context.global;

  // Register timeout on host, return ID
  global.setSync(
    "__timers_registerTimeout",
    new ivm.Callback((delay: number) => {
      const id = nextTimerId++;
      const normalizedDelay = Math.max(0, delay || 0);

      const handle = setTimeout(() => {
        if (disposed || !pendingTimers.has(id)) return;
        pendingTimers.delete(id);
        try {
          context.evalSync(`__timers_execute(${id})`);
          context.evalSync(`__timers_removeCallback(${id})`);
        } catch {
          // Context may have been disposed
        }
      }, normalizedDelay);

      pendingTimers.set(id, handle);
      return id;
    })
  );

  // Register interval on host, return ID
  global.setSync(
    "__timers_registerInterval",
    new ivm.Callback((delay: number) => {
      const id = nextTimerId++;
      const normalizedDelay = Math.max(0, delay || 0);

      const handle = setInterval(() => {
        if (disposed || !pendingTimers.has(id)) return;
        try {
          context.evalSync(`__timers_execute(${id})`);
        } catch {
          // Context may have been disposed
        }
      }, normalizedDelay);

      pendingTimers.set(id, handle);
      return id;
    })
  );

  // Clear timer by ID
  global.setSync(
    "__timers_clear",
    new ivm.Callback((id: number) => {
      const handle = pendingTimers.get(id);
      if (handle) {
        clearTimeout(handle); // works for both timeout and interval
        pendingTimers.delete(id);
      }
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
    const id = __timers_registerTimeout(delay || 0);
    __timers_callbacks.set(id, { callback, args });
    return id;
  };

  globalThis.setInterval = function(callback, delay, ...args) {
    if (typeof callback !== 'function') {
      throw new TypeError('Callback must be a function');
    }
    const id = __timers_registerInterval(delay || 0);
    __timers_callbacks.set(id, { callback, args });
    return id;
  };

  globalThis.clearTimeout = function(id) {
    __timers_clear(id);
    __timers_callbacks.delete(id);
  };

  globalThis.clearInterval = globalThis.clearTimeout;

  // Called by host to execute a timer callback
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
    clearAll() {
      for (const handle of pendingTimers.values()) {
        clearTimeout(handle);
      }
      pendingTimers.clear();
      try {
        context.evalSync("__timers_clearCallbacks()");
      } catch {
        // Context may have been disposed
      }
    },

    dispose() {
      disposed = true;
      for (const handle of pendingTimers.values()) {
        clearTimeout(handle);
      }
      pendingTimers.clear();
      try {
        context.evalSync("__timers_clearCallbacks()");
      } catch {
        // Context may have been disposed
      }
    },
  };
}
