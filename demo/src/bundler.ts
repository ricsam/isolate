import { rollup } from "rollup";
import resolve from "@rollup/plugin-node-resolve";
import commonjs from "@rollup/plugin-commonjs";
import replace from "@rollup/plugin-replace";

// Known modules that should be externalized (resolved by module loader)
const KNOWN_MODULES = ["zod", "@richie-rpc/core", "@richie-rpc/server"];

// In-memory cache for bundled modules
const bundleCache = new Map<string, string>();

/**
 * Bundle a package for use in QuickJS.
 * Externalizes known modules so they can be resolved by the module loader.
 */
export async function bundlePackage(packageName: string): Promise<string> {
  // Check cache first
  const cached = bundleCache.get(packageName);
  if (cached) {
    return cached;
  }

  console.log(`[Bundler] Bundling: ${packageName}`);

  // Externalize other known modules (but not the current package)
  const externals = KNOWN_MODULES.filter((m) => m !== packageName);

  const bundle = await rollup({
    input: packageName,
    plugins: [
      // Externalize only bare module specifiers that are in our externals list
      {
        name: "externalize-known-modules",
        resolveId(source, importer) {
          // Only externalize bare specifiers (not relative imports like ./websocket.mjs)
          if (source.startsWith(".") || source.startsWith("/")) {
            return null; // Let other plugins handle relative imports
          }
          // Externalize known modules
          if (externals.includes(source)) {
            return { id: source, external: true };
          }
          return null;
        },
      },
      resolve({
        browser: true,
        extensions: [".mjs", ".js", ".ts", ".json"],
      }),
      commonjs(),
      replace({
        preventAssignment: true,
        values: {
          "process.env.NODE_ENV": JSON.stringify("development"),
        },
      }),
    ],
    onwarn: (warning, warn) => {
      // Suppress common warnings
      if (warning.code === "CIRCULAR_DEPENDENCY") return;
      if (warning.code === "THIS_IS_UNDEFINED") return;
      warn(warning);
    },
  });

  const { output: outputs } = await bundle.generate({
    format: "es",
    sourcemap: false,
  });

  await bundle.close();

  const output = outputs[0];
  if (!output) {
    throw new Error(`Bundle produced no output for ${packageName}`);
  }

  const code = output.code;
  bundleCache.set(packageName, code);

  console.log(`[Bundler] Bundled ${packageName}: ${code.length} bytes`);
  return code;
}

/**
 * Bundle all required modules and return a map for the module loader.
 */
export async function bundleAllModules(): Promise<Map<string, string>> {
  const modules = new Map<string, string>();

  // Bundle in dependency order: zod first, then core (depends on zod), then server (depends on both)
  for (const packageName of KNOWN_MODULES) {
    const code = await bundlePackage(packageName);
    modules.set(packageName, code);
  }

  return modules;
}

/**
 * Clear the bundle cache (useful for development/testing).
 */
export function clearBundleCache(): void {
  bundleCache.clear();
}
