import fs from "node:fs";
import path from "node:path";
import { builtinModules, createRequire } from "node:module";
import { rollup, type Plugin } from "rollup";
import * as nodeResolveModule from "@rollup/plugin-node-resolve";
import * as commonjsModule from "@rollup/plugin-commonjs";
import * as jsonModule from "@rollup/plugin-json";
import * as replaceModule from "@rollup/plugin-replace";
import { detectFormat, parseSpecifier } from "./resolve.ts";
import { processTypeScript, isTypeScriptFile } from "./strip-types.ts";
import type { RollupCommonJSOptions } from "@rollup/plugin-commonjs";
import type { RollupJsonOptions } from "@rollup/plugin-json";
import type { RollupReplaceOptions } from "@rollup/plugin-replace";

// Handle CJS default exports
const nodeResolve = ((nodeResolveModule as any).default ||
  nodeResolveModule) as (typeof nodeResolveModule)["nodeResolve"];
const commonjs = ((commonjsModule as any).default || commonjsModule) as (
  options?: RollupCommonJSOptions
) => Plugin;
const json = ((jsonModule as any).default || jsonModule) as (
  options?: RollupJsonOptions
) => Plugin;
const replace = ((replaceModule as any).default || replaceModule) as (
  options?: RollupReplaceOptions
) => Plugin;

const commonjsInteropOptions = {
  // External package imports are resolved by later loader calls as ESM bundles,
  // so CommonJS requires need ESM-aware interop instead of default-import assumptions.
  esmExternals: true,
  requireReturnsDefault: "auto",
} satisfies RollupCommonJSOptions;

const PACKAGE_ENTRY_WRAPPER_PREFIX = "\0package-entry-wrapper:";
const INVALID_FUNCTION_EXPORT_NAMES = new Set([
  "arguments",
  "caller",
  "length",
  "name",
  "prototype",
]);

/**
 * Set of Node.js built-in module names (e.g. "fs", "path", "crypto").
 */
const nodeBuiltins = new Set(builtinModules);

/**
 * Check if a specifier refers to a Node.js built-in module.
 * Handles bare names ("fs"), subpaths ("fs/promises"), and node: prefix ("node:fs").
 */
function isNodeBuiltin(source: string): boolean {
  const name = source.startsWith("node:") ? source.slice(5) : source;
  const topLevel = name.split("/")[0]!;
  return nodeBuiltins.has(topLevel);
}

const NODE_BUILTIN_SHIM_PREFIX = "\0node-builtin-shim:";

export function getNodeBuiltinShimCode(source: string): string {
  if (source === "ws" || source === "node:ws") {
    return `
const WebSocketShim = globalThis.WebSocket;

if (!WebSocketShim) {
  throw new Error("The isolate runtime does not provide a global WebSocket implementation.");
}

export { WebSocketShim as WebSocket };
export default WebSocketShim;
`;
  }

  if (source === "async_hooks" || source === "node:async_hooks") {
    return `
const AsyncContextShim = globalThis.AsyncContext;
const asyncInternals = globalThis.__isolateAsyncContextInternals;

if (!AsyncContextShim || !asyncInternals?.AsyncContextFrame) {
  throw new Error(
    "node:async_hooks requires AsyncContext support in the isolate engine."
  );
}

const { AsyncContextFrame, currentAsyncResource } = asyncInternals;
let nextAsyncResourceId = 1;
const NO_STORE = Symbol("AsyncLocalStorage.noStore");

function currentAsyncResourceState() {
  return currentAsyncResource.get() ?? {
    asyncId: 0,
    triggerAsyncId: 0,
    resource: undefined,
  };
}

class AsyncResource {
  #snapshot;
  #asyncId;
  #triggerAsyncId;
  #destroyed;

  constructor(type, options = {}) {
    void type;

    const normalizedOptions =
      options && typeof options === "object" ? options : {};
    const currentState = currentAsyncResourceState();

    this.#snapshot = new AsyncContextShim.Snapshot();
    this.#asyncId = nextAsyncResourceId++;
    this.#triggerAsyncId = Number.isSafeInteger(normalizedOptions.triggerAsyncId)
      ? normalizedOptions.triggerAsyncId
      : currentState.asyncId;
    this.#destroyed = false;
  }

  runInAsyncScope(fn, thisArg, ...args) {
    if (typeof fn !== "function") {
      throw new TypeError("AsyncResource.runInAsyncScope requires a function");
    }
    const state = {
      asyncId: this.#asyncId,
      triggerAsyncId: this.#triggerAsyncId,
      resource: this,
    };
    return this.#snapshot.run(
      () => currentAsyncResource.run(
        state,
        () => Reflect.apply(fn, thisArg, args),
      ),
    );
  }

  bind(fn, thisArg) {
    if (typeof fn !== "function") {
      throw new TypeError("AsyncResource.bind requires a function");
    }
    const resource = this;
    return function bound(...args) {
      return resource.runInAsyncScope(
        fn,
        thisArg === undefined ? this : thisArg,
        ...args,
      );
    };
  }

  emitDestroy() {
    if (this.#destroyed) {
      throw new Error("AsyncResource.emitDestroy() must only be called once");
    }
    this.#destroyed = true;
    return this;
  }

  asyncId() {
    return this.#asyncId;
  }

  triggerAsyncId() {
    return this.#triggerAsyncId;
  }

  static bind(fn, type, thisArg) {
    return new AsyncResource(type).bind(fn, thisArg);
  }
}

class AsyncLocalStorage {
  #variable;
  #defaultValue;
  #token;
  #disabled;

  constructor(options = {}) {
    const normalizedOptions =
      options && typeof options === "object" ? options : {};

    this.#defaultValue = normalizedOptions.defaultValue;
    this.#token = Symbol("AsyncLocalStorage.token");
    this.#disabled = false;
    this.#variable = new AsyncContextShim.Variable({
      defaultValue: NO_STORE,
      name: normalizedOptions.name,
    });
  }

  get name() {
    return this.#variable.name;
  }

  disable() {
    this.#token = Symbol("AsyncLocalStorage.token");
    this.#disabled = true;
    AsyncContextFrame.disable(this.#variable);
  }

  enterWith(store) {
    this.#disabled = false;
    AsyncContextFrame.set(
      new AsyncContextFrame(this.#variable, {
        token: this.#token,
        hasValue: true,
        store,
      }),
    );
  }

  run(store, callback, ...args) {
    if (typeof callback !== "function") {
      throw new TypeError("AsyncLocalStorage.run requires a function");
    }
    this.#disabled = false;
    return this.#variable.run(
      {
        token: this.#token,
        hasValue: true,
        store,
      },
      callback,
      ...args,
    );
  }

  exit(callback, ...args) {
    if (typeof callback !== "function") {
      throw new TypeError("AsyncLocalStorage.exit requires a function");
    }
    return this.#variable.run(
      {
        token: this.#token,
        hasValue: false,
        store: undefined,
      },
      callback,
      ...args,
    );
  }

  getStore() {
    const entry = this.#variable.get();
    if (entry === NO_STORE) {
      return this.#disabled ? undefined : this.#defaultValue;
    }
    if (!entry || entry.token !== this.#token) {
      return undefined;
    }
    if (!entry.hasValue) {
      return undefined;
    }
    return entry.store;
  }

  static bind(fn) {
    return AsyncResource.bind(fn, "AsyncLocalStorage.bind");
  }

  static snapshot() {
    const snapshot = new AsyncContextShim.Snapshot();
    return function runInAsyncScope(fn, ...args) {
      if (typeof fn !== "function") {
        throw new TypeError("AsyncLocalStorage.snapshot requires a function");
      }
      return snapshot.run(fn, ...args);
    };
  }
}

export { AsyncLocalStorage, AsyncResource };
export default { AsyncLocalStorage, AsyncResource };
`;
  }

  return "export default {};\n";
}

/**
 * Rollup plugin that provides empty shims for Node.js built-in modules.
 * Place after nodeResolve — acts as a catch-all for builtins that the
 * package's browser field didn't map to false.
 */
function shimNodeBuiltinsPlugin(): Plugin {
  return {
    name: "shim-node-builtins",
    resolveId(source) {
      if (isNodeBuiltin(source)) {
        return { id: `${NODE_BUILTIN_SHIM_PREFIX}${source}`, moduleSideEffects: false };
      }
      return null;
    },
    load(id) {
      if (id.startsWith(NODE_BUILTIN_SHIM_PREFIX)) {
        return getNodeBuiltinShimCode(id.slice(NODE_BUILTIN_SHIM_PREFIX.length));
      }
      return null;
    },
  };
}

function isValidEsmIdentifier(name: string): boolean {
  return /^[$A-Z_a-z][$\w]*$/.test(name);
}

function resolvePackageImportPath(specifier: string, rootDir: string): string | null {
  const resolver = createRequire(path.join(rootDir, "__isolate_module_loader__.js"));

  let resolvedRequirePath: string;
  try {
    resolvedRequirePath = resolver.resolve(specifier);
  } catch {
    return null;
  }

  const { packageName, subpath } = parseSpecifier(specifier);
  const packageJsonPath = findPackageJsonPath(resolvedRequirePath, packageName);
  if (!packageJsonPath) {
    return resolvedRequirePath;
  }

  let packageJson: Record<string, unknown>;
  try {
    packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8")) as Record<string, unknown>;
  } catch {
    return resolvedRequirePath;
  }

  const packageRoot = path.dirname(packageJsonPath);
  const exportPath = resolveImportEntryFromPackageJson(packageJson, subpath);

  if (exportPath) {
    return path.resolve(packageRoot, exportPath);
  }

  if (!subpath) {
    const moduleEntry = packageJson.module;
    if (typeof moduleEntry === "string") {
      return path.resolve(packageRoot, moduleEntry);
    }

    const browserEntry = packageJson.browser;
    if (typeof browserEntry === "string") {
      return path.resolve(packageRoot, browserEntry);
    }
  }

  return resolvedRequirePath;
}

function findPackageJsonPath(resolvedPath: string, packageName: string): string | null {
  let currentDir = path.dirname(resolvedPath);
  let matchedPackageJsonPath: string | null = null;

  while (true) {
    const packageJsonPath = path.join(currentDir, "package.json");

    if (fs.existsSync(packageJsonPath)) {
      try {
        const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8")) as { name?: string };
        if (packageJson.name === packageName) {
          // Keep walking upward: published packages often include nested
          // dist/cjs or dist/mjs package.json files with the same name, but the
          // real package root higher up contains the export map we need.
          matchedPackageJsonPath = packageJsonPath;
        }
      } catch {
        // Keep walking upward if a parent package.json is malformed.
      }
    }

    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      return matchedPackageJsonPath;
    }
    currentDir = parentDir;
  }
}

function resolveImportEntryFromPackageJson(
  packageJson: Record<string, unknown>,
  subpath: string
): string | null {
  const exportsField = packageJson.exports;
  if (exportsField === undefined) {
    return null;
  }

  const exportKey = subpath ? `.${subpath}` : ".";

  if (isConditionalExportsObject(exportsField)) {
    if (exportKey !== ".") {
      return null;
    }
    return pickImportTarget(exportsField);
  }

  if (typeof exportsField === "object" && exportsField !== null && !Array.isArray(exportsField)) {
    const exportsRecord = exportsField as Record<string, unknown>;
    const directTarget = exportsRecord[exportKey];
    if (directTarget !== undefined) {
      return pickImportTarget(directTarget);
    }

    for (const [pattern, target] of Object.entries(exportsRecord)) {
      if (!pattern.includes("*")) {
        continue;
      }

      const starIndex = pattern.indexOf("*");
      const prefix = pattern.slice(0, starIndex);
      const suffix = pattern.slice(starIndex + 1);

      if (!exportKey.startsWith(prefix) || !exportKey.endsWith(suffix)) {
        continue;
      }

      const wildcardMatch = exportKey.slice(
        prefix.length,
        suffix.length > 0 ? -suffix.length : undefined,
      );

      return pickImportTarget(target, wildcardMatch);
    }

    return null;
  }

  return exportKey === "." ? pickImportTarget(exportsField) : null;
}

function isConditionalExportsObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object"
    && value !== null
    && !Array.isArray(value)
    && Object.keys(value).every((key) => !key.startsWith("."));
}

function pickImportTarget(value: unknown, wildcardMatch?: string): string | null {
  if (typeof value === "string") {
    return wildcardMatch === undefined ? value : value.replaceAll("*", wildcardMatch);
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const target = pickImportTarget(item, wildcardMatch);
      if (target) {
        return target;
      }
    }
    return null;
  }

  if (typeof value !== "object" || value === null) {
    return null;
  }

  const record = value as Record<string, unknown>;

  for (const key of ["workerd", "worker", "edge-light", "import", "module", "default", "browser"]) {
    if (key in record) {
      const target = pickImportTarget(record[key], wildcardMatch);
      if (target) {
        return target;
      }
    }
  }

  for (const nestedValue of Object.values(record)) {
    const target = pickImportTarget(nestedValue, wildcardMatch);
    if (target) {
      return target;
    }
  }

  return null;
}

function getCommonJsNamedExports(specifier: string, rootDir: string): string[] {
  const resolvedHostPath = resolvePackageImportPath(specifier, rootDir);
  if (!resolvedHostPath) {
    return [];
  }

  let code: string;
  try {
    code = fs.readFileSync(resolvedHostPath, "utf-8");
  } catch {
    return [];
  }

  if (detectFormat(resolvedHostPath, code) !== "cjs") {
    return [];
  }

  let moduleExports: unknown;
  try {
    moduleExports = createRequire(resolvedHostPath)(resolvedHostPath);
  } catch {
    return [];
  }

  if (moduleExports == null || (typeof moduleExports !== "object" && typeof moduleExports !== "function")) {
    return [];
  }

  const names = new Set([
    ...Object.keys(moduleExports),
    ...Object.getOwnPropertyNames(moduleExports),
  ]);

  names.delete("default");
  names.delete("__esModule");

  if (typeof moduleExports === "function") {
    for (const name of INVALID_FUNCTION_EXPORT_NAMES) {
      names.delete(name);
    }
  }

  return [...names].filter(isValidEsmIdentifier).sort();
}

function packageEntryWrapperPlugin(specifier: string, namedExports: string[]): Plugin {
  const wrapperId = `${PACKAGE_ENTRY_WRAPPER_PREFIX}${specifier}`;

  return {
    name: "package-entry-wrapper",
    resolveId(source) {
      if (source === wrapperId) {
        return wrapperId;
      }
      return null;
    },
    load(id) {
      if (id !== wrapperId) {
        return null;
      }

      const namedExportLines = namedExports.map(
        (name) => `export const ${name} = __packageDefault.${name};`
      );

      return [
        `import __packageDefault from ${JSON.stringify(specifier)};`,
        "export default __packageDefault;",
        ...namedExportLines,
      ].join("\n");
    },
  };
}

/**
 * Cache for bundled npm packages. Key includes specifier + resolution root.
 */
const bundleCache = new Map<string, { code: string }>();

/**
 * In-flight bundle promises to avoid duplicate concurrent bundles.
 */
const bundlesInFlight = new Map<string, Promise<{ code: string }>>();

/**
 * Create a Rollup plugin that externalizes all bare specifiers that don't
 * belong to the current package. Internal files of the package are inlined;
 * other npm packages remain as import statements.
 */
function externalizeDepsPlugin(currentPackageName: string): Plugin {
  return {
    name: "externalize-deps",
    resolveId(source, importer) {
      // Don't externalize the entry point
      if (!importer) return null;

      // Don't externalize relative imports (internal to the package)
      if (source.startsWith(".") || source.startsWith("/")) return null;

      // Keep package-private imports inside the current bundle so Rollup can
      // resolve them through the importing package's `imports` map.
      if (source.startsWith("#")) return null;

      // Don't externalize Node.js builtins — let nodeResolve handle them
      // via the package's browser field (e.g. "fs": false → empty module)
      if (isNodeBuiltin(source)) return null;

      // Check if this is a different npm package
      const { packageName } = parseSpecifier(source);
      if (packageName !== currentPackageName) {
        return { id: source, external: true };
      }

      // Same package — let Rollup resolve it normally
      return null;
    },
  };
}

/**
 * Bundle a bare specifier (npm package) using Rollup.
 *
 * Each unique bare specifier gets its own bundle with:
 * - node-resolve with worker/server-safe export conditions
 * - commonjs conversion
 * - json support
 * - process.env.NODE_ENV replacement
 * - External deps (other npm packages) left as import statements
 *
 * Results are cached permanently (npm packages are static).
 */
export async function bundleSpecifier(
  specifier: string,
  rootDir: string
): Promise<{ code: string }> {
  const cacheKey = `${specifier}\0${rootDir}`;

  // Check cache
  const cached = bundleCache.get(cacheKey);
  if (cached) return cached;

  // Check in-flight
  const inFlight = bundlesInFlight.get(cacheKey);
  if (inFlight) return inFlight;

  const promise = doBundleSpecifier(specifier, rootDir);
  bundlesInFlight.set(cacheKey, promise);

  try {
    const result = await promise;
    bundleCache.set(cacheKey, result);
    return result;
  } finally {
    bundlesInFlight.delete(cacheKey);
  }
}

async function doBundleSpecifier(
  specifier: string,
  rootDir: string
): Promise<{ code: string }> {
  const { packageName } = parseSpecifier(specifier);
  const namedExports = getCommonJsNamedExports(specifier, rootDir);
  const input = namedExports.length > 0
    ? `${PACKAGE_ENTRY_WRAPPER_PREFIX}${specifier}`
    : specifier;

  const bundle = await rollup({
    input,
    // Disable tree-shaking: we're creating a virtual module that must faithfully
    // expose all package exports. We can't predict which ones user code will import.
    // Without this, exports like AWS SDK's ConverseStreamOutput (a namespace with
    // a visit() helper that nothing inside the bundle references) get dropped.
    treeshake: false,
    plugins: [
      packageEntryWrapperPlugin(specifier, namedExports),
      externalizeDepsPlugin(packageName),
      nodeResolve({
        rootDir,
        browser: false,
        exportConditions: ["workerd", "worker", "edge-light"],
      }),
      shimNodeBuiltinsPlugin(),
      commonjs(commonjsInteropOptions),
      json(),
      replace({
        preventAssignment: true,
        values: { "process.env.NODE_ENV": JSON.stringify("development") },
      }),
    ],
    onwarn: (warning, warn) => {
      if (warning.code === "CIRCULAR_DEPENDENCY") return;
      if (warning.code === "THIS_IS_UNDEFINED") return;
      if (warning.code === "UNUSED_EXTERNAL_IMPORT") return;
      if (warning.code === "EMPTY_BUNDLE") return;
      // Suppress warnings about named imports from shimmed Node.js builtins
      if (warning.code === "MISSING_EXPORT" && warning.exporter?.startsWith(NODE_BUILTIN_SHIM_PREFIX)) return;
      warn(warning);
    },
  });

  const { output } = await bundle.generate({
    format: "es",
    sourcemap: "inline",
    inlineDynamicImports: true,
  });
  await bundle.close();

  const code = output[0]!.code;
  return { code };
}

/**
 * Create a Rollup plugin that externalizes ALL bare specifiers.
 * Used for module aliases where the host file's relative imports are bundled
 * but npm package dependencies are left as external imports.
 */
function externalizeAllBareSpecifiersPlugin(): Plugin {
  return {
    name: "externalize-all-bare-specifiers",
    resolveId(source, importer) {
      if (!importer) return null;
      if (source.startsWith(".") || source.startsWith("/")) return null;
      if (source.startsWith("#")) return null;
      // Don't externalize Node.js builtins — let nodeResolve/shim handle them
      if (isNodeBuiltin(source)) return null;
      return { id: source, external: true };
    },
  };
}

/**
 * Create a Rollup transform plugin that strips TypeScript types.
 */
function stripTypeScriptPlugin(): Plugin {
  return {
    name: "strip-typescript",
    transform(code, id) {
      if (isTypeScriptFile(id)) {
        return { code: processTypeScript(code, id), map: null };
      }
      return null;
    },
  };
}

const TS_EXTENSIONS = [".ts", ".tsx", ".mts", ".cts"];

/**
 * Bundle a host file using Rollup, inlining its relative imports.
 *
 * - Uses the host file path as Rollup input
 * - Externalizes ALL bare specifiers (npm packages)
 * - Strips TypeScript via processTypeScript
 * - Shares the bundleCache/bundlesInFlight (no key collision since file paths start with `/`)
 *
 * Results are cached permanently.
 */
export async function bundleHostFile(
  hostFilePath: string,
): Promise<{ code: string }> {
  const cached = bundleCache.get(hostFilePath);
  if (cached) return cached;

  const inFlight = bundlesInFlight.get(hostFilePath);
  if (inFlight) return inFlight;

  const promise = doBundleHostFile(hostFilePath);
  bundlesInFlight.set(hostFilePath, promise);

  try {
    const result = await promise;
    bundleCache.set(hostFilePath, result);
    return result;
  } finally {
    bundlesInFlight.delete(hostFilePath);
  }
}

async function doBundleHostFile(
  hostFilePath: string,
): Promise<{ code: string }> {
  const rootDir = path.dirname(hostFilePath);

  const bundle = await rollup({
    input: hostFilePath,
    treeshake: false,
    plugins: [
      externalizeAllBareSpecifiersPlugin(),
      stripTypeScriptPlugin(),
      nodeResolve({
        rootDir,
        browser: false,
        exportConditions: ["workerd", "worker", "edge-light"],
        extensions: [".mjs", ".js", ".json", ".node", ...TS_EXTENSIONS],
      }),
      shimNodeBuiltinsPlugin(),
      commonjs(commonjsInteropOptions),
      json(),
      replace({
        preventAssignment: true,
        values: { "process.env.NODE_ENV": JSON.stringify("development") },
      }),
    ],
    onwarn: (warning, warn) => {
      if (warning.code === "CIRCULAR_DEPENDENCY") return;
      if (warning.code === "THIS_IS_UNDEFINED") return;
      if (warning.code === "UNUSED_EXTERNAL_IMPORT") return;
      if (warning.code === "EMPTY_BUNDLE") return;
      // Suppress warnings about named imports from shimmed Node.js builtins
      if (warning.code === "MISSING_EXPORT" && warning.exporter?.startsWith(NODE_BUILTIN_SHIM_PREFIX)) return;
      warn(warning);
    },
  });

  const { output } = await bundle.generate({
    format: "es",
    sourcemap: "inline",
    inlineDynamicImports: true,
  });
  await bundle.close();

  const code = output[0]!.code;
  return { code };
}

/**
 * Clear the bundle cache. Useful for testing.
 */
export function clearBundleCache(): void {
  bundleCache.clear();
}
