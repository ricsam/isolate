import path from "node:path";
import { rollup, type Plugin } from "rollup";
import * as nodeResolveModule from "@rollup/plugin-node-resolve";
import * as commonjsModule from "@rollup/plugin-commonjs";
import * as jsonModule from "@rollup/plugin-json";
import * as replaceModule from "@rollup/plugin-replace";
import { parseSpecifier } from "./resolve.ts";
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

/**
 * Cache for bundled npm packages. Key is the bare specifier (e.g. "lodash/chunk").
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
 * - node-resolve with browser conditions
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
  // Check cache
  const cached = bundleCache.get(specifier);
  if (cached) return cached;

  // Check in-flight
  const inFlight = bundlesInFlight.get(specifier);
  if (inFlight) return inFlight;

  const promise = doBundleSpecifier(specifier, rootDir);
  bundlesInFlight.set(specifier, promise);

  try {
    const result = await promise;
    bundleCache.set(specifier, result);
    return result;
  } finally {
    bundlesInFlight.delete(specifier);
  }
}

async function doBundleSpecifier(
  specifier: string,
  rootDir: string
): Promise<{ code: string }> {
  const { packageName } = parseSpecifier(specifier);

  const bundle = await rollup({
    input: specifier,
    // Disable tree-shaking: we're creating a virtual module that must faithfully
    // expose all package exports. We can't predict which ones user code will import.
    // Without this, exports like AWS SDK's ConverseStreamOutput (a namespace with
    // a visit() helper that nothing inside the bundle references) get dropped.
    treeshake: false,
    plugins: [
      externalizeDepsPlugin(packageName),
      nodeResolve({ browser: true, rootDir }),
      commonjs(),
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
        browser: true,
        rootDir,
        extensions: [".mjs", ".js", ".json", ".node", ...TS_EXTENSIONS],
      }),
      commonjs(),
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
