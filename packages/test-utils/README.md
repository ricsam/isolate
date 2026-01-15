# @ricsam/isolate-test-utils

Testing utilities for isolated-vm V8 sandbox development.

## Installation

```bash
npm add @ricsam/isolate-test-utils
```

## Usage

```typescript
import { createRuntimeTestContext } from "@ricsam/isolate-test-utils";

// Create a test context with all APIs set up
const ctx = await createRuntimeTestContext({ fs: true });

// Set up mock response for fetch
ctx.setMockResponse({ status: 200, body: '{"data": "test"}' });

// Run code
await ctx.context.eval(`
  (async () => {
    console.log("Starting fetch...");
    const response = await fetch("https://api.example.com/data");
    const data = await response.json();
    console.log("Got data:", data);
  })()
`, { promise: true });

// Check captured logs
console.log(ctx.logs);
// [{ level: "log", args: ["Starting fetch..."] }, ...]

// Check captured fetch calls
console.log(ctx.fetchCalls);
// [{ url: "https://api.example.com/data", method: "GET", headers: [...] }]

// Cleanup
ctx.dispose();
```

## RuntimeTestContext

```typescript
interface RuntimeTestContext {
  isolate: ivm.Isolate;
  context: ivm.Context;
  tick(ms?: number): Promise<void>;
  dispose(): void;
  logs: Array<{ level: string; args: unknown[] }>;
  fetchCalls: Array<{ url: string; method: string; headers: [string, string][] }>;
  setMockResponse(response: MockResponse): void;
  mockFs: MockFileSystem;
}

interface MockResponse {
  status?: number;
  body?: string;
  headers?: Record<string, string>;
}
```

## Options

```typescript
interface RuntimeTestContextOptions {
  fs?: boolean; // Enable file system APIs with mock file system
}
```

## License

MIT
