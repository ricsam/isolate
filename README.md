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

### Cancel Running Work

`eval()`, `run()`, `runTests()`, and app-server `handle()` accept web-style `AbortSignal` options.

If the signal is already aborted before the call starts, the call rejects with `AbortError` and does not start or dispose the runtime. If a signal aborts while `eval()`, `run()`, or `runTests()` is in flight, the runtime is hard-disposed and the handle becomes unusable. This is intentionally a hard cancellation path so CPU-bound code such as `while (true) {}` cannot keep running.

```ts
const runtime = await host.createRuntime({});
const controller = new AbortController();

const running = runtime.eval(
  `while (true) {}`,
  { signal: controller.signal },
);

controller.abort();

await running.catch((error) => {
  if (error.name !== "AbortError") {
    throw error;
  }
});

// The runtime was terminated by the abort.
await runtime.eval(`1 + 1`).catch((error) => {
  console.log(error.message);
});
```

Hard runtime termination cascades through nested hosts. If a parent runtime is aborted, times out, is hard-disposed, or is disposed during execution, child runtimes, nested app servers, test runtimes, and namespaced runtimes created through the sandbox `@ricsam/isolate` module are also disposed.

Signals created inside sandbox code can cancel nested work live:

```ts
await runtime.eval(`
  import { createIsolateHost } from "@ricsam/isolate";

  const nestedHost = createIsolateHost();
  const child = await nestedHost.createRuntime();
  const controller = new AbortController();

  const running = child.eval("await new Promise(() => {})", {
    signal: controller.signal,
  });

  controller.abort();

  try {
    await running;
  } catch (error) {
    console.log(error.name); // AbortError
  }
`);
```

For app servers, `handle(request, { signal })` is request-scoped. Aborting the request signal cancels that one request and is visible as `request.signal.aborted` inside the sandbox; it does not dispose the server runtime unless the owning runtime is otherwise terminated. Inside a sandbox app server, pass `request.signal` to a nested app server `handle()` call to forward the same request cancellation.

### Configure Bindings

Bindings define how sandboxed code talks to the host:

- `console` forwards runtime and browser console output
- `fetch` handles outbound HTTP requests
- `files` exposes a safe, root-scoped filesystem whose files can be served without buffering them in the isolate
- `modules` resolves virtual modules, source trees, mounted packages, and fallbacks
- `tools` exposes async host functions and async iterators
- `browser` exposes a Playwright-like browser surface

Every host callback receives a `HostCallContext` with an `AbortSignal`, runtime identity, resource identity, and request metadata.

`fetch` is disabled unless you provide a host binding. If sandbox code calls `fetch(...)` without a `bindings.fetch` callback, the runtime rejects the request instead of falling back to the Node.js process `fetch`. To allow outbound network access, pass an explicit policy-enforcing callback:

```ts
const runtime = await host.createRuntime({
  bindings: {
    fetch: async (request, context) => {
      // Validate, log, rate-limit, meter, or rewrite here.
      return await fetch(request, {
        signal: context.signal,
      });
    },
  },
});
```

When exposing browser support, choose exactly one mode per runtime:

- factory-first: provide `createContext()` and optionally `createPage()`, `readFile()`, and `writeFile()`
- handler-first: provide `handler`, usually from `createPlaywrightSessionHandler(...)`

Do not mix `handler` with `createContext()` / `createPage()` / `readFile()` / `writeFile()` in the same binding.

Keep bindings plain-data and host-owned. Do not leak raw `isolated-vm` handles or other engine objects into untrusted code.

### Create Nested Hosts Inside The Sandbox

Sandbox code can import `@ricsam/isolate` and create child runtimes against the same top-level host connection when the parent runtime opts in with `nestedHost`.

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
    fetch: async (request) => await fetch(request),
  },
  nestedHost: {
    fetch: "inherit",
    maxTotalResources: 8,
    maxRuntimes: 6,
    maxAppServers: 2,
    maxMemoryLimitMB: 128,
    maxExecutionTimeoutMs: 30_000,
    maxAppServerLifetimeMs: 10 * 60_000,
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
- `getNamespacedRuntime()`
- `disposeNamespace()`
- `diagnostics()`
- `close()`

The synthetic sandbox module also exports `createModuleResolver()` for isolate-authored module bindings. It supports pure in-sandbox `virtual()`, `sourceTree()`, and `fallback()` resolution. Host-backed helpers such as `createFileBindings()`, `virtualFile()`, and `mountNodeModules()` are intentionally not exposed inside sandbox code.

Nested resources are brokered by the parent host. The parent `nestedHost` policy controls whether child runtimes inherit the parent fetch binding, how many nested resources can exist across the whole descendant tree, and the maximum memory and execution timeout each child may request. Namespace keys created from inside a nested host are internally scoped so sandbox code can dispose only namespaces it created through that nested host.

The available policy fields are:

- `fetch: "inherit" | "disabled"` - defaults to `"disabled"`
- `maxTotalResources` - total nested runtimes, test runtimes, namespaced runtimes, and app servers
- `maxRuntimes` - nested script, test, and namespaced runtimes
- `maxAppServers` - nested app servers
- `maxMemoryLimitMB` - maximum per-child memory limit
- `maxExecutionTimeoutMs` - maximum per-child execution timeout
- `maxAppServerLifetimeMs` - optional hard lifetime for nested app servers

If `nestedHost` is omitted, nested hosts use conservative defaults and do not inherit `fetch`. Pass `nestedHost: false` to disable the synthetic sandbox `@ricsam/isolate` module entirely for a runtime.

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

`server.handle()` returns either an HTTP response or WebSocket upgrade metadata. Pass `handle(request, { signal })` to forward request cancellation into the sandbox as `request.signal`. For upgraded connections, `server.ws` lets the host send open, message, close, and error events back into the runtime.

### Serve Files Without Buffering

App servers can serve large files, such as videos, with a small fixed isolate memory budget. Application code authorizes each request inside the sandbox and returns a disk-backed `File`; the host process that owns the disk streams the requested bytes. Neither the whole file nor its chunks enter the isolate heap, and with the default daemon the bytes do not pass through the daemon either.

```ts
import {
  createFileBindings,
  createIsolateHost,
  createModuleResolver,
} from "@ricsam/isolate";

const host = await createIsolateHost();
const server = await host.createAppServer({
  key: "example/media",
  entry: "/server.ts",
  memoryLimitMB: 64,
  bindings: {
    // Sandbox paths such as /videos/intro.mp4 resolve inside this root.
    files: createFileBindings({ root: "/srv/media" }),
    tools: {
      // Your authorization logic, for example a session and ACL lookup.
      canWatch: async (cookie: string | null, videoId: string) =>
        await acl.canWatch(cookie, videoId),
    },
    modules: createModuleResolver().virtual(
      "/server.ts",
      `
        serve({
          async fetch(request) {
            const id = new URL(request.url).searchParams.get("id") ?? "";

            // 1. Authorize every request in application code.
            const allowed = /^[a-z0-9-]+$/.test(id) &&
              (await canWatch(request.headers.get("cookie"), id));
            if (!allowed) {
              return new Response("Forbidden", { status: 403 });
            }

            // 2. Open the file. Only its metadata is loaded.
            const videos = await getDirectory("/videos");
            const file = await (await videos.getFileHandle(id + ".mp4")).getFile();

            // 3. Return it. serveFile() handles HEAD, Range, 206 and 416, and
            //    the host streams the bytes from disk as the client reads them.
            return serveFile(request, file, {
              headers: { "cache-control": "private, no-store" },
            });
          },
        });
      `,
    ),
  },
});

// In your HTTP server:
export async function handleVideoRequest(request: Request): Promise<Response> {
  const result = await server.handle(request, { signal: request.signal });
  if (result.type !== "response") {
    return new Response("Upgrade not supported", { status: 400 });
  }
  return result.response; // streams /srv/media/videos/<id>.mp4
}
```

The sandbox only sees paths inside the binding root and an opaque `File`. Host paths and file descriptors are never exposed to it, and a file returned in a `Response` is resolved through a capability that the host minted for this runtime.

Disk-backed files behave like this:

- `getFile()` returns a lazy, disk-backed `File` when the `files` binding provides `stat()` and `readFileStream()`, as `createFileBindings()` does. `name`, `size`, `type` (from the file extension), and `lastModified` come from `stat()`; no bytes are read. Without `readFileStream()`, `getFile()` reads the whole file with `readFile()` and copies it into the isolate.
- `slice()` narrows the byte range without reading, and `new Blob([...])` keeps disk-backed parts by reference.
- Returning a disk-backed `File` or slice in a `Response`, directly or through `serveFile()`, streams it from the binding's `readFileStream()` when the response body is read, one bounded chunk at a time with backpressure. Idle `File` objects hold no file descriptors; each response stream opens one when it is first read and closes it on completion, cancellation, client disconnect, error, or runtime disposal. A response that is already being served keeps streaming after the handler returns, even across `server.reload()`.
- Code that reads the contents gets bounded chunks: `file.stream()`, `response.body`, and transforms such as `pipeThrough()` copy at most 64 KiB per chunk into the isolate, and pull the next chunk only when the consumer reads (backpressure), so a slow client never makes the isolate buffer the file. A runtime can have at most 64 open `stream()` readers over disk-backed blobs at once; opening more rejects with a `RangeError`.
- `text()`, `arrayBuffer()`, and `bytes()` copy the whole contents into the isolate. For disk-backed blobs they reject with a `RangeError` above a quarter of the runtime's `memoryLimitMB` (32 MiB with the default 128 MB). Stream larger files instead.
- Response bodies follow fetch semantics. Returning a `Response` whose body was consumed (for example by `await response.text()`) or is locked by a reader fails the request with a `TypeError`. `response.clone()` and `response.blob()` share the file without reading it. If sandbox code read part of `response.body` and released the lock, only the unread remainder is sent. Only an untouched body is streamed straight from the host that owns the disk; once sandbox code accesses `response.body`, the chunks are relayed through the runtime (without entering the isolate unless the code reads them). A body that the runtime produces or relays this way, such as a transformed stream, cannot outlive the runtime: if the runtime is reloaded, disposed, or exceeds its memory limit before the body is complete, the response body fails with an error instead of ending early.
- A disk-backed file pins the snapshot `version` that `stat()` reported when it was opened. For `createFileBindings()` that is the device, inode, size, and modification and change times. If the file is replaced, truncated, extended, edited, or deleted afterwards, reads fail with a `NotReadableError` instead of returning different contents. Depending on when the change is detected, `server.handle()` rejects or the response body stream errors.
- Request bodies built from disk-backed files, such as `fetch(url, { body: file })` or `FormData` entries, are copied into memory under the same size limit. Streaming large uploads is out of scope for this mechanism.
- File bindings that sandbox code passes to nested runtimes are always read eagerly.

`serveFile(request, file, init?)` is a sandbox global that builds a response for any `Blob` or `File`:

- `GET` without a `Range` header returns 200 with `Content-Length`. `HEAD` returns the same headers without a body and never reads the file.
- A single `Range: bytes=start-end`, open-ended `bytes=start-`, or suffix `bytes=-length` returns 206 with exact `Content-Range` and `Content-Length`, and only that range is read. Unsatisfiable ranges return 416 with `Content-Range: bytes */size`. Invalid, multi-range, and non-`bytes` headers are ignored and the full file is returned. `If-Range` only keeps the range when it equals the strong `ETag` passed in `init.headers`.
- `Content-Type` defaults to the file type and `Accept-Ranges` to `bytes`. `serveFile()` never adds caching or privacy headers such as `Cache-Control`, `ETag`, `Last-Modified`, or `Content-Disposition`, and it does not look at the file name to choose them; pass the ones you want in `init.headers`.
- Ranges only apply to `GET`; any method other than `HEAD` receives the full file. Route methods and authorize the request before calling it.

To stream from another storage backend, implement `stat()` and `readFileStream()` in your own `files` binding:

```ts
import type { FileBindings } from "@ricsam/isolate";

const files: FileBindings = {
  async stat(path) {
    const info = await storage.head(path);
    return {
      isFile: info.kind === "file",
      isDirectory: info.kind === "directory",
      size: info.size,
      lastModified: info.modifiedAt.getTime(),
      version: info.etag,
    };
  },
  async readFileStream(path, { start, end, version }, context) {
    // A ReadableStream<Uint8Array> with exactly end - start bytes.
    return await storage.readRange(path, {
      start,
      end,
      ifMatch: version,
      signal: context.signal,
    });
  },
  async readdir(path) {
    return await storage.list(path);
  },
};
```

`readFileStream()` must enforce the same root and permission rules as the binding's other operations, return exactly `end - start` bytes, and reject, preferably with an error named `NotReadableError`, when `version` is set and no longer matches the file. Streams are pulled on demand and cancelled when the consumer stops reading.

A runtime can only reach files through its own bindings. `createFileBindings()` rejects `..` traversal and symlinks that resolve outside the root, opens files before verifying their real path so that swapping a path component for a symlink cannot redirect a read, refuses special files such as FIFOs, and never includes host paths in errors. Blob and file references that sandbox code forges or carries over from another runtime are rejected, file capabilities that the daemon forwards to the host are sealed with a key private to the runtime that opened the file, and response headers cannot stand in for a file body. Authorization stays with your application: check every request before opening or returning a file.

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
- `context.newCDPSession(page)` is available for Chromium-backed contexts
- `page.target().createCDPSession()` is available as a Puppeteer-style CDP shim
- `page.close()` and `context.close()` are available
- `browser.close()` is not exposed inside the sandbox
- `page` and `context` are never injected as implicit globals

### Persist Browser Profiles

Browser profiles are isolate-owned virtual filesystem data. Enable them by providing `bindings.files` and `bindings.browser.profiles`; sandbox code then uses profile IDs instead of host paths.

```ts
import { chromium } from "playwright";
import {
  createFileBindings,
  createIsolateHost,
} from "@ricsam/isolate";

const browser = await chromium.launch();
const host = await createIsolateHost();

const runtime = await host.createRuntime({
  bindings: {
    files: createFileBindings({
      root: "./session-data",
      allowWrite: true,
    }),
    browser: {
      profiles: true,
      createContext: async (options) =>
        await browser.newContext(options ?? undefined),
      createPage: async (contextInstance) =>
        await contextInstance.newPage(),
    },
  },
});

await runtime.eval(`
  const ctx = await browser.newContext({ profile: "auth/main" });
  const page = await ctx.newPage();
  await page.goto("https://example.com");
  await ctx.storageState({ path: "/snapshots/auth.json" });
  await ctx.close();

  const restored = await browser.newContext({
    storageState: "/snapshots/auth.json",
  });
  await restored.close();
`);

await runtime.dispose();
await browser.close();
await host.close();
```

For full browser profile directories, provide `createPersistentContext()` and request a persistent profile. The host receives a temporary real `userDataDir`; `@ricsam/isolate` materializes the virtual profile into it before launch and syncs it back on `context.close()`.

```ts
const runtime = await host.createRuntime({
  bindings: {
    files: createFileBindings({
      root: "./session-data",
      allowWrite: true,
    }),
    browser: {
      profiles: { defaultMode: "persistent" },
      createPersistentContext: async (userDataDir, options) =>
        await chromium.launchPersistentContext(userDataDir, {
          ...(options ?? {}),
          headless: true,
        }),
      createPage: async (contextInstance) =>
        await contextInstance.newPage(),
    },
  },
});

await runtime.eval(`
  const ctx = await browser.newContext({ profile: "chrome/main" });
  const page = await ctx.newPage();
  await page.goto("https://example.com");
  await ctx.close();
`);
```

Profile IDs are validated relative paths such as `auth/main`. Concurrent opens for the same profile are rejected. Nested isolates that reuse `bindings: { browser }` inherit the same profile store without receiving a raw host path.

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

- `@ricsam/isolate` exports `createIsolateHost()`, `createModuleResolver()`, `createFileBindings()`, `getTypeProfile()`, `typecheck()`, `formatTypecheckErrors()`, and public types such as `HostBindings`, `FileBindings`, `NestedHostPolicy`, and runtime handles
- `@ricsam/isolate/playwright` exports `createPlaywrightSessionHandler()` and related Playwright handler types
- inside sandbox code, `@ricsam/isolate` is also available as a synthetic module that exports sandbox-only `createIsolateHost()`, `createModuleResolver()`, and nested-safe type aliases for runtime handles and bindings

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

Runtime creation options support:

- `bindings` for host-owned capabilities
- `cwd` for path resolution
- `executionTimeout` for eval/test execution limits
- `memoryLimitMB` for isolate memory limits
- `nestedHost` for controlling sandbox-created child runtimes, or `false` to disable nested host access

Execution methods support:

- `runtime.eval(code, { filename?, executionTimeout?, signal? })`
- `testRuntime.run(code, { filename?, timeoutMs?, signal? })`
- `namespacedRuntime.eval(code, { filename?, executionTimeout?, signal? })`
- `namespacedRuntime.runTests(code, { filename?, timeoutMs?, signal? })`
- `appServer.handle(request, { requestId?, metadata?, signal? })`

When `signal` aborts an in-flight script or test execution, the runtime is hard-disposed and nested resources are terminated recursively. Pre-aborted signals reject with `AbortError` before starting execution.

### `createModuleResolver()`

`createModuleResolver()` returns a fluent builder. You can mix and match:

- `virtual(specifier, source, options)` for inline modules
- `virtualFile(specifier, filePath, options)` for a host file mapped to a virtual specifier
- `sourceTree(prefix, loader)` for lazy source loading under a virtual path
- `mountNodeModules(virtualMount, hostPath)` for package resolution from a real `node_modules`
- `remote(options)` for Deno-style `jsr:`, `npm:`, and full HTTPS imports (trusted hosts default to `esm.sh` and `jsr.io`)
- `fallback(loader)` for custom last-resort resolution

Remote modules are fetched on the host, bundled with their transitive imports, and passed into the isolate as JavaScript. Enable them explicitly on a resolver:

```ts
const modules = createModuleResolver().remote();

// Sandbox code can now use imports such as:
// import { v4 } from "jsr:@std/uuid@1.0.6";
// import ky from "https://esm.sh/ky@1.7.5";
```

Use `remote({ allowedHosts })` to trust additional registries or mirrors. Plain HTTP remains disabled unless `allowHttp: true` is set explicitly.

### `createFileBindings()`

`createFileBindings({ root, allowWrite })` creates a filesystem bridge that stays inside the configured root directory. Attempts to escape that root are rejected, and write operations are disabled unless `allowWrite` is `true`.

Escapes include `..` traversal and symlinks that resolve outside the root. Reads open the file first and then verify its real path, so a symlink swapped into the path cannot redirect an open; writes do not follow a final symlink; special files such as FIFOs are refused; and error messages name only sandbox paths, never host paths.

Besides whole-file `readFile()`, the bindings implement `stat()` with `lastModified` and a snapshot `version`, and `readFileStream(path, { start, end, version })` for byte ranges. Sandbox `getFile()` calls therefore return lazy, disk-backed files that are read on demand and fail with a `NotReadableError` if the file changes after it was opened. See [Serve Files Without Buffering](#serve-files-without-buffering) for the semantics and for implementing these two methods on other storage backends.

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
- `createPersistentContext`
- `createPage`
- `readFile`
- `writeFile`
- `profiles`
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
