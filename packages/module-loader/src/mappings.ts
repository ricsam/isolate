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
}

export interface MappingConfig {
  from: string;
  to: string;
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
    const virtualMount = config.to.replace(/\/+$/, "");

    const isNodeModules = hostBase.endsWith("/node_modules") || hostBase === "node_modules";

    return {
      from: config.from,
      to: config.to,
      isGlob,
      hostBase,
      virtualMount,
      isNodeModules,
    };
  });
}

/**
 * Map a virtual path to a host path using the configured mappings.
 * Returns null if no mapping matches.
 */
export function virtualToHost(virtualPath: string, mappings: PathMapping[]): string | null {
  for (const mapping of mappings) {
    if (mapping.isGlob) {
      // Prefix matching: virtual path must start with the virtual mount
      if (virtualPath === mapping.virtualMount || virtualPath.startsWith(mapping.virtualMount + "/")) {
        const relativePart = virtualPath.slice(mapping.virtualMount.length);
        return mapping.hostBase + relativePart;
      }
    } else {
      // Direct file mapping
      if (virtualPath === mapping.virtualMount) {
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
      if (hostPath === mapping.hostBase || hostPath.startsWith(mapping.hostBase + "/")) {
        const relativePart = hostPath.slice(mapping.hostBase.length);
        return mapping.virtualMount + relativePart;
      }
    } else {
      if (hostPath === mapping.hostBase) {
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
