import ivm from "isolated-vm";

export interface ConsoleOptions {
  onLog?: (level: string, ...args: unknown[]) => void;
  onTime?: (label: string, duration: number) => void;
  onTimeLog?: (label: string, duration: number, ...args: unknown[]) => void;
  onCount?: (label: string, count: number) => void;
  onCountReset?: (label: string) => void;
  onGroup?: (label: string, collapsed: boolean) => void;
  onGroupEnd?: () => void;
  onClear?: () => void;
  onAssert?: (condition: boolean, ...args: unknown[]) => void;
}

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
 *   onLog: (level, ...args) => console.log(`[${level}]`, ...args)
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

  // Log-level methods
  const logLevels = [
    "log",
    "warn",
    "error",
    "debug",
    "info",
    "trace",
    "dir",
    "table",
  ];

  for (const level of logLevels) {
    global.setSync(
      `__console_${level}`,
      new ivm.Callback((...args: unknown[]) => {
        opts.onLog?.(level, ...args);
      })
    );
  }

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
        opts.onTime?.(l, duration);
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
        opts.onTimeLog?.(l, duration, ...args);
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
      opts.onCount?.(l, count);
    })
  );

  global.setSync(
    "__console_countReset",
    new ivm.Callback((label?: string) => {
      const l = label ?? "default";
      counters.delete(l);
      opts.onCountReset?.(l);
    })
  );

  // Grouping methods
  global.setSync(
    "__console_group",
    new ivm.Callback((label?: string) => {
      const l = label ?? "default";
      groupDepth++;
      opts.onGroup?.(l, false);
    })
  );

  global.setSync(
    "__console_groupCollapsed",
    new ivm.Callback((label?: string) => {
      const l = label ?? "default";
      groupDepth++;
      opts.onGroup?.(l, true);
    })
  );

  global.setSync(
    "__console_groupEnd",
    new ivm.Callback(() => {
      if (groupDepth > 0) {
        groupDepth--;
      }
      opts.onGroupEnd?.();
    })
  );

  // Other methods
  global.setSync(
    "__console_clear",
    new ivm.Callback(() => {
      opts.onClear?.();
    })
  );

  global.setSync(
    "__console_assert",
    new ivm.Callback((condition: boolean, ...args: unknown[]) => {
      if (!condition) {
        opts.onAssert?.(condition, ...args);
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
