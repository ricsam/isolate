import type { ConsoleOptions } from "./index.ts";

/**
 * Simple console callback interface for basic usage.
 */
export interface SimpleConsoleCallbacks {
  log?: (message: string) => void;
  warn?: (message: string) => void;
  error?: (message: string) => void;
  info?: (message: string) => void;
  debug?: (message: string) => void;
}

/**
 * Helper to create ConsoleOptions from simple callbacks.
 * Routes log-level outputs to the appropriate callback and handles assertions.
 *
 * @example
 * ```typescript
 * const runtime = await createRuntime({
 *   console: simpleConsoleHandler({
 *     log: (msg) => console.log('[sandbox]', msg),
 *     warn: (msg) => console.warn('[sandbox]', msg),
 *     error: (msg) => console.error('[sandbox]', msg),
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
        callbacks[entry.level]?.(entry.stdout);
      } else if (entry.type === "assert") {
        callbacks.error?.(entry.stdout);
      } else if (entry.type === "trace") {
        callbacks.log?.(entry.stack);
      } else if (entry.type === "dir") {
        callbacks.log?.(entry.stdout);
      } else if (entry.type === "table") {
        callbacks.log?.(entry.stdout);
      } else if (entry.type === "time") {
        callbacks.log?.(`${entry.label}: ${entry.duration.toFixed(2)}ms`);
      } else if (entry.type === "timeLog") {
        const timeMsg = `${entry.label}: ${entry.duration.toFixed(2)}ms`;
        callbacks.log?.(entry.stdout ? `${timeMsg} ${entry.stdout}` : timeMsg);
      } else if (entry.type === "count") {
        callbacks.log?.(`${entry.label}: ${entry.count}`);
      }
      // group, groupEnd, countReset, clear are silently ignored
    },
  };
}
