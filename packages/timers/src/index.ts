import type ivm from "isolated-vm";

export interface TimersHandle {
  /** Process any pending timers */
  tick(): Promise<void>;
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
 * @example
 * const handle = await setupTimers(context);
 * await context.eval(`
 *   setTimeout(() => console.log("hello"), 1000);
 * `);
 * await handle.tick(); // Process pending timers
 */
export async function setupTimers(
  context: ivm.Context
): Promise<TimersHandle> {
  // TODO: Implement timers setup for isolated-vm
  return {
    async tick() {
      // TODO: Process pending timers
    },
    clearAll() {
      // TODO: Clear all pending timers
    },
    dispose() {
      // TODO: Cleanup resources
    },
  };
}
