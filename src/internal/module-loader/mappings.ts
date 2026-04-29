import path from "node:path";

export interface PathMapping {
  /** Original 'from' path (host) */
  from: string;
  /** Original 'to' path (virtual) */
  to: string;
  /** Whether this is a glob pattern */
  isGlob: boolean;
  /** For globs: the base path before the glob (host-side) */
  hostBase: string;
  /** For globs: the virtual mount point */
  virtualMount: string;
  /** Whether the host base ends with node_modules */
  isNodeModules: boolean;
  /** Whether this mapping is a module alias (to doesn't start with '/') */
  isModuleAlias: boolean;
}

export interface MappingConfig {
  from: string;
  to: string;
}

function normalizeVirtualSeparators(input: string): string {
  return input.replaceAll("\\", "/");
}

function normalizeSafeVirtualRelativePath(relativePath: string): string | null {
  const withoutLeadingSlashes = normalizeVirtualSeparators(relativePath).replace(/^\/+/, "");
  if (withoutLeadingSlashes === "") {
    return "";
  }

  const normalized = path.posix.normalize(withoutLeadingSlashes);
  if (normalized === "." || normalized === "") {
    return "";
  }
  if (normalized === ".." || normalized.startsWith("../") || path.posix.isAbsolute(normalized)) {
    return null;
  }
  return normalized;
}

function isPathInsideOrEqual(root: string, target: string): boolean {
  const resolvedRoot = path.resolve(root);
  const resolvedTarget = path.resolve(target);
  const relative = path.relative(resolvedRoot, resolvedTarget);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function joinInsideHostBase(hostBase: string, relativePath: string): string | null {
  const normalizedRelativePath = normalizeSafeVirtualRelativePath(relativePath);
  if (normalizedRelativePath == null) {
    return null;
  }

  const hostPath = normalizedRelativePath === "" ? hostBase : path.join(hostBase, normalizedRelativePath);
  return isPathInsideOrEqual(hostBase, hostPath) ? hostPath : null;
}

/**
 * Parse {from, to} pairs into structured PathMapping objects.
 *
 * - Glob patterns (contain `*`): extract base path before glob -> prefix mapping
 * - Direct file paths (no glob): 1:1 mapping
 * - Node modules detection: if base path ends with `node_modules`, flag as isNodeModules
 */
export function parseMappings(configs: MappingConfig[]): PathMapping[] {
  return configs.map((config) => {
    const isGlob = config.from.includes("*");
    const isModuleAlias = !config.to.startsWith("/");

    if (isModuleAlias && isGlob) {
      throw new Error(
        `Module alias "${config.to}" cannot use a glob pattern in "from" ("${config.from}"). ` +
        `Module aliases must map a single host file.`
      );
    }

    let hostBase: string;
    if (isGlob) {
      // Extract base path before the first glob segment
      const parts = config.from.split("/");
      const baseSegments: string[] = [];
      for (const part of parts) {
        if (part.includes("*")) break;
        baseSegments.push(part);
      }
      hostBase = baseSegments.join("/");
    } else {
      hostBase = config.from;
    }

    // Normalize trailing slashes
    hostBase = hostBase.replace(/\/+$/, "");
    const virtualMount = isModuleAlias ? config.to : config.to.replace(/\/+$/, "");

    const isNodeModules = hostBase.endsWith("/node_modules") || hostBase === "node_modules";

    return {
      from: config.from,
      to: config.to,
      isGlob,
      hostBase,
      virtualMount,
      isNodeModules,
      isModuleAlias,
    };
  });
}

/**
 * Map a virtual path to a host path using the configured mappings.
 * Returns null if no mapping matches.
 */
export function virtualToHost(virtualPath: string, mappings: PathMapping[]): string | null {
  const normalizedVirtualPath = normalizeVirtualSeparators(virtualPath);
  for (const mapping of mappings) {
    if (mapping.isGlob) {
      // Prefix matching: virtual path must start with the virtual mount
      if (normalizedVirtualPath === mapping.virtualMount || normalizedVirtualPath.startsWith(mapping.virtualMount + "/")) {
        const relativePart = normalizedVirtualPath.slice(mapping.virtualMount.length);
        return joinInsideHostBase(mapping.hostBase, relativePart);
      }
    } else {
      // Direct file mapping
      if (normalizedVirtualPath === mapping.virtualMount) {
        return mapping.hostBase;
      }
    }
  }
  return null;
}

/**
 * Map a host path to a virtual path using the configured mappings.
 * Returns null if no mapping matches.
 */
export function hostToVirtual(hostPath: string, mappings: PathMapping[]): string | null {
  for (const mapping of mappings) {
    if (mapping.isGlob) {
      if (!isPathInsideOrEqual(mapping.hostBase, hostPath)) {
        continue;
      }

      const relativePart = path.relative(path.resolve(mapping.hostBase), path.resolve(hostPath));
      if (relativePart === "") {
        return mapping.virtualMount;
      }
      return `${mapping.virtualMount}/${relativePart.replaceAll(path.sep, "/")}`;
    } else {
      if (path.resolve(hostPath) === path.resolve(mapping.hostBase)) {
        return mapping.virtualMount;
      }
    }
  }
  return null;
}

/**
 * Find the node_modules mapping (if any).
 */
export function findNodeModulesMapping(mappings: PathMapping[]): PathMapping | undefined {
  return mappings.find((m) => m.isNodeModules);
}

/**
 * Find a module alias mapping that matches the given bare specifier.
 * Returns undefined if no module alias matches.
 */
export function findModuleAlias(specifier: string, mappings: PathMapping[]): PathMapping | undefined {
  return mappings.find((m) => m.isModuleAlias && m.to === specifier);
}
