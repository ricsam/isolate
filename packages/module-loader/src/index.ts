import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import type {
  ModuleLoaderCallback,
  ModuleLoaderResult,
} from "@ricsam/isolate-protocol";
import {
  parseMappings,
  virtualToHost,
  findNodeModulesMapping,
  findModuleAlias,
  type MappingConfig,
  type PathMapping,
} from "./mappings.ts";
import {
  resolveFilePath,
  parseSpecifier,
  isBareSpecifier,
} from "./resolve.ts";
import { bundleSpecifier, bundleHostFile } from "./bundle.ts";
import { isTypeScriptFile, processTypeScript } from "./strip-types.ts";

export { parseMappings, virtualToHost, findNodeModulesMapping, findModuleAlias } from "./mappings.ts";
export type { MappingConfig, PathMapping } from "./mappings.ts";
export { resolveFilePath, detectFormat, parseSpecifier, isBareSpecifier } from "./resolve.ts";
export { bundleSpecifier, bundleHostFile, clearBundleCache } from "./bundle.ts";
export { isTypeScriptFile, processTypeScript } from "./strip-types.ts";

/**
 * Create a module loader callback that handles common patterns:
 * - Mapping host filesystem paths to virtual isolate paths
 * - Bundling npm packages with Rollup (ESM-first, browser conditions)
 * - Reading user files directly from the host filesystem
 *
 * Each npm package subpath is bundled independently and cached as static.
 *
 * @example
 * ```typescript
 * import { defaultModuleLoader } from '@ricsam/isolate-module-loader';
 *
 * const loader = defaultModuleLoader(
 *   { from: '/host/project/node_modules', to: '/node_modules' },
 *   { from: '/host/project/src/entry.ts', to: '/app/entry.ts' }
 * );
 *
 * const runtime = await createRuntime({
 *   moduleLoader: loader,
 * });
 * ```
 */
export function defaultModuleLoader(
  ...paths: MappingConfig[]
): ModuleLoaderCallback {
  const mappings = parseMappings(paths);
  const nodeModulesMapping = findNodeModulesMapping(mappings);
  const importerHostPathByVirtualPath = new Map<string, string>();

  const loader: ModuleLoaderCallback = async (
    moduleName: string,
    importer: { path: string; resolveDir: string },
  ): Promise<ModuleLoaderResult> => {
    // A. Bare specifiers: module aliases or npm packages
    if (isBareSpecifier(moduleName)) {
      const alias = findModuleAlias(moduleName, mappings);
      if (alias) {
        return handleModuleAlias(alias, importerHostPathByVirtualPath);
      }
      return handleBareSpecifier(
        moduleName,
        importer,
        nodeModulesMapping,
        mappings,
        importerHostPathByVirtualPath,
      );
    }

    // B. Relative/absolute paths: user files or intra-package files
    return handlePathSpecifier(
      moduleName,
      importer,
      mappings,
      importerHostPathByVirtualPath,
    );
  };

  return loader;
}

/**
 * Handle bare specifiers (npm packages) by bundling with Rollup.
 */
async function handleBareSpecifier(
  specifier: string,
  importer: { path: string; resolveDir: string },
  nodeModulesMapping: PathMapping | undefined,
  mappings: PathMapping[],
  importerHostPathByVirtualPath: Map<string, string>,
): Promise<ModuleLoaderResult> {
  if (!nodeModulesMapping) {
    throw new Error(
      `Cannot resolve bare specifier "${specifier}": no node_modules mapping configured. ` +
      `Add a mapping like { from: '/path/to/node_modules', to: '/node_modules' }.`
    );
  }

  const importerHostPath = resolveImporterHostPath(
    importer,
    mappings,
    importerHostPathByVirtualPath,
  );
  const fallbackImporterHostPath = path.join(
    path.dirname(nodeModulesMapping.hostBase),
    "__isolate_module_loader__.js",
  );
  const effectiveImporterHostPath = importerHostPath ?? fallbackImporterHostPath;
  const importerResolutionPath = toRealPath(effectiveImporterHostPath);
  const resolvedHostPath = resolveBareSpecifierWithNode(
    specifier,
    importerResolutionPath,
  );

  if (!resolvedHostPath) {
    throw new Error(
      `Cannot resolve bare specifier "${specifier}" from importer "${importer.path}" ` +
      `(host importer: ${effectiveImporterHostPath}).`
    );
  }

  const rootDir = path.dirname(importerResolutionPath);

  const { code } = await bundleSpecifier(specifier, rootDir);

  const { packageName, subpath } = parseSpecifier(specifier);
  const filename = subpath
    ? `${packageName}${subpath}.bundled.js`
        .split("/")
        .pop()!
    : `${packageName}.bundled.js`
        .split("/")
        .pop()!;

  const result: ModuleLoaderResult = {
    code,
    filename,
    resolveDir: nodeModulesMapping.virtualMount,
    static: true,
  };

  // Keep host importer context so transitive bare imports resolve like Node:
  // from the importing package location (realpath by default).
  registerImporterHostPath(result, toRealPath(resolvedHostPath), importerHostPathByVirtualPath);

  return result;
}

/**
 * Handle module alias specifiers by bundling the host file with Rollup.
 */
async function handleModuleAlias(
  alias: PathMapping,
  importerHostPathByVirtualPath: Map<string, string>,
): Promise<ModuleLoaderResult> {
  const { code } = await bundleHostFile(alias.hostBase);

  // Sanitize the alias name into a filename (e.g. "@/custom-module" -> "custom-module.bundled.js")
  const filename = alias.to
    .replace(/^@[^/]*\//, "") // strip scope prefix
    .replace(/[^a-zA-Z0-9_.-]/g, "-") // replace non-safe chars
    + ".bundled.js";

  const result: ModuleLoaderResult = {
    code,
    filename,
    resolveDir: "/",
  };

  registerImporterHostPath(result, toRealPath(alias.hostBase), importerHostPathByVirtualPath);

  return result;
}

/**
 * Handle relative/absolute path specifiers by resolving to host files.
 */
async function handlePathSpecifier(
  specifier: string,
  importer: { path: string; resolveDir: string },
  mappings: PathMapping[],
  importerHostPathByVirtualPath: Map<string, string>,
): Promise<ModuleLoaderResult> {
  // Resolve virtual path relative to importer's resolveDir
  let virtualPath: string;
  if (specifier.startsWith("/")) {
    virtualPath = specifier;
  } else {
    virtualPath = path.posix.normalize(
      path.posix.join(importer.resolveDir, specifier)
    );
  }

  // Map virtual path -> host path
  const hostBasePath = virtualToHost(virtualPath, mappings);
  if (!hostBasePath) {
    throw new Error(
      `Cannot resolve "${specifier}" (virtual: ${virtualPath}): no mapping matches this path. ` +
      `Importer: ${importer.path}`
    );
  }

  // Probe extensions and index files
  const resolvedHostPath = resolveFilePath(hostBasePath);
  if (!resolvedHostPath) {
    throw new Error(
      `Cannot resolve "${specifier}" (host: ${hostBasePath}): file not found after extension probing. ` +
      `Importer: ${importer.path}`
    );
  }

  // Read the file
  let code = fs.readFileSync(resolvedHostPath, "utf-8");

  // Process TypeScript files: strip types, elide unused imports, add placeholders
  let resolvedFilename = path.basename(resolvedHostPath);
  if (isTypeScriptFile(resolvedHostPath)) {
    code = processTypeScript(code, resolvedHostPath);
    // Change extension to .js so V8 treats it as JavaScript
    resolvedFilename = resolvedFilename.replace(/\.(tsx?|mts|cts)$/, ".js");
  }
  // The host file may have a different name (due to extension probing), so rebuild virtual path
  const hostDir = path.dirname(resolvedHostPath);

  // Map the resolved host directory back to a virtual path for resolveDir
  // We need to find which mapping contains this host path
  let virtualDir: string | null = null;
  for (const mapping of mappings) {
    if (mapping.isGlob) {
      if (hostDir === mapping.hostBase || hostDir.startsWith(mapping.hostBase + "/")) {
        const relativePart = hostDir.slice(mapping.hostBase.length);
        virtualDir = mapping.virtualMount + relativePart;
        break;
      }
    } else {
      const mappedHostDir = path.dirname(mapping.hostBase);
      if (hostDir === mappedHostDir) {
        virtualDir = path.posix.dirname(mapping.virtualMount);
        break;
      }
    }
  }

  if (!virtualDir) {
    // Fallback: use the importer's resolveDir combined with the specifier's directory
    virtualDir = path.posix.dirname(virtualPath);
  }

  const result: ModuleLoaderResult = {
    code,
    filename: resolvedFilename,
    resolveDir: virtualDir,
    // User files are NOT static — they can change between evaluations
  };

  registerImporterHostPath(result, toRealPath(resolvedHostPath), importerHostPathByVirtualPath);

  return result;
}

function resolveImporterHostPath(
  importer: { path: string; resolveDir: string },
  mappings: PathMapping[],
  importerHostPathByVirtualPath: Map<string, string>,
): string | null {
  const cached = importerHostPathByVirtualPath.get(importer.path);
  if (cached) {
    return cached;
  }

  const mappedHostPath = virtualToHost(importer.path, mappings);
  if (!mappedHostPath) {
    return null;
  }

  const resolvedMappedPath = resolveFilePath(mappedHostPath);
  if (resolvedMappedPath) {
    return resolvedMappedPath;
  }

  if (exists(mappedHostPath)) {
    return mappedHostPath;
  }

  return null;
}

function resolveBareSpecifierWithNode(
  specifier: string,
  importerHostPath: string,
): string | null {
  try {
    const req = createRequire(importerHostPath);
    return req.resolve(specifier);
  } catch {
    return null;
  }
}

function registerImporterHostPath(
  moduleResult: ModuleLoaderResult,
  hostPath: string,
  importerHostPathByVirtualPath: Map<string, string>,
): void {
  const virtualModulePath = path.posix.join(
    moduleResult.resolveDir,
    moduleResult.filename,
  );
  importerHostPathByVirtualPath.set(virtualModulePath, hostPath);
}

function toRealPath(inputPath: string): string {
  try {
    return fs.realpathSync(inputPath);
  } catch {
    return inputPath;
  }
}

function exists(filePath: string): boolean {
  try {
    fs.accessSync(filePath);
    return true;
  } catch {
    return false;
  }
}
