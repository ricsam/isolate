# @ricsam/isolate-module-loader

A batteries-included module loader for `@ricsam/isolate-runtime` and `@ricsam/isolate-client`. Maps host filesystem paths to virtual isolate paths, bundles npm packages with Rollup, resolves TypeScript files, and probes extensions automatically.

## Installation

```bash
npm add @ricsam/isolate-module-loader
```

## Usage

```typescript
import { createRuntime } from "@ricsam/isolate-runtime";
import { defaultModuleLoader } from "@ricsam/isolate-module-loader";

const loader = defaultModuleLoader(
  // Map host directories to virtual paths in the isolate
  { from: "/home/user/project/src/**/*", to: "/app" },
  { from: "/home/user/project/node_modules", to: "/node_modules" },
);

const runtime = await createRuntime({
  moduleLoader: loader,
  console: {
    onEntry: (entry) => {
      if (entry.type === "output") console.log(entry.stdout);
    },
  },
});

// Imports resolve through the loader automatically
await runtime.eval(
  `
  import { helper } from "./utils";   // reads /home/user/project/src/utils.ts
  import ms from "ms";                // bundles ms from node_modules via Rollup
  console.log(helper(), ms("1 day"));
  `,
  "/app/entry.ts",
);
```

## Path Mappings

Each mapping is a `{ from, to }` pair that maps a host path to a virtual path inside the isolate:

```typescript
defaultModuleLoader(
  // Glob: maps an entire directory tree
  { from: "/host/project/src/**/*", to: "/app" },

  // Direct file: maps a single file
  { from: "/host/project/config.ts", to: "/app/config.ts" },

  // Node modules: enables bare specifier resolution (npm packages)
  { from: "/host/project/node_modules", to: "/node_modules" },
);
```

**Glob mappings** (contain `*`) act as prefix mappings — any virtual path under the `to` prefix resolves to the corresponding host path under the `from` base directory.

**Direct mappings** (no `*`) are 1:1 file mappings.

**Node modules mapping** — when a mapping's host base ends with `node_modules`, bare specifiers like `"lodash"` or `"@aws-sdk/client-s3"` are bundled with Rollup using browser conditions, CommonJS conversion, and JSON support. Each package subpath is bundled independently and cached.

## Module Aliases

Map a host file to a bare-specifier import. If a mapping's `to` doesn't start with `/`, it's treated as a module alias:

```typescript
defaultModuleLoader(
  // Module alias: import { thing } from "@/custom-module" resolves to the host file
  { from: "/host/project/custom_entry.ts", to: "@/custom-module" },

  // Regular filesystem mapping
  { from: "/host/project/src/**/*", to: "/app" },

  // npm packages
  { from: "/host/project/node_modules", to: "/node_modules" },
);
```

When an import matches a module alias, the host file is bundled with Rollup — relative imports within it are inlined, while npm package imports are left as external `import` statements (resolved by subsequent loader calls). TypeScript files are automatically processed.

Module aliases cannot use glob patterns in `from` — each alias maps a single host file entry point.

## Features

### TypeScript Support

TypeScript files (`.ts`, `.tsx`, `.mts`, `.cts`) are automatically processed:
- Types are stripped using Node.js's native `stripTypeScriptTypes`
- Unused imports (type-only) are elided
- Type-only exports get placeholder values so other modules can import them
- The filename extension is rewritten to `.js` for V8

### Extension Probing

When a specifier has no extension, the loader probes in order: `.tsx`, `.jsx`, `.ts`, `.mjs`, `.js`, `.cjs`, `.json`. It also tries `index.*` when the path resolves to a directory.

### Browser Variants

For each probe, browser variants are tried first (e.g., `utils.browser.ts` before `utils.ts`, `index.browser.js` before `index.js`).

### npm Package Bundling

Bare specifiers are bundled with Rollup using:
- `@rollup/plugin-node-resolve` with browser conditions
- `@rollup/plugin-commonjs` for CJS-to-ESM conversion
- `@rollup/plugin-json` for JSON imports
- `@rollup/plugin-replace` for `process.env.NODE_ENV`

Dependencies of the target package are left as external imports (resolved by subsequent loader calls). Bundle results are cached permanently since npm packages are static.

### Static vs Dynamic Modules

npm package bundles are returned with `static: true`, meaning the isolate caches the compiled module and won't re-request it. User files are non-static by default, allowing hot reload between evaluations.

## API

### `defaultModuleLoader(...paths): ModuleLoaderCallback`

Creates a module loader callback compatible with `createRuntime({ moduleLoader })`.

```typescript
function defaultModuleLoader(...paths: MappingConfig[]): ModuleLoaderCallback;

interface MappingConfig {
  from: string; // Host filesystem path (supports globs)
  to: string;   // Virtual path in the isolate
}
```

### Utility Exports

```typescript
// Path mapping utilities
parseMappings(configs: MappingConfig[]): PathMapping[];
virtualToHost(virtualPath: string, mappings: PathMapping[]): string | null;
findNodeModulesMapping(mappings: PathMapping[]): PathMapping | undefined;
findModuleAlias(specifier: string, mappings: PathMapping[]): PathMapping | undefined;

// File resolution
resolveFilePath(basePath: string): string | null;
detectFormat(filePath: string, code: string): "cjs" | "esm" | "json";
parseSpecifier(specifier: string): { packageName: string; subpath: string };
isBareSpecifier(specifier: string): boolean;

// Bundling
bundleSpecifier(specifier: string, rootDir: string): Promise<{ code: string }>;
bundleHostFile(hostFilePath: string): Promise<{ code: string }>;
clearBundleCache(): void;

// TypeScript processing
isTypeScriptFile(filePath: string): boolean;
processTypeScript(code: string, filename: string): string;
```
