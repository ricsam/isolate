# @ricsam/isolate

`@ricsam/isolate` is a runtime-centric JavaScript sandbox built on an async-context-enabled [`@ricsam/isolated-vm`](https://github.com/ricsam/isolated-vm) engine build. It gives you a single host API for running isolated code with web-style capabilities such as `fetch`, files, streams, server handlers, nested sandboxes, module loading, and Playwright-backed browser tests.

## Installation

```bash
npm add @ricsam/isolate @ricsam/isolated-vm
```

The `@ricsam/isolated-vm` peer includes the `createContext({ asyncContext: true })` support required by this repo. Upstream `isolated-vm` will fail fast during runtime boot with a clear AsyncContext error.

Install Playwright when you want browser-enabled runtimes or test runtimes:

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
- `host.createTestRuntime()` for test suites with optional Playwright-backed browser access

Inside sandbox code, `@ricsam/isolate` is also available as a synthetic module. It exports a sandbox-only `createIsolateHost()` that lets a runtime create nested runtimes, app servers, and test runtimes without exposing daemon configuration to the sandbox.

## Host Bindings

Each runtime is configured through `bindings`, which describe how sandboxed code talks to the host:

- `console` forwards runtime and browser console output
- `fetch` handles outbound HTTP requests from the sandbox
- `files` exposes a safe, root-scoped filesystem
- `modules` resolves virtual modules, source trees, and mounted packages
- `tools` exposes async host functions and async iterators
- `browser` exposes a Playwright-like browser factory backed by host `createContext()` and `createPage()` callbacks

Every host callback receives a `HostCallContext` with an `AbortSignal`, runtime identity, resource identity, and request metadata.

`bindings.browser` is intentionally smaller than a full Playwright browser. It injects a global `browser` object with `browser.newContext()` and `browser.contexts()`, and returned contexts expose `context.newPage()` and `context.pages()`. Browser-level shutdown stays on the host side, while the sandbox can still close pages and contexts that it created.

## Async Context

Runtimes created by `@ricsam/isolate` enable the TC39 proposal-style `AsyncContext` global inside the sandbox. This is an experimental surface for now, and the proposal API is used to implement the `node:async_hooks` shim exported to sandboxed code.

This shim is intended for async context propagation inside the sandbox. It is not a full reimplementation of Node's `async_hooks` lifecycle, resource graph, or profiling APIs.

What is currently supported:

- `AsyncContext.Variable`
- `AsyncContext.Snapshot`
- `node:async_hooks` `AsyncLocalStorage`
- `node:async_hooks` `AsyncResource`
- `node:async_hooks` `createHook()`
- `node:async_hooks` `executionAsyncId()`
- `node:async_hooks` `triggerAsyncId()`
- `node:async_hooks` `executionAsyncResource()`
- `node:async_hooks` `asyncWrapProviders`

Hook callbacks observe sandbox-managed resources such as promises, timers, host callback bridges, and user-created `AsyncResource`s. This is still not a claim of full Node internals parity outside the sandbox runtime.

```ts
import {
  createHook,
  executionAsyncResource,
} from "node:async_hooks";

const hook = createHook({
  init(asyncId, type, triggerAsyncId, resource) {
    resource.requestTag = type + ":" + asyncId;
  },
  before() {
    console.log(executionAsyncResource().requestTag ?? null);
  },
}).enable();

setTimeout(() => {
  console.log(executionAsyncResource().requestTag);
  hook.disable();
}, 0);
```

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

## Nested Hosts Inside The Sandbox

Sandbox code can import `@ricsam/isolate` and create child runtimes against the same top-level host connection.

```ts
const runtime = await host.createRuntime({
  bindings: {
    console: {
      onEntry(entry) {
        if (entry.type === "output") {
          console.log(entry.stdout);
        }
      },
    },
  },
});

await runtime.eval(`
  import { createIsolateHost } from "@ricsam/isolate";

  const nestedHost = createIsolateHost();
  const child = await nestedHost.createRuntime({
    bindings: {
      tools: {
        greet: async (name) => "hello " + name,
      },
    },
  });

  await child.eval('console.log(await greet("nested"))');
  await child.dispose();
  await nestedHost.close();
`);
```

Nested hosts support:

- `createRuntime()`
- `createAppServer()`
- `createTestRuntime()`
- `diagnostics()`
- `close()`

Child runtimes can reuse the same binding shapes as top-level runtimes. That includes isolate-authored callbacks, async iterators, module resolvers, file bindings, and browser handles.

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

## Browser Bindings In Script And Server Runtimes

If you provide `bindings.browser`, script and app runtimes get a global `browser` factory even when they are not full Playwright browser runtimes.

```ts
import { chromium } from "playwright";
import { createIsolateHost } from "@ricsam/isolate";

const browser = await chromium.launch();
const host = await createIsolateHost();

const runtime = await host.createRuntime({
  bindings: {
    browser: {
      createContext: async (options) =>
        await browser.newContext(options ?? undefined),
      createPage: async (contextInstance) =>
        await contextInstance.newPage(),
    },
  },
});

await runtime.eval(`
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 720 },
  });
  const page = await ctx.newPage();

  await page.goto("https://example.com");
  console.log(await page.title());
  console.log(typeof browser.close);

  await page.close();
  await ctx.close();
`);

await runtime.dispose();
await browser.close();
await host.close();
```

In these runtimes:

- `browser.newContext()` is available
- `browser.contexts()` is available
- `context.newPage()` is available
- `context.pages()` is available
- `page.close()` and `context.close()` are available
- `browser.close()` is not exposed inside the sandbox
- `page` and `context` are never injected as implicit globals

## Test Runtimes

`createTestRuntime()` enables `describe`, `test`/`it`, hooks, and `expect`. If you also provide `bindings.browser`, the same test runtime gets Playwright-style browser access and matcher support, but you are responsible for explicit page/context lifecycle inside the suite.

```ts
import { chromium } from "playwright";
import { createIsolateHost } from "@ricsam/isolate";

const browser = await chromium.launch();
const host = await createIsolateHost();
const runtime = await host.createTestRuntime({
  key: "example/browser-test",
  bindings: {
    browser: {
      captureConsole: true,
      createContext: async (options) =>
        await browser.newContext(options ?? undefined),
      createPage: async (contextInstance) =>
        await contextInstance.newPage(),
    },
  },
});

const result = await runtime.run(
  `
    let ctx;
    let page;

    beforeAll(async () => {
      ctx = await browser.newContext();
      page = await ctx.newPage();
    });

    afterAll(async () => {
      await ctx.close();
    });

    test("loads a page", async () => {
      expect((await browser.contexts()).length).toBe(1);
      expect((await ctx.pages()).length).toBe(1);
      await page.goto("https://example.com", {
        waitUntil: "domcontentloaded",
      });
      await expect(page).toHaveTitle(/Example Domain/);
    });
  `,
  {
    filename: "/browser-test.ts",
    timeoutMs: 10_000,
  },
);

console.log(result);

await runtime.dispose();
await browser.close();
await host.close();
```

From inside another sandbox, `nestedHost.createTestRuntime()` can reuse the sandbox `browser` handle:

```ts
import { createIsolateHost } from "@ricsam/isolate";

const nestedHost = createIsolateHost();
const child = await nestedHost.createTestRuntime({
  bindings: {
    browser,
  },
});

await child.run(`
  let ctx;
  let page;

  beforeAll(async () => {
    ctx = await browser.newContext();
    page = await ctx.newPage();
  });

  afterAll(async () => {
    await ctx.close();
  });

  test("loads a nested page", async () => {
    await page.goto("https://example.com");
    await expect(page).toHaveTitle(/Example Domain/);
  });
`);

await child.dispose();
await nestedHost.close();
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

- Use `browser` when sandbox code should typecheck `browser.newContext()`, `browser.contexts()`, `context.newPage()`, and `context.pages()`
- The browser test profile does not assume implicit global `page` or `context`
- The synthetic sandbox import `import { createIsolateHost } from "@ricsam/isolate"` is included in all type profiles

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
