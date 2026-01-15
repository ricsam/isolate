# @ricsam/isolate-console

Console API with logging, timing, counting, and grouping for isolated-vm V8 sandbox.

## Installation

```bash
npm add @ricsam/isolate-console
```

## Usage

The console module uses a single `onEntry` callback that receives structured `ConsoleEntry` objects:

```typescript
import { setupConsole, type ConsoleEntry } from "@ricsam/isolate-console";

const handle = await setupConsole(context, {
  onEntry: (entry: ConsoleEntry) => {
    switch (entry.type) {
      case "output":
        console.log(`[${entry.level}]`, ...entry.args);
        break;
      case "time":
        console.log(`${entry.label}: ${entry.duration}ms`);
        break;
      case "count":
        console.log(`${entry.label}: ${entry.count}`);
        break;
      case "group":
        console.group(entry.label);
        break;
      case "groupEnd":
        console.groupEnd();
        break;
      // ... handle other entry types
    }
  },
});
```

### Simple Console Handler

For basic use cases where you just want to route output to console methods:

```typescript
import { setupConsole, simpleConsoleHandler } from "@ricsam/isolate-console";

const handle = await setupConsole(
  context,
  simpleConsoleHandler({
    log: (...args) => console.log("[sandbox]", ...args),
    warn: (...args) => console.warn("[sandbox]", ...args),
    error: (...args) => console.error("[sandbox]", ...args),
    info: (...args) => console.info("[sandbox]", ...args),
    debug: (...args) => console.debug("[sandbox]", ...args),
  })
);
```

## ConsoleEntry Types

The `ConsoleEntry` discriminated union type includes all possible console events:

```typescript
type ConsoleEntry =
  // Standard output (log, warn, error, info, debug)
  | { type: "output"; level: "log" | "warn" | "error" | "info" | "debug"; args: unknown[]; groupDepth: number }

  // console.dir()
  | { type: "dir"; value: unknown; groupDepth: number }

  // console.table()
  | { type: "table"; data: unknown; columns?: string[]; groupDepth: number }

  // console.timeEnd() - timer completed
  | { type: "time"; label: string; duration: number; groupDepth: number }

  // console.timeLog() - timer checkpoint
  | { type: "timeLog"; label: string; duration: number; args: unknown[]; groupDepth: number }

  // console.count()
  | { type: "count"; label: string; count: number; groupDepth: number }

  // console.countReset()
  | { type: "countReset"; label: string; groupDepth: number }

  // console.assert() - failed assertion
  | { type: "assert"; args: unknown[]; groupDepth: number }

  // console.group() or console.groupCollapsed()
  | { type: "group"; label: string; collapsed: boolean; groupDepth: number }

  // console.groupEnd()
  | { type: "groupEnd"; groupDepth: number }

  // console.clear()
  | { type: "clear" }

  // console.trace()
  | { type: "trace"; args: unknown[]; stack: string; groupDepth: number };
```

Each entry includes `groupDepth` (except `clear`) which indicates the current nesting level of console groups. This allows you to render output with proper indentation without tracking state yourself.

## Injected Globals

- `console.log`, `console.warn`, `console.error`, `console.debug`, `console.info`
- `console.trace`, `console.dir`, `console.table`
- `console.time`, `console.timeEnd`, `console.timeLog`
- `console.count`, `console.countReset`
- `console.group`, `console.groupCollapsed`, `console.groupEnd`
- `console.assert`, `console.clear`

## Usage in Isolate

```javascript
// Basic logging
console.log("Hello", { name: "World" });
console.warn("Warning message");
console.error("Error occurred");

// Timing
console.time("operation");
// ... do work ...
console.timeLog("operation", "checkpoint");
// ... more work ...
console.timeEnd("operation"); // Logs: "operation: 123ms"

// Counting
console.count("clicks");     // clicks: 1
console.count("clicks");     // clicks: 2
console.countReset("clicks");
console.count("clicks");     // clicks: 1

// Grouping
console.group("User Info");
console.log("Name: John");
console.log("Age: 30");
console.groupEnd();
```

## Entry Types Reference

| Entry Type | Description | Key Properties |
|------------|-------------|----------------|
| `output` | Standard logging (log, warn, error, info, debug) | `level`, `args` |
| `dir` | Object inspection | `value` |
| `table` | Tabular data display | `data`, `columns?` |
| `time` | Timer completion (timeEnd) | `label`, `duration` |
| `timeLog` | Timer checkpoint | `label`, `duration`, `args` |
| `count` | Counter increment | `label`, `count` |
| `countReset` | Counter reset | `label` |
| `assert` | Failed assertion | `args` |
| `group` | Group start | `label`, `collapsed` |
| `groupEnd` | Group end | - |
| `clear` | Console clear | - |
| `trace` | Stack trace | `args`, `stack` |

## License

MIT
