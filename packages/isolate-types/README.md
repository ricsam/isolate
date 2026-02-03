# @ricsam/isolate-types

Type definitions and type-checking utilities for isolate user code.

## Installation

```bash
npm add @ricsam/isolate-types
```

## Type Checking Isolate Code

Validate TypeScript/JavaScript code that will run inside the isolate before execution using `ts-morph`:

```typescript
import { typecheckIsolateCode } from "@ricsam/isolate-types";

const result = typecheckIsolateCode(`
  serve({
    fetch(request, server) {
      const url = new URL(request.url);

      if (url.pathname === "/ws") {
        server.upgrade(request, { data: { userId: 123 } });
        return new Response(null, { status: 101 });
      }

      return Response.json({ message: "Hello!" });
    },
    websocket: {
      message(ws, message) {
        ws.send("Echo: " + message);
      }
    }
  });
`, { include: ["core", "fetch"] });

if (!result.success) {
  console.error("Type errors found:");
  for (const error of result.errors) {
    console.error(`  Line ${error.line}: ${error.message}`);
  }
}
```

## Options

| Option | Description |
|--------|-------------|
| `include` | Which package types to include: `"core"`, `"fetch"`, `"fs"`, `"console"`, `"encoding"`, `"timers"`, `"testEnvironment"`, `"playwright"` (default: `["core", "fetch", "fs"]`) |
| `compilerOptions` | Additional TypeScript compiler options |
| `libraryTypes` | External library type definitions for import resolution |

## Using with Tests

```typescript
import { describe, expect, test } from "node:test";
import { typecheckIsolateCode } from "@ricsam/isolate-types";

describe("Isolate code validation", () => {
  test("server code is type-safe", () => {
    const result = typecheckIsolateCode(userProvidedCode, {
      include: ["fetch"]
    });
    expect(result.success).toBe(true);
  });
});
```

## Type Definition Strings

The type definitions are exported as strings for custom use cases:

```typescript
import {
  CORE_TYPES,       // ReadableStream, Blob, File, URL, etc.
  CONSOLE_TYPES,    // console.log, console.time, etc.
  CRYPTO_TYPES,     // crypto.subtle, CryptoKey, etc.
  ENCODING_TYPES,   // atob, btoa
  FETCH_TYPES,      // fetch, Request, Response, serve, etc.
  FS_TYPES,         // getDirectory, FileSystemHandle, etc.
  PATH_TYPES,       // path.join, path.resolve, etc.
  TEST_ENV_TYPES,   // describe, it, expect, etc.
  TIMERS_TYPES,     // setTimeout, setInterval, etc.
  PLAYWRIGHT_TYPES, // page, context, browser, Locator, etc.
  TYPE_DEFINITIONS  // All types as { core, fetch, fs, playwright, ... }
} from "@ricsam/isolate-types";

// Use with your own ts-morph project
project.createSourceFile("isolate-globals.d.ts", FETCH_TYPES);
```

## License

MIT
