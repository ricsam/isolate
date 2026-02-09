import fs from "node:fs";
import path from "node:path";
import type {
  ModuleLoaderCallback,
  ModuleLoaderResult,
  ModuleImporter,
} from "@ricsam/isolate-protocol";
import {
  parseMappings,
  virtualToHost,
  findNodeModulesMapping,
  type MappingConfig,
  type PathMapping,
} from "./mappings.ts";
import {
  resolveFilePath,
  detectFormat,
  parseSpecifier,
  isBareSpecifier,
} from "./resolve.ts";
import { bundleSpecifier } from "./bundle.ts";

export { parseMappings, virtualToHost, findNodeModulesMapping } from "./mappings.ts";
export type { MappingConfig, PathMapping } from "./mappings.ts";
export { resolveFilePath, detectFormat, parseSpecifier, isBareSpecifier } from "./resolve.ts";
export { bundleSpecifier, clearBundleCache } from "./bundle.ts";

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

  const loader: ModuleLoaderCallback = async (
    moduleName: string,
    importer: ModuleImporter,
  ): Promise<ModuleLoaderResult> => {
    // A. Bare specifiers: npm packages
    if (isBareSpecifier(moduleName)) {
      return handleBareSpecifier(moduleName, nodeModulesMapping, mappings);
    }

    // B. Relative/absolute paths: user files or intra-package files
    return handlePathSpecifier(moduleName, importer, mappings);
  };

  return loader;
}

/**
 * Handle bare specifiers (npm packages) by bundling with Rollup.
 */
async function handleBareSpecifier(
  specifier: string,
  nodeModulesMapping: PathMapping | undefined,
  mappings: PathMapping[],
): Promise<ModuleLoaderResult> {
  if (!nodeModulesMapping) {
    throw new Error(
      `Cannot resolve bare specifier "${specifier}": no node_modules mapping configured. ` +
      `Add a mapping like { from: '/path/to/node_modules', to: '/node_modules' }.`
    );
  }

  const rootDir = path.dirname(nodeModulesMapping.hostBase);

  const { code } = await bundleSpecifier(specifier, rootDir);

  const { packageName, subpath } = parseSpecifier(specifier);
  const filename = subpath
    ? `${packageName}${subpath}.bundled.js`
        .split("/")
        .pop()!
    : `${packageName}.bundled.js`
        .split("/")
        .pop()!;

  return {
    code,
    filename,
    resolveDir: nodeModulesMapping.virtualMount,
    format: "esm",
    static: true,
  };
}

/**
 * Handle relative/absolute path specifiers by resolving to host files.
 */
async function handlePathSpecifier(
  specifier: string,
  importer: ModuleImporter,
  mappings: PathMapping[],
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
  const code = fs.readFileSync(resolvedHostPath, "utf-8");

  // Detect format
  const format = detectFormat(resolvedHostPath, code);

  // Compute virtual resolveDir and filename
  const resolvedFilename = path.basename(resolvedHostPath);
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

  return {
    code,
    filename: resolvedFilename,
    resolveDir: virtualDir,
    format,
    // User files are NOT static — they can change between evaluations
  };
}
