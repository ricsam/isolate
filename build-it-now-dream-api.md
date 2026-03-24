# Build-It-Now Dream API For `@ricsam/isolate`

## Summary

If isolate only existed to serve `build-it-now`, the public API should be built around the workflows `build-it-now` actually has:

- booting and owning the isolate engine from Bun
- creating pooled backend app servers for `serve()`
- creating ad hoc runtimes for agent work, scripts, and tests
- running browser-backed Playwright code
- typechecking sandbox code
- wiring one shared host bridge for fetch, files, modules, tools, console, streams, and cancellation

The dream package is a **single package**:

```ts
import { ... } from "@ricsam/isolate";
```

Everything else is internal implementation detail:

- no separate `client`, `daemon`, `server`, `protocol`, `runtime`, `module-loader`, `types`, or `playwright` packages
- no raw IPC/protocol types in app code
- no app-facing split between "local runtime API" and "remote runtime API"

## Design Principles

### 1. Workflow-first, not feature-package-first

The public surface should match how `build-it-now` works:

- app server runtime
- worker/script runtime
- browser/test runtime
- typecheck tooling

It should not force the consumer to think in terms of:

- `isolate-client`
- `isolate-daemon`
- `isolate-server`
- `isolate-protocol`
- `isolate-module-loader`

### 2. Async by default

Every host-backed capability is async by design:

- fetch
- files
- tools
- module loading
- streams
- callbacks

No part of the public API should encourage blocking bridge behavior.

### 3. One host bridge shared by all capabilities

Fetch, fs, tools, streams, callbacks, and browser integration should all ride on one shared async resource model with:

- cancellation
- ownership
- backpressure
- diagnostics

### 4. Transport is invisible

`build-it-now` should not need to care whether the runtime is:

- local in-process Node
- daemon-backed from Bun
- pooled
- reused

Those are host implementation details.

### 5. Build-it-now first-class support

The package should optimize for the code `build-it-now` actually writes, not for every possible surface area the isolate could theoretically expose.

## The Desired Top-Level API

```ts
import {
  createIsolateHost,
  createModuleResolver,
  createFileBindings,
  typecheck,
  formatTypecheckErrors,
} from "@ricsam/isolate";
```

### Proposed exports

- `createIsolateHost()`
- `createModuleResolver()`
- `createFileBindings()`
- `typecheck()`
- `formatTypecheckErrors()`

### Proposed types

- `IsolateHost`
- `HostBindings`
- `AppServer`
- `ScriptRuntime`
- `BrowserRuntime`
- `RequestResult`
- `ModuleResolver`
- `TypecheckResult`

## Core Concepts

### `IsolateHost`

The one object that owns engine startup, transport, pooling, and cleanup.

```ts
const host = await createIsolateHost({
  engine: "auto",
  daemon: {
    socketPath: "/tmp/build-it-now-isolate.sock",
  },
});
```

Responsibilities:

- start or connect to the underlying isolate engine
- hide daemon lifecycle from Bun callers
- provide pooled runtimes and app servers
- expose diagnostics
- shut everything down cleanly

### `HostBindings`

One shared object that describes how the sandbox talks to the host.

```ts
const bindings = {
  console: {
    onEntry(entry) {
      appendLog(mapConsoleEntry(entry));
    },
  },

  fetch: async (request, ctx) => {
    return await handleSandboxFetch(request, ctx);
  },

  files: createFileBindings({
    root: filesPath,
    allowWrite: true,
  }),

  modules: createModuleResolver()
    .mountNodeModules("/node_modules", registryBackendNodeModulesPath)
    .virtual("@/env", () => createEnvModule(env))
    .sourceTree("@/shared/", loadSharedFile)
    .sourceTree("@/backend/", loadBackendFile),

  tools: {
    db: async (input, ctx) => runDatabaseTool(input, ctx),
    password: async (input, ctx) => hashPassword(input, ctx),
    ai: async (input, ctx) => runAiTool(input, ctx),
    shell: async (input, ctx) => runShellTool(input, ctx),
  },
};
```

Every binding should receive a shared async context:

```ts
interface HostCallContext {
  signal: AbortSignal;
  runtimeId: string;
  requestId?: string;
  resourceId: string;
  metadata: Record<string, string>;
}
```

That keeps fetch, tools, files, streams, and callbacks on the same lifecycle model.

### `AppServer`

A first-class abstraction for the `build-it-now` backend `serve()` use case.

```ts
const server = await host.createAppServer({
  key: `project/${projectId}/${branchName}/${scope}`,
  entry: "/backend/server.ts",
  bindings,
  webSockets: {
    onCommand(command) {
      routeWebSocketCommand(command);
    },
  },
});
```

This replaces the current split between:

- daemon connection
- namespace
- runtime creation
- `IsolateServer`
- `dispatchRequest()`
- `getUpgradeRequest()`

### `ScriptRuntime`

A first-class runtime for eval, agents, background jobs, and unit tests.

```ts
const runtime = await host.createRuntime({
  key: `project/${projectId}/${branchName}/agent`,
  bindings,
  features: {
    tests: true,
  },
});
```

### `BrowserRuntime`

A first-class runtime for Playwright-backed execution.

```ts
const browserRuntime = await host.createBrowserRuntime({
  key: `project/${projectId}/${branchName}/playwright/${sessionId}`,
  bindings,
  browser: {
    page,
    readFile: hostReadFile,
    captureConsole: true,
  },
  features: {
    tests: true,
  },
});
```

### `typecheck()`

A first-class dev-tooling API that understands sandbox profiles rather than individual package fragments.

```ts
const result = typecheck({
  code,
  profile: "backend",
  capabilities: ["files", "tests"],
});
```

## Desired App Server API

This is the most important workflow for `build-it-now`.

```ts
const result = await server.handle(request, {
  projectId,
  branchName,
  requestId,
});

if (result.type === "response") {
  return result.response;
}

if (result.type === "websocket") {
  const upgraded = bunServer.upgrade(request, {
    data: result.upgradeData,
  });

  if (upgraded) {
    return undefined as never;
  }

  return new Response("WebSocket upgrade failed", { status: 500 });
}
```

### Why this is better than the current shape

- one call returns the outcome
- no `dispatchRequest()` followed by `getUpgradeRequest()`
- no protocol leakage into the app
- request ownership is explicit
- easier to attach cancellation and diagnostics

### Desired `AppServer` surface

```ts
interface AppServer {
  handle(request: Request, options?: HandleOptions): Promise<RequestResult>;

  ws: {
    open(connectionId: string): Promise<void>;
    message(connectionId: string, data: string | ArrayBuffer): Promise<void>;
    close(connectionId: string, code: number, reason: string): Promise<void>;
    error(connectionId: string, error: Error): Promise<void>;
  };

  reload(reason?: string): Promise<void>;
  dispose(options?: { hard?: boolean; reason?: string }): Promise<void>;
  diagnostics(): Promise<RuntimeDiagnostics>;
}
```

Where:

```ts
type RequestResult =
  | { type: "response"; response: Response }
  | { type: "websocket"; upgradeData: Record<string, unknown> };
```

## Desired Script Runtime API

This should cover agent work, test runtimes, and one-off backend execution.

```ts
const runtime = await host.createRuntime({
  key: `project/${projectId}/${branchName}/tooling`,
  bindings,
  features: {
    tests: true,
  },
});

await runtime.eval(code, {
  filename: "/backend/agent.ts",
});

const results = await runtime.tests.run({ timeoutMs: 30_000 });

await runtime.dispose();
```

### Desired `ScriptRuntime` surface

```ts
interface ScriptRuntime {
  eval(code: string, options?: { filename?: string }): Promise<void>;
  dispose(options?: { hard?: boolean; reason?: string }): Promise<void>;
  diagnostics(): Promise<RuntimeDiagnostics>;

  events: {
    on(event: string, handler: (payload: unknown) => void): () => void;
    emit(event: string, payload: unknown): Promise<void>;
  };

  tests: {
    run(options?: { timeoutMs?: number }): Promise<RunResults>;
    hasTests(): Promise<boolean>;
    reset(): Promise<void>;
  };
}
```

## Desired Browser Runtime API

Instead of exposing a separate client helper and callback package for Playwright, browser-backed execution should be a single workflow.

```ts
const result = await browserRuntime.run(code, {
  filename: "/backend/tests/playwright.ts",
  asTestSuite: true,
  timeoutMs: 30_000,
});

const collected = await browserRuntime.diagnostics();
```

### Desired `BrowserRuntime` surface

```ts
interface BrowserRuntime {
  run(code: string, options?: {
    filename?: string;
    asTestSuite?: boolean;
    timeoutMs?: number;
  }): Promise<{
    tests?: RunResults;
    value?: unknown;
  }>;

  diagnostics(): Promise<BrowserRuntimeDiagnostics>;
  dispose(): Promise<void>;
}
```

## Desired Module Resolver API

The module loader should be a first-class builder inside the main package, not a separate package plus protocol type imports.

```ts
const modules = createModuleResolver()
  .mountNodeModules("/node_modules", registryBackendNodeModulesPath)
  .virtual("@/env", () => createEnvModule(env))
  .virtualFile("@/db", "/server/isolate/virtual-modules/db/db.ts")
  .sourceTree("@/shared/", loadSharedFile)
  .sourceTree("@/backend/", loadBackendFile)
  .fallback((specifier, importer) => resolveSpecialCase(specifier, importer));
```

Desired properties:

- virtual modules
- file-backed virtual modules
- mounted `node_modules`
- source-tree resolvers for worktree files
- per-project custom modules
- one consistent module result shape

## Desired Typecheck API

Typechecking should match sandbox workflows, not package names.

```ts
const result = typecheck({
  code,
  profile: "backend",
  capabilities: ["files", "fetch", "tests"],
});

if (!result.success) {
  console.error(formatTypecheckErrors(result));
}
```

### Desired profiles

- `backend`
- `agent`
- `browser-test`

### Desired capabilities

- `fetch`
- `files`
- `tests`
- `browser`
- `tools`

## Diagnostics We Want Built In

Because `build-it-now` runs long-lived agents and user servers, the package should expose diagnostics directly:

```ts
const diagnostics = await server.diagnostics();
```

Desired fields:

- active requests
- active async resources
- pending fetches
- pending tool calls
- stream counts
- last error
- runtime reuse state
- whether the runtime is currently reloading or disposing

This should be built into the main package instead of spread across ad hoc logs and protocol state.

## What Should Not Be Public Anymore

If this package is rebuilt for `build-it-now`, the following should disappear from app-facing code:

- manual daemon start/connect logic
- raw namespace management
- raw protocol message types
- separate `RemoteRuntime` vs `RuntimeHandle` concepts
- separate `defaultModuleLoader` package
- separate `simpleConsoleHandler` package
- separate `defaultPlaywrightHandler` package
- `dispatchRequest()` plus `getUpgradeRequest()` as a two-step flow
- imports from multiple isolate subpackages just to assemble one runtime

## Internal Architecture We Still Want

Collapsing packages does **not** mean collapsing code into one file.

The new single package should still have internal modules, for example:

```text
packages/isolate/
  src/index.ts
  src/host/
  src/server/
  src/runtime/
  src/browser/
  src/typecheck/
  src/modules/
  src/files/
  src/bridge/
  src/transport/
  src/features/
```

The main difference is that these become internal abstraction layers under one package instead of externally versioned package boundaries.

## Opinionated API Sketch

This is the package shape I would optimize for first:

```ts
import { createIsolateHost, createModuleResolver, typecheck } from "@ricsam/isolate";

const host = await createIsolateHost({ engine: "auto" });

const bindings = {
  console: { onEntry: logEntry => appendLog(logEntry) },
  fetch: handleSandboxFetch,
  files: createProjectFiles(projectRoot),
  modules: createProjectModules(projectRoot),
  tools: createProjectTools(projectContext),
};

const app = await host.createAppServer({
  key: "project/123/main/preview",
  entry: "/backend/server.ts",
  bindings,
});

const runtime = await host.createRuntime({
  key: "project/123/main/agent",
  bindings,
  features: { tests: true },
});

const browser = await host.createBrowserRuntime({
  key: "project/123/main/playwright/session-1",
  bindings,
  browser: { page },
  features: { tests: true },
});
```

That is the direction this package should move toward.

## Open Questions

- Should app servers and script runtimes share the same factory with different profiles, or stay as separate top-level workflows?
- Should browser runtime remain a separate workflow, or be a feature on `createRuntime()` when a page is present?
- Should tools be exposed as a generic `tools` map, or should some `build-it-now` concepts like database and shell become first-class bindings?
- Should `typecheck()` live in this package, or in a sibling package only if bundle size becomes a real problem?
