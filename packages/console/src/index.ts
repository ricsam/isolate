import ivm from "isolated-vm";

/**
 * Console entry types for structured console output.
 * Each entry type captures the specific data needed to render like DevTools.
 * Output is pre-formatted as stdout strings (like Node.js console) inside the sandbox.
 */
export type ConsoleEntry =
  | {
      type: "output";
      level: "log" | "warn" | "error" | "info" | "debug";
      stdout: string;
      groupDepth: number;
    }
  | {
      /** Browser console output (from Playwright page, not sandbox) */
      type: "browserOutput";
      level: string;
      stdout: string;
      timestamp: number;
    }
  | { type: "dir"; stdout: string; groupDepth: number }
  | { type: "table"; stdout: string; groupDepth: number }
  | { type: "time"; label: string; duration: number; groupDepth: number }
  | {
      type: "timeLog";
      label: string;
      duration: number;
      stdout: string;
      groupDepth: number;
    }
  | { type: "count"; label: string; count: number; groupDepth: number }
  | { type: "countReset"; label: string; groupDepth: number }
  | { type: "assert"; stdout: string; groupDepth: number }
  | {
      type: "group";
      label: string;
      collapsed: boolean;
      groupDepth: number;
    }
  | { type: "groupEnd"; groupDepth: number }
  | { type: "clear" }
  | { type: "trace"; stdout: string; stack: string; groupDepth: number };

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
      new ivm.Callback((stdout: string) => {
        opts.onEntry?.({
          type: "output",
          level,
          stdout,
          groupDepth,
        });
      })
    );
  }

  // dir method
  global.setSync(
    "__console_dir",
    new ivm.Callback((stdout: string) => {
      opts.onEntry?.({
        type: "dir",
        stdout,
        groupDepth,
      });
    })
  );

  // table method
  global.setSync(
    "__console_table",
    new ivm.Callback((stdout: string) => {
      opts.onEntry?.({
        type: "table",
        stdout,
        groupDepth,
      });
    })
  );

  // trace method (includes stack)
  global.setSync(
    "__console_trace",
    new ivm.Callback((stdout: string, stack: string) => {
      opts.onEntry?.({
        type: "trace",
        stdout,
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
    new ivm.Callback((label: string, duration: number, stdout: string) => {
      const l = label ?? "default";
      const start = timers.get(l);
      if (start !== undefined) {
        const actualDuration = performance.now() - start;
        opts.onEntry?.({
          type: "timeLog",
          label: l,
          duration: actualDuration,
          stdout,
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
    new ivm.Callback((stdout: string) => {
      opts.onEntry?.({
        type: "assert",
        stdout,
        groupDepth,
      });
    })
  );

  // Inject console object with Node.js-style formatting
  context.evalSync(`
    // Format a single value for console output (Node.js style)
    function __formatForConsole(value, options = {}) {
      const { depth = 2, currentDepth = 0, seen = new WeakSet(), inObject = false } = options;

      // Handle null/undefined
      if (value === null) return 'null';
      if (value === undefined) return 'undefined';

      // Handle primitives
      const type = typeof value;
      if (type === 'string') {
        // Strings: quoted when inside objects/arrays, raw when top-level console.log arg
        return inObject ? "'" + value.replace(/'/g, "\\\\'") + "'" : value;
      }
      if (type === 'number' || type === 'boolean') {
        return String(value);
      }
      if (type === 'bigint') {
        return value.toString() + 'n';
      }
      if (type === 'symbol') {
        return value.toString();
      }
      if (type === 'function') {
        const name = value.name || '(anonymous)';
        return '[Function: ' + name + ']';
      }

      // Handle objects
      if (type === 'object') {
        // Handle circular references BEFORE depth check (Node.js behavior)
        if (seen.has(value)) {
          return '[Circular]';
        }
        seen.add(value);

        // Check depth limit
        if (currentDepth >= depth) {
          if (Array.isArray(value)) return '[Array]';
          return '[Object]';
        }

        const nextOptions = { depth, currentDepth: currentDepth + 1, seen, inObject: true };

        // Handle Error objects
        if (value instanceof Error) {
          let result = value.name + ': ' + value.message;
          if (value.stack) {
            // Get stack lines after the first line (which is the error message)
            const stackLines = value.stack.split('\\n').slice(1);
            if (stackLines.length > 0) {
              result += '\\n' + stackLines.join('\\n');
            }
          }
          return result;
        }

        // Handle Response objects
        if (typeof Response !== 'undefined' && value instanceof Response) {
          return 'Response { status: ' + value.status + ', statusText: ' + __formatForConsole(value.statusText, nextOptions) + ', url: ' + __formatForConsole(value.url, nextOptions) + ' }';
        }

        // Handle Request objects
        if (typeof Request !== 'undefined' && value instanceof Request) {
          return 'Request { method: ' + __formatForConsole(value.method, nextOptions) + ', url: ' + __formatForConsole(value.url, nextOptions) + ' }';
        }

        // Handle Headers objects
        if (typeof Headers !== 'undefined' && value instanceof Headers) {
          const entries = [];
          value.forEach((v, k) => {
            entries.push(__formatForConsole(k, nextOptions) + ' => ' + __formatForConsole(v, nextOptions));
          });
          return 'Headers { ' + entries.join(', ') + ' }';
        }

        // Handle Date objects
        if (value instanceof Date) {
          return value.toISOString();
        }

        // Handle RegExp
        if (value instanceof RegExp) {
          return value.toString();
        }

        // Handle Map
        if (value instanceof Map) {
          const entries = [];
          value.forEach((v, k) => {
            entries.push(__formatForConsole(k, nextOptions) + ' => ' + __formatForConsole(v, nextOptions));
          });
          return 'Map(' + value.size + ') { ' + entries.join(', ') + ' }';
        }

        // Handle Set
        if (value instanceof Set) {
          const entries = [];
          value.forEach((v) => {
            entries.push(__formatForConsole(v, nextOptions));
          });
          return 'Set(' + value.size + ') { ' + entries.join(', ') + ' }';
        }

        // Handle ArrayBuffer and TypedArrays
        if (value instanceof ArrayBuffer) {
          return 'ArrayBuffer { byteLength: ' + value.byteLength + ' }';
        }
        if (ArrayBuffer.isView(value) && !(value instanceof DataView)) {
          const typedArray = value;
          const name = typedArray.constructor.name;
          const length = typedArray.length;
          if (length <= 10) {
            const items = Array.from(typedArray).map(v => __formatForConsole(v, nextOptions));
            return name + '(' + length + ') [ ' + items.join(', ') + ' ]';
          }
          return name + '(' + length + ') [ ... ]';
        }

        // Handle Promise
        if (value instanceof Promise) {
          return 'Promise { <pending> }';
        }

        // Handle arrays
        if (Array.isArray(value)) {
          if (value.length === 0) return '[]';
          const items = value.map(item => __formatForConsole(item, nextOptions));
          return '[ ' + items.join(', ') + ' ]';
        }

        // Handle plain objects
        const keys = Object.keys(value);
        if (keys.length === 0) return '{}';
        const entries = keys.map(key => {
          const formattedKey = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(key) ? key : __formatForConsole(key, nextOptions);
          return formattedKey + ': ' + __formatForConsole(value[key], nextOptions);
        });
        return '{ ' + entries.join(', ') + ' }';
      }

      return String(value);
    }

    // Format multiple args with space separation (like console.log)
    function __formatArgs(args) {
      return args.map((arg, i) => __formatForConsole(arg, { inObject: false })).join(' ');
    }

    // Format data for console.table - creates ASCII table
    function __formatTable(data, columns) {
      if (data === null || data === undefined) {
        return __formatForConsole(data);
      }

      // Convert to array of objects
      let rows = [];
      let headers = new Set();

      if (Array.isArray(data)) {
        rows = data.map((item, index) => {
          if (item !== null && typeof item === 'object' && !Array.isArray(item)) {
            Object.keys(item).forEach(k => headers.add(k));
            return { __index: index, ...item };
          }
          return { __index: index, Values: item };
        });
        headers.add('Values');
      } else if (typeof data === 'object') {
        Object.keys(data).forEach(key => {
          const item = data[key];
          if (item !== null && typeof item === 'object' && !Array.isArray(item)) {
            Object.keys(item).forEach(k => headers.add(k));
            rows.push({ __index: key, ...item });
          } else {
            rows.push({ __index: key, Values: item });
            headers.add('Values');
          }
        });
      } else {
        return __formatForConsole(data);
      }

      // Filter headers by columns if provided
      let headerList = ['(index)', ...headers];
      headerList = headerList.filter(h => h !== '__index');
      if (columns && Array.isArray(columns)) {
        headerList = ['(index)', ...columns.filter(c => headers.has(c))];
      }

      // Calculate column widths
      const colWidths = {};
      headerList.forEach(h => {
        colWidths[h] = h === '(index)' ? 7 : h.length;
      });
      rows.forEach(row => {
        headerList.forEach(h => {
          const key = h === '(index)' ? '__index' : h;
          const val = row[key];
          const formatted = val !== undefined ? __formatForConsole(val, { depth: 1, inObject: true }) : '';
          colWidths[h] = Math.max(colWidths[h], formatted.length);
        });
      });

      // Build table
      const sep = '+' + headerList.map(h => '-'.repeat(colWidths[h] + 2)).join('+') + '+';
      const headerRow = '|' + headerList.map(h => ' ' + h.padEnd(colWidths[h]) + ' ').join('|') + '|';

      const dataRows = rows.map(row => {
        return '|' + headerList.map(h => {
          const key = h === '(index)' ? '__index' : h;
          const val = row[key];
          const formatted = val !== undefined ? __formatForConsole(val, { depth: 1, inObject: true }) : '';
          return ' ' + formatted.padEnd(colWidths[h]) + ' ';
        }).join('|') + '|';
      });

      return [sep, headerRow, sep, ...dataRows, sep].join('\\n');
    }

    globalThis.console = {
      log: (...args) => __console_log(__formatArgs(args)),
      warn: (...args) => __console_warn(__formatArgs(args)),
      error: (...args) => __console_error(__formatArgs(args)),
      debug: (...args) => __console_debug(__formatArgs(args)),
      info: (...args) => __console_info(__formatArgs(args)),
      trace: (...args) => {
        const err = new Error();
        const stack = err.stack || '';
        // Remove the first two lines (Error and the trace call itself)
        const stackLines = stack.split('\\n').slice(2).join('\\n');
        __console_trace(__formatArgs(args), 'Trace' + (args.length > 0 ? ': ' + __formatArgs(args) : '') + '\\n' + stackLines);
      },
      dir: (value, options) => __console_dir(__formatForConsole(value, { depth: options?.depth ?? 2, inObject: true })),
      table: (data, columns) => __console_table(__formatTable(data, columns)),
      time: __console_time,
      timeEnd: __console_timeEnd,
      timeLog: (label, ...args) => __console_timeLog(label ?? 'default', 0, __formatArgs(args)),
      count: __console_count,
      countReset: __console_countReset,
      group: __console_group,
      groupCollapsed: __console_groupCollapsed,
      groupEnd: __console_groupEnd,
      clear: __console_clear,
      assert: (condition, ...args) => {
        if (!condition) {
          const msg = args.length > 0 ? __formatArgs(args) : 'console.assert';
          __console_assert('Assertion failed: ' + msg);
        }
      },
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
