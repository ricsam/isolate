# @ricsam/isolate-console

Console API with logging, timing, counting, and grouping for isolated-vm V8 sandbox.

## Installation

```bash
npm add @ricsam/isolate-console
```

## Usage

The console module uses a single `onEntry` callback that receives structured `ConsoleEntry` objects. Output is pre-formatted as `stdout` strings (like Node.js console output) inside the sandbox:

```typescript
import { setupConsole, type ConsoleEntry } from "@ricsam/isolate-console";

const handle = await setupConsole(context, {
  onEntry: (entry: ConsoleEntry) => {
    switch (entry.type) {
      case "output":
        console.log(`[${entry.level}]`, entry.stdout);
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
    log: (msg) => console.log("[sandbox]", msg),
    warn: (msg) => console.warn("[sandbox]", msg),
    error: (msg) => console.error("[sandbox]", msg),
    info: (msg) => console.info("[sandbox]", msg),
    debug: (msg) => console.debug("[sandbox]", msg),
  })
);
```

## ConsoleEntry Types

The `ConsoleEntry` discriminated union type includes all possible console events. Output is pre-formatted as `stdout` strings inside the sandbox (like Node.js console):

```typescript
type ConsoleEntry =
  // Standard output (log, warn, error, info, debug)
  | { type: "output"; level: "log" | "warn" | "error" | "info" | "debug"; stdout: string; groupDepth: number }

  // console.dir()
  | { type: "dir"; stdout: string; groupDepth: number }

  // console.table()
  | { type: "table"; stdout: string; groupDepth: number }

  // console.timeEnd() - timer completed
  | { type: "time"; label: string; duration: number; groupDepth: number }

  // console.timeLog() - timer checkpoint
  | { type: "timeLog"; label: string; duration: number; stdout: string; groupDepth: number }

  // console.count()
  | { type: "count"; label: string; count: number; groupDepth: number }

  // console.countReset()
  | { type: "countReset"; label: string; groupDepth: number }

  // console.assert() - failed assertion
  | { type: "assert"; stdout: string; groupDepth: number }

  // console.group() or console.groupCollapsed()
  | { type: "group"; label: string; collapsed: boolean; groupDepth: number }

  // console.groupEnd()
  | { type: "groupEnd"; groupDepth: number }

  // console.clear()
  | { type: "clear" }

  // console.trace()
  | { type: "trace"; stdout: string; stack: string; groupDepth: number };
```

Each entry includes `groupDepth` (except `clear`) which indicates the current nesting level of console groups. This allows you to render output with proper indentation without tracking state yourself.

## Output Formatting

Console output is formatted inside the sandbox using Node.js-style formatting rules:

- **Strings**: passed as-is at top level, quoted in objects/arrays
- **Numbers/booleans**: converted to string
- **Functions**: `[Function: name]` or `[Function: (anonymous)]`
- **Arrays**: `[ 1, 2, 3 ]`
- **Objects**: `{ key: value }`
- **Errors**: `Error: message` with stack trace
- **Response/Request**: `Response { status: 200, ... }`
- **Map/Set**: `Map(n) { ... }`, `Set(n) { ... }`
- **Date**: ISO string
- **Circular refs**: `[Circular]`
- **Deep objects**: `[Object]` at depth limit (default 2)

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
console.log("Hello", { name: "World" });  // "Hello { name: 'World' }"
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
| `output` | Standard logging (log, warn, error, info, debug) | `level`, `stdout` |
| `dir` | Object inspection | `stdout` |
| `table` | Tabular data display (ASCII table) | `stdout` |
| `time` | Timer completion (timeEnd) | `label`, `duration` |
| `timeLog` | Timer checkpoint | `label`, `duration`, `stdout` |
| `count` | Counter increment | `label`, `count` |
| `countReset` | Counter reset | `label` |
| `assert` | Failed assertion | `stdout` |
| `group` | Group start | `label`, `collapsed` |
| `groupEnd` | Group end | - |
| `clear` | Console clear | - |
| `trace` | Stack trace | `stdout`, `stack` |

## License

MIT
