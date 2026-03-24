# @ricsam/isolate

A runtime-centric JavaScript sandbox built on `isolated-vm`.

This repository now exposes a single supported package: `@ricsam/isolate`.
The old `@ricsam/isolate-*` leaf packages have been collapsed into internal modules under
`packages/isolate/src/internal` and are no longer part of the public API.

## Install

```bash
npm add @ricsam/isolate isolated-vm
```

If you use browser runtimes, also install Playwright:

```bash
npm add playwright
```

## Public API

`@ricsam/isolate` exports:

- `createIsolateHost`
- `createModuleResolver`
- `createFileBindings`
- `getTypeProfile`
- `typecheck`
- `formatTypecheckErrors`

The host exposes three workflows:

- `host.createAppServer(...)`
- `host.createRuntime(...)`
- `host.createBrowserRuntime(...)`

## Example

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
        if ("stdout" in entry) {
          console.log(entry.stdout);
        }
      },
    },
    files: createFileBindings({
      root: process.cwd(),
    }),
    modules: createModuleResolver().sourceTree("/app/", async (relativePath) => ({
      code: await Bun.file(new URL(relativePath, `file://${process.cwd()}/`)).text(),
      filename: relativePath.split("/").pop() ?? "entry.ts",
      resolveDir: "/app",
    })),
  },
});

await runtime.eval(`console.log("hello from isolate");`);
await runtime.dispose();
await host.close();
```

## Development

`build-it-now` should link only `@ricsam/isolate`.

From your consumer repo:

```bash
bun scripts/link-local-isolate.ts link --repo /path/to/isolate
```

That command removes stale old isolate-package symlinks and links only the single public package.
