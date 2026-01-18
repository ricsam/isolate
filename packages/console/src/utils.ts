import type { ConsoleOptions } from "./index.ts";

/**
 * Simple console callback interface for basic usage.
 */
export interface SimpleConsoleCallbacks {
  log?: (...args: unknown[]) => void;
  warn?: (...args: unknown[]) => void;
  error?: (...args: unknown[]) => void;
  info?: (...args: unknown[]) => void;
  debug?: (...args: unknown[]) => void;
}

/**
 * Helper to create ConsoleOptions from simple callbacks.
 * Routes log-level outputs to the appropriate callback and handles assertions.
 *
 * @example
 * ```typescript
 * const runtime = await createRuntime({
 *   console: simpleConsoleHandler({
 *     log: (...args) => console.log('[sandbox]', ...args),
 *     warn: (...args) => console.warn('[sandbox]', ...args),
 *     error: (...args) => console.error('[sandbox]', ...args),
 *   })
 * });
 * ```
 */
export function simpleConsoleHandler(
  callbacks: SimpleConsoleCallbacks
): ConsoleOptions {
  return {
    onEntry: (entry) => {
      if (entry.type === "output") {
        callbacks[entry.level]?.(...entry.args);
      } else if (entry.type === "assert") {
        callbacks.error?.("Assertion failed:", ...entry.args);
      } else if (entry.type === "trace") {
        callbacks.log?.(...entry.args, "\n" + entry.stack);
      } else if (entry.type === "dir") {
        callbacks.log?.(entry.value);
      } else if (entry.type === "table") {
        callbacks.log?.(entry.data);
      } else if (entry.type === "time") {
        callbacks.log?.(`${entry.label}: ${entry.duration.toFixed(2)}ms`);
      } else if (entry.type === "timeLog") {
        callbacks.log?.(
          `${entry.label}: ${entry.duration.toFixed(2)}ms`,
          ...entry.args
        );
      } else if (entry.type === "count") {
        callbacks.log?.(`${entry.label}: ${entry.count}`);
      }
      // group, groupEnd, groupEnd, countReset, clear are silently ignored
    },
  };
}
