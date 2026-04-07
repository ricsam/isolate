# @ricsam/isolate

`@ricsam/isolate` is a runtime host for running JavaScript and TypeScript inside isolated V8 sandboxes. It gives you one host API for short-lived scripts, long-lived app servers, browser-backed tests, persistent sessions, module loading, files, `fetch`, and nested sandboxes.

Use it when you want a higher-level sandbox than raw `isolated-vm`: the host stays in control of capabilities, while sandboxed code gets a web-style runtime surface.

## Getting Started

### Installation

```bash
npm add @ricsam/isolate @ricsam/isolated-vm
```

`@ricsam/isolate` expects the async-context-enabled [`@ricsam/isolated-vm`](https://github.com/ricsam/isolated-vm) peer. Upstream `isolated-vm` does not provide the required `createContext({ asyncContext: true })` support and will fail fast during runtime boot.

Install Playwright when you want browser-enabled runtimes or test runtimes:

```bash
npm add playwright
```

`createIsolateHost()` will auto-start a daemon when needed, so the default setup is usually enough to get going.

### Quick Start

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

That example wires together the most common capabilities:

- `console` to forward sandbox output
- `fetch` for outbound HTTP requests
- `files` for root-scoped filesystem access
- `modules` for virtual modules and source trees
- `tools` for async host functions

Event-style callbacks such as `console.onEntry(...)`, `runtime.test.onEvent(...)`, and Playwright `onEvent(...)` are sync-only, best-effort notifications. Returned promises are ignored after rejection logging, so schedule any async follow-up work from inside the synchronous handler.

## Guides

### Pick A Runtime

The host can create four runtime styles:

- `host.createRuntime()` for scripts, agents, and ad hoc execution
- `host.createAppServer()` for long-lived `serve()` request handlers
- `host.createTestRuntime()` for test suites with `describe`, `test`, hooks, and `expect`
- `host.getNamespacedRuntime()` for persistent sessions that survive soft dispose and can be reacquired later

### Configure Bindings

Bindings define how sandboxed code talks to the host:

- `console` forwards runtime and browser console output
- `fetch` handles outbound HTTP requests
- `files` exposes a safe, root-scoped filesystem
- `modules` resolves virtual modules, source trees, mounted packages, and fallbacks
- `tools` exposes async host functions and async iterators
- `browser` exposes a Playwright-like browser surface

Every host callback receives a `HostCallContext` with an `AbortSignal`, runtime identity, resource identity, and request metadata.

When exposing browser support, choose exactly one mode per runtime:

- factory-first: provide `createContext()` and optionally `createPage()`, `readFile()`, and `writeFile()`
- handler-first: provide `handler`, usually from `createPlaywrightSessionHandler(...)`

Do not mix `handler` with `createContext()` / `createPage()` / `readFile()` / `writeFile()` in the same binding.

Keep bindings plain-data and host-owned. Do not leak raw `isolated-vm` handles or other engine objects into untrusted code.

### Create Nested Hosts Inside The Sandbox

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

### Build An App Server

`createAppServer()` is the long-lived server API. It boots a runtime around an entry module that calls `serve()` and lets the host dispatch requests into it.

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

`server.handle()` returns either an HTTP response or WebSocket upgrade metadata. For upgraded connections, `server.ws` lets the host send open, message, close, and error events back into the runtime.

### Add Browser Support To Script And Server Runtimes

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

Inside these runtimes:

- `browser.newContext()` is available
- `browser.contexts()` is available
- `context.newPage()` is available
- `context.pages()` is available
- `page.close()` and `context.close()` are available
- `browser.close()` is not exposed inside the sandbox
- `page` and `context` are never injected as implicit globals

### Run Tests Inside The Sandbox

`createTestRuntime()` enables `describe`, `test` / `it`, hooks, and `expect`. If you also provide `bindings.browser`, the same test runtime gets Playwright-style browser access and matcher support.

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

const unsubscribe = runtime.test.onEvent((event) => {
  if (event.type === "testStart") {
    console.log("running", event.test.fullName);
  }
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

unsubscribe();
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

### Reuse A Namespaced Session

`host.getNamespacedRuntime(key, options)` is the persistent-session API. Use it when you want one underlying runtime to survive across multiple calls while refreshing host bindings on each acquire.

```ts
import { chromium } from "playwright";
import { createIsolateHost } from "@ricsam/isolate";
import { createPlaywrightSessionHandler } from "@ricsam/isolate/playwright";

const browser = await chromium.launch();
const host = await createIsolateHost();
const playwright = createPlaywrightSessionHandler({
  createContext: async (options) =>
    await browser.newContext(options ?? undefined),
  createPage: async (context) =>
    await context.newPage(),
});

const session = await host.getNamespacedRuntime("playwright:preview:session", {
  bindings: {
    browser: {
      handler: playwright.handler,
    },
  },
});

await session.eval(`
  globalThis.ctx = await browser.newContext();
  globalThis.page = await globalThis.ctx.newPage();
  await globalThis.page.goto("https://example.com");
`);

await session.dispose();

const reused = await host.getNamespacedRuntime("playwright:preview:session", {
  bindings: {
    browser: {
      handler: playwright.handler,
    },
  },
});

const unsubscribe = reused.test.onEvent((event) => {
  if (event.type === "testStart") {
    console.log("running", event.test.fullName);
  }
});

const results = await reused.runTests(`
  test("sees the existing browser state", async () => {
    const contexts = await browser.contexts();
    expect(contexts.length).toBe(1);
    const pages = await contexts[0].pages();
    expect(pages.length).toBe(1);
  });
`);

console.log(results.success);

unsubscribe();
await host.disposeNamespace("playwright:preview:session");
await browser.close();
await host.close();
```

Lifecycle notes:

- only one live handle per namespace is allowed at a time
- `runTests(code)` resets test registration before loading and running the provided suite
- `session.test.onEvent(...)` exposes suite and test lifecycle events for timeout and progress reporting
- runtime globals, module state, and Playwright resources survive soft dispose and reacquire
- browser shutdown stays host-owned, while page and context shutdown stay sandbox-owned

### Use Async Context Inside The Sandbox

Runtimes created by `@ricsam/isolate` enable the TC39 proposal-style `AsyncContext` global inside the sandbox. This experimental surface is also used to implement the `node:async_hooks` shim exposed to sandboxed code.

This shim is for async context propagation inside the sandbox. It is not a full reimplementation of Node's `async_hooks` lifecycle, resource graph, or profiling APIs.

Currently supported:

- `AsyncContext.Variable`
- `AsyncContext.Snapshot`
- `node:async_hooks` `AsyncLocalStorage`
- `node:async_hooks` `AsyncResource`
- `node:async_hooks` `createHook()`
- `node:async_hooks` `executionAsyncId()`
- `node:async_hooks` `triggerAsyncId()`
- `node:async_hooks` `executionAsyncResource()`
- `node:async_hooks` `asyncWrapProviders`

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

## API

### Package Entry Points

- `@ricsam/isolate` exports `createIsolateHost()`, `createModuleResolver()`, `createFileBindings()`, `getTypeProfile()`, `typecheck()`, and `formatTypecheckErrors()`
- `@ricsam/isolate/playwright` exports `createPlaywrightSessionHandler()` and related Playwright handler types
- inside sandbox code, `@ricsam/isolate` is also available as a synthetic module that exports sandbox-only `createIsolateHost()` for nested runtimes

### `createIsolateHost()`

`createIsolateHost()` creates the top-level host connection. The returned host exposes:

- `createRuntime(options)` for script execution
- `createAppServer(options)` for long-lived `serve()` entrypoints
- `createTestRuntime(options)` for tests
- `getNamespacedRuntime(key, options)` for persistent sessions
- `disposeNamespace(key, options?)` for hard-deleting a namespace
- `diagnostics()` for host-level diagnostics
- `close()` to shut everything down

`CreateIsolateHostOptions` currently supports `engine: "auto"` and daemon options such as `socketPath`, `entrypoint`, `cwd`, `timeoutMs`, and `autoStart`.

### `createModuleResolver()`

`createModuleResolver()` returns a fluent builder. You can mix and match:

- `virtual(specifier, source, options)` for inline modules
- `virtualFile(specifier, filePath, options)` for a host file mapped to a virtual specifier
- `sourceTree(prefix, loader)` for lazy source loading under a virtual path
- `mountNodeModules(virtualMount, hostPath)` for package resolution from a real `node_modules`
- `fallback(loader)` for custom last-resort resolution

### `createFileBindings()`

`createFileBindings({ root, allowWrite })` creates a filesystem bridge that stays inside the configured root directory. Attempts to escape that root are rejected, and write operations are disabled unless `allowWrite` is `true`.

### Typechecking

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

Capabilities can extend a profile with `fetch`, `files`, `tests`, `browser`, `tools`, `console`, `crypto`, `encoding`, and `timers`.

### `@ricsam/isolate/playwright`

`createPlaywrightSessionHandler()` builds a handler-first browser binding for namespaced sessions and other Playwright-backed runtimes.

It accepts host callbacks such as:

- `createContext`
- `createPage`
- `readFile`
- `writeFile`
- `evaluatePredicate`

It returns:

- `handler` for `bindings.browser.handler`
- `getCollectedData()` for collected browser artifacts
- `getTrackedResources()` for active contexts and pages
- `clearCollectedData()` to reset collected artifacts
- `onEvent(callback)` for sync-only, best-effort Playwright event subscriptions

### `isolate-daemon`

The package also exposes an `isolate-daemon` binary:

```bash
isolate-daemon --socket /tmp/isolate.sock
```

By default, `createIsolateHost()` will auto-start a daemon when needed. You can also point the host at an already-running daemon with `daemon.socketPath`, or disable auto-start with `daemon.autoStart: false`.
