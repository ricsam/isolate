# @ricsam/isolate-server

Reusable server lifecycle manager for `@ricsam/isolate-client` runtimes.

`IsolateServer` wraps namespaced runtime lifecycle (`start`, `reload`, `close`) and provides a stable
`fetch` proxy that can auto-start from the last successful configuration.

## Installation

```bash
npm add @ricsam/isolate-server
```

## Usage

```ts
import { IsolateServer } from "@ricsam/isolate-server";
import { connect } from "@ricsam/isolate-client";

const connection = await connect({ socket: "/tmp/isolate.sock" });

const server = new IsolateServer({
  namespaceId: "project/main",
  getConnection: async () => connection,
});

await server.start({
  entry: "server.js",
  runtimeOptions: {
    moduleLoader: (specifier) => {
      if (specifier === "server.js") {
        return {
          code: `serve({ fetch: () => new Response("ok") });`,
          resolveDir: "/",
        };
      }
      throw new Error(`Unknown module: ${specifier}`);
    },
  },
});

const response = await server.fetch.dispatchRequest(new Request("http://localhost/"));
console.log(await response.text()); // "ok"

await server.reload();
await server.close();
```

## API

- `start(options)` configures and starts the runtime (idempotent when already running).
- `reload()` disposes current runtime and starts again with the last start options.
- `close()` disposes current runtime (idempotent).
- `getRuntime()` returns the active runtime or `null`.
- `fetch.*` proxies to runtime fetch methods and auto-starts after an initial `start()`.
