import ivm from "isolated-vm";

/**
 * Console entry types for structured console output.
 * Each entry type captures the specific data needed to render like DevTools.
 */
export type ConsoleEntry =
  | {
      type: "output";
      level: "log" | "warn" | "error" | "info" | "debug";
      args: unknown[];
      groupDepth: number;
    }
  | {
      /** Browser console output (from Playwright page, not sandbox) */
      type: "browserOutput";
      level: string;
      args: unknown[];
      timestamp: number;
    }
  | { type: "dir"; value: unknown; groupDepth: number }
  | { type: "table"; data: unknown; columns?: string[]; groupDepth: number }
  | { type: "time"; label: string; duration: number; groupDepth: number }
  | {
      type: "timeLog";
      label: string;
      duration: number;
      args: unknown[];
      groupDepth: number;
    }
  | { type: "count"; label: string; count: number; groupDepth: number }
  | { type: "countReset"; label: string; groupDepth: number }
  | { type: "assert"; args: unknown[]; groupDepth: number }
  | {
      type: "group";
      label: string;
      collapsed: boolean;
      groupDepth: number;
    }
  | { type: "groupEnd"; groupDepth: number }
  | { type: "clear" }
  | { type: "trace"; args: unknown[]; stack: string; groupDepth: number };

/**
 * Console options with a single structured callback.
 */
export interface ConsoleOptions {
  /**
   * Callback invoked for each console operation.
   * Receives a structured entry with all data needed to render the output.
   */
  onEntry?: (entry: ConsoleEntry) => void;
}

/**
 * Console handle for accessing internal state.
 */
export interface ConsoleHandle {
  dispose(): void;
  reset(): void;
  getTimers(): Map<string, number>;
  getCounters(): Map<string, number>;
  getGroupDepth(): number;
}


/**
 * Setup console API in an isolated-vm context
 *
 * Injects console.log, console.warn, console.error, console.info, console.debug,
 * console.trace, console.dir, console.table, console.time, console.timeEnd,
 * console.timeLog, console.count, console.countReset, console.group,
 * console.groupCollapsed, console.groupEnd, console.clear, console.assert
 *
 * @example
 * const handle = await setupConsole(context, {
 *   onEntry: (entry) => {
 *     if (entry.type === 'output') {
 *       console.log(`[${entry.level}]`, ...entry.args);
 *     }
 *   }
 * });
 */
export async function setupConsole(
  context: ivm.Context,
  options?: ConsoleOptions
): Promise<ConsoleHandle> {
  const opts = options ?? {};

  // State management
  const timers = new Map<string, number>();
  const counters = new Map<string, number>();
  let groupDepth = 0;

  const global = context.global;

  // Log-level methods (output type)
  const logLevels = ["log", "warn", "error", "debug", "info"] as const;

  for (const level of logLevels) {
    global.setSync(
      `__console_${level}`,
      new ivm.Callback((...args: unknown[]) => {
        opts.onEntry?.({
          type: "output",
          level,
          args,
          groupDepth,
        });
      })
    );
  }

  // dir method
  global.setSync(
    "__console_dir",
    new ivm.Callback((value: unknown) => {
      opts.onEntry?.({
        type: "dir",
        value,
        groupDepth,
      });
    })
  );

  // table method
  global.setSync(
    "__console_table",
    new ivm.Callback((data: unknown, columns?: string[]) => {
      opts.onEntry?.({
        type: "table",
        data,
        columns,
        groupDepth,
      });
    })
  );

  // trace method (includes stack)
  global.setSync(
    "__console_trace",
    new ivm.Callback((...args: unknown[]) => {
      const stack = new Error().stack ?? "";
      opts.onEntry?.({
        type: "trace",
        args,
        stack,
        groupDepth,
      });
    })
  );

  // Timing methods
  global.setSync(
    "__console_time",
    new ivm.Callback((label?: string) => {
      const l = label ?? "default";
      timers.set(l, performance.now());
    })
  );

  global.setSync(
    "__console_timeEnd",
    new ivm.Callback((label?: string) => {
      const l = label ?? "default";
      const start = timers.get(l);
      if (start !== undefined) {
        const duration = performance.now() - start;
        timers.delete(l);
        opts.onEntry?.({
          type: "time",
          label: l,
          duration,
          groupDepth,
        });
      }
    })
  );

  global.setSync(
    "__console_timeLog",
    new ivm.Callback((label?: string, ...args: unknown[]) => {
      const l = label ?? "default";
      const start = timers.get(l);
      if (start !== undefined) {
        const duration = performance.now() - start;
        opts.onEntry?.({
          type: "timeLog",
          label: l,
          duration,
          args,
          groupDepth,
        });
      }
    })
  );

  // Counting methods
  global.setSync(
    "__console_count",
    new ivm.Callback((label?: string) => {
      const l = label ?? "default";
      const count = (counters.get(l) ?? 0) + 1;
      counters.set(l, count);
      opts.onEntry?.({
        type: "count",
        label: l,
        count,
        groupDepth,
      });
    })
  );

  global.setSync(
    "__console_countReset",
    new ivm.Callback((label?: string) => {
      const l = label ?? "default";
      counters.delete(l);
      opts.onEntry?.({
        type: "countReset",
        label: l,
        groupDepth,
      });
    })
  );

  // Grouping methods
  global.setSync(
    "__console_group",
    new ivm.Callback((label?: string) => {
      const l = label ?? "default";
      opts.onEntry?.({
        type: "group",
        label: l,
        collapsed: false,
        groupDepth,
      });
      groupDepth++;
    })
  );

  global.setSync(
    "__console_groupCollapsed",
    new ivm.Callback((label?: string) => {
      const l = label ?? "default";
      opts.onEntry?.({
        type: "group",
        label: l,
        collapsed: true,
        groupDepth,
      });
      groupDepth++;
    })
  );

  global.setSync(
    "__console_groupEnd",
    new ivm.Callback(() => {
      if (groupDepth > 0) {
        groupDepth--;
      }
      opts.onEntry?.({
        type: "groupEnd",
        groupDepth,
      });
    })
  );

  // Other methods
  global.setSync(
    "__console_clear",
    new ivm.Callback(() => {
      opts.onEntry?.({ type: "clear" });
    })
  );

  global.setSync(
    "__console_assert",
    new ivm.Callback((condition: boolean, ...args: unknown[]) => {
      if (!condition) {
        opts.onEntry?.({
          type: "assert",
          args,
          groupDepth,
        });
      }
    })
  );

  // Inject console object
  context.evalSync(`
    globalThis.console = {
      log: __console_log,
      warn: __console_warn,
      error: __console_error,
      debug: __console_debug,
      info: __console_info,
      trace: __console_trace,
      dir: __console_dir,
      table: __console_table,
      time: __console_time,
      timeEnd: __console_timeEnd,
      timeLog: __console_timeLog,
      count: __console_count,
      countReset: __console_countReset,
      group: __console_group,
      groupCollapsed: __console_groupCollapsed,
      groupEnd: __console_groupEnd,
      clear: __console_clear,
      assert: __console_assert,
    };
  `);

  return {
    dispose() {
      timers.clear();
      counters.clear();
      groupDepth = 0;
    },
    reset() {
      timers.clear();
      counters.clear();
      groupDepth = 0;
    },
    getTimers() {
      return new Map(timers);
    },
    getCounters() {
      return new Map(counters);
    },
    getGroupDepth() {
      return groupDepth;
    },
  };
}
