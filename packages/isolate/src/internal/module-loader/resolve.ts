import fs from "node:fs";
import path from "node:path";

/**
 * Extensions to probe for module resolution, in order of priority.
 */
const EXTENSIONS = [
  ".tsx",
  ".jsx",
  ".ts",
  ".mjs",
  ".js",
  ".cjs",
  ".json",
];

/**
 * Resolve a file path with extension probing, index fallback, and browser variant probing.
 * Returns the resolved absolute path, or null if not found.
 */
export function resolveFilePath(basePath: string): string | null {
  // Try exact path first
  if (isFile(basePath)) return basePath;

  // Try browser variant (e.g., file.browser.ts before file.ts)
  const dir = path.dirname(basePath);
  const ext = path.extname(basePath);
  const nameWithoutExt = path.basename(basePath, ext);

  if (ext) {
    // Has extension — try browser variant
    const browserPath = path.join(dir, `${nameWithoutExt}.browser${ext}`);
    if (isFile(browserPath)) return browserPath;

    // Exact extension didn't work and file doesn't exist
    return null;
  }

  // No extension — probe extensions
  for (const probeExt of EXTENSIONS) {
    // Try browser variant first
    const browserPath = path.join(dir, `${nameWithoutExt}.browser${probeExt}`);
    if (isFile(browserPath)) return browserPath;

    const probePath = basePath + probeExt;
    if (isFile(probePath)) return probePath;
  }

  // Try as directory with index file
  if (isDirectory(basePath)) {
    for (const probeExt of EXTENSIONS) {
      const browserIndex = path.join(basePath, `index.browser${probeExt}`);
      if (isFile(browserIndex)) return browserIndex;

      const indexPath = path.join(basePath, `index${probeExt}`);
      if (isFile(indexPath)) return indexPath;
    }
  }

  return null;
}

/**
 * Detect the format of a file based on its extension and content.
 */
export function detectFormat(filePath: string, code: string): "cjs" | "esm" | "json" {
  const ext = path.extname(filePath);

  if (ext === ".json") return "json";
  if (ext === ".cjs") return "cjs";
  if (ext === ".mjs") return "esm";

  // Heuristic: check for CJS patterns vs ESM patterns
  if (hasESMSyntax(code)) return "esm";
  if (hasCJSSyntax(code)) return "cjs";

  // Default to ESM
  return "esm";
}

/**
 * Check if code has ES module syntax.
 */
function hasESMSyntax(code: string): boolean {
  // import ... from or export ...
  return /\b(import\s+|export\s+(default\s+|{|const\s|let\s|var\s|function\s|class\s|async\s))/m.test(code);
}

/**
 * Check if code has CommonJS syntax.
 */
function hasCJSSyntax(code: string): boolean {
  return /\b(module\.exports|exports\.\w+\s*=|require\s*\()/m.test(code);
}

/**
 * Parse a bare specifier into package name and subpath.
 *
 * Examples:
 *   "lodash" -> { packageName: "lodash", subpath: "" }
 *   "lodash/chunk" -> { packageName: "lodash", subpath: "/chunk" }
 *   "@scope/pkg" -> { packageName: "@scope/pkg", subpath: "" }
 *   "@scope/pkg/sub/path" -> { packageName: "@scope/pkg", subpath: "/sub/path" }
 */
export function parseSpecifier(specifier: string): { packageName: string; subpath: string } {
  if (specifier.startsWith("@")) {
    // Scoped package: @scope/name or @scope/name/subpath
    const slashIndex = specifier.indexOf("/");
    if (slashIndex === -1) {
      return { packageName: specifier, subpath: "" };
    }
    const secondSlash = specifier.indexOf("/", slashIndex + 1);
    if (secondSlash === -1) {
      return { packageName: specifier, subpath: "" };
    }
    return {
      packageName: specifier.slice(0, secondSlash),
      subpath: specifier.slice(secondSlash),
    };
  }

  // Non-scoped: name or name/subpath
  const slashIndex = specifier.indexOf("/");
  if (slashIndex === -1) {
    return { packageName: specifier, subpath: "" };
  }
  return {
    packageName: specifier.slice(0, slashIndex),
    subpath: specifier.slice(slashIndex),
  };
}

/**
 * Check if a specifier is a bare specifier (npm package name, not relative/absolute).
 */
export function isBareSpecifier(specifier: string): boolean {
  return !specifier.startsWith(".") && !specifier.startsWith("/");
}

function isFile(p: string): boolean {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

function isDirectory(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}
