# @ricsam/isolate

`@ricsam/isolate` is a runtime-centric JavaScript sandbox built on an async-context-enabled [`@ricsam/isolated-vm`](https://github.com/ricsam/isolated-vm) engine build. It gives you a single host API for running isolated code with web-style capabilities such as `fetch`, files, streams, server handlers, module loading, and Playwright-backed browser tests.

## Installation

```bash
npm add @ricsam/isolate @ricsam/isolated-vm
```

The `@ricsam/isolated-vm` peer includes the `createContext({ asyncContext: true })` support required by this repo. Upstream `isolated-vm` will fail fast during runtime boot with a clear AsyncContext error.

Install Playwright when you want browser runtimes:

```bash
npm add playwright
```

## What You Get

`@ricsam/isolate` exports a small top-level API:

- `createIsolateHost()` to start, connect to, and manage isolate-backed runtimes
- `createModuleResolver()` to provide virtual modules, source trees, mounted `node_modules`, and fallback resolution
- `createFileBindings()` to expose a rooted file API to sandboxed code
- `getTypeProfile()`, `typecheck()`, and `formatTypecheckErrors()` for sandbox-aware TypeScript tooling

The host can create three runtime styles:

- `host.createRuntime()` for scripts, agents, and ad hoc execution
- `host.createAppServer()` for `serve()`-based request handlers
- `host.createBrowserRuntime()` for Playwright-backed execution

## Host Bindings

Each runtime is configured through `bindings`, which describe how sandboxed code talks to the host:

- `console` forwards runtime and browser console output
- `fetch` handles outbound HTTP requests from the sandbox
- `files` exposes a safe, root-scoped filesystem
- `modules` resolves virtual modules, source trees, and mounted packages
- `tools` exposes async host functions and async iterators

Every host callback receives a `HostCallContext` with an `AbortSignal`, runtime identity, resource identity, and request metadata.

## Async Context

Runtimes created by `@ricsam/isolate` enable the TC39 proposal-style `AsyncContext` global inside the sandbox. This is an experimental surface for now, and the proposal API is used to implement the `node:async_hooks` shim exported to sandboxed code.

This shim is intended for async context propagation inside the sandbox. It is not a full reimplementation of Node's `async_hooks` lifecycle, resource graph, or profiling APIs.

What is currently supported:

- `AsyncContext.Variable`
- `AsyncContext.Snapshot`
- `node:async_hooks` `AsyncLocalStorage`
- `node:async_hooks` `AsyncResource`

What is intentionally not implemented in `node:async_hooks` yet:

- `createHook()`
- `executionAsyncId()`
- `triggerAsyncId()`
- `executionAsyncResource()`
- `asyncWrapProviders`

## Quick Start

```ts
import {
  createFileBindings,
  createIsolateHost,
  createModuleResolver,
} from "@ricsam/isolate";

const host = await createIsolateHost({
  daemon: {
    socketPath: "/tmp/isolate.sock",
  },
});

const runtime = await host.createRuntime({
  bindings: {
    console: {
      onEntry(entry) {
        if (entry.type === "output") {
          console.log(entry.stdout);
        }
      },
    },
    fetch: async (request) => await fetch(request),
    files: createFileBindings({
      root: process.cwd(),
      allowWrite: true,
    }),
    modules: createModuleResolver()
      .virtual(
        "@/env",
        `export const mode = "sandbox";`,
        { filename: "env.ts", resolveDir: "/app" },
      )
      .virtual(
        "/app/main.ts",
        `
          import { mode } from "@/env";

          const response = await fetch("https://example.com");
          console.log("mode:", mode);
          console.log("status:", response.status);
          console.log(await greet("isolate"));
        `,
        { filename: "main.ts", resolveDir: "/app" },
      ),
    tools: {
      greet: async (name: string) => `hello ${name}`,
    },
  },
});

try {
  await runtime.eval(`import "/app/main.ts";`, { filename: "/app/entry.ts" });
} finally {
  await runtime.dispose();
  await host.close();
}
```

## App Servers

`createAppServer()` is the long-lived server-oriented API. It boots a runtime around an entry module that calls `serve()` and then lets the host dispatch requests into it.

```ts
import { createIsolateHost, createModuleResolver } from "@ricsam/isolate";

const host = await createIsolateHost();
const server = await host.createAppServer({
  key: "example/server",
  entry: "/server.ts",
  bindings: {
    modules: createModuleResolver().virtual(
      "/server.ts",
      `
        serve({
          fetch(request) {
            return Response.json({
              pathname: new URL(request.url).pathname,
            });
          },
        });
      `,
    ),
  },
});

const result = await server.handle(new Request("http://localhost/hello"));
if (result.type === "response") {
  console.log(await result.response.json());
}

await server.dispose();
await host.close();
```

`server.handle()` returns either a normal HTTP response or WebSocket upgrade metadata. The `server.ws` helpers let the host continue an upgraded connection by sending open, message, close, and error events back into the runtime.

## Browser Runtimes

`createBrowserRuntime()` runs sandboxed code against a Playwright page while keeping the host in control of file access, diagnostics, and browser event collection.

```ts
import { chromium } from "playwright";
import { createIsolateHost } from "@ricsam/isolate";

const browser = await chromium.launch();
const context = await browser.newContext();
const page = await context.newPage();

const host = await createIsolateHost();
const runtime = await host.createBrowserRuntime({
  key: "example/browser",
  bindings: {},
  features: { tests: true },
  browser: {
    page,
    captureConsole: true,
  },
});

const result = await runtime.run(
  `
    test("loads a page", async () => {
      await page.goto("https://example.com");
      await expect(page).toHaveTitle(/Example Domain/);
    });
  `,
  {
    filename: "/browser-test.ts",
    asTestSuite: true,
    timeoutMs: 10_000,
  },
);

console.log(result.tests);

await runtime.dispose();
await context.close();
await browser.close();
await host.close();
```

## Module Resolution

`createModuleResolver()` is a fluent builder. You can mix and match:

- `virtual(specifier, source, options)` for inline modules
- `virtualFile(specifier, filePath, options)` for a host file mapped to a virtual specifier
- `sourceTree(prefix, loader)` for lazy source loading under a virtual path
- `mountNodeModules(virtualMount, hostPath)` for package resolution from a real `node_modules`
- `fallback(loader)` for custom last-resort resolution

## File Bindings

`createFileBindings({ root, allowWrite })` creates a filesystem bridge that stays inside the configured root directory. Attempts to escape that root are rejected, and write operations are disabled unless `allowWrite` is set to `true`.

## Typechecking

The typecheck helpers let you validate sandbox code against supported capability profiles before executing it.

```ts
import {
  formatTypecheckErrors,
  getTypeProfile,
  typecheck,
} from "@ricsam/isolate";

const profile = getTypeProfile({
  profile: "browser-test",
  capabilities: ["files"],
});

console.log(profile.include);

const result = typecheck({
  code: "page.goto('/')",
  profile: "browser-test",
});

if (!result.success) {
  console.error(formatTypecheckErrors(result.errors));
}
```

Built-in profiles:

- `backend`
- `agent`
- `browser-test`

Capabilities can extend a profile with `fetch`, `files`, `tests`, `browser`, `tools`, `console`, `encoding`, and `timers`.

## Daemon CLI

The package also exposes an `isolate-daemon` binary:

```bash
isolate-daemon --socket /tmp/isolate.sock
```

By default, `createIsolateHost()` will auto-start a daemon when needed. You can also point the host at an already-running daemon with `daemon.socketPath`, or disable auto-start with `daemon.autoStart: false`.

## Development

```bash
npm run build
npm run typecheck
npm test
```
