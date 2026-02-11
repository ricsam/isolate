import Module from "node:module";
import path from "node:path";

let _stripTypeScriptTypes: typeof Module.stripTypeScriptTypes | undefined;
function getStripTypeScriptTypes() {
  if (!_stripTypeScriptTypes) {
    if (typeof Module.stripTypeScriptTypes !== "function") {
      throw new Error(
        "stripTypeScriptTypes is not available in this runtime. " +
        "Requires Node.js >= 22.7.0. Bun does not support this API."
      );
    }
    _stripTypeScriptTypes = Module.stripTypeScriptTypes;
  }
  return _stripTypeScriptTypes;
}

const TS_EXTENSIONS = new Set([".ts", ".tsx", ".mts", ".cts"]);

/**
 * Check if a file path is a TypeScript file that needs type processing.
 */
export function isTypeScriptFile(filePath: string): boolean {
  return TS_EXTENSIONS.has(path.extname(filePath));
}

/**
 * Process a TypeScript file for isolate use:
 *
 * 1. Strip TypeScript types
 * 2. Elide import specifiers no longer referenced in the code body
 *    (handles: `import { SomeType } from 'pkg'` where SomeType was only
 *    used in type positions — the import survives stripping but the
 *    usage doesn't, so V8 demands an export that doesn't exist in the bundle)
 * 3. Add placeholder exports for type-only export names
 *    (handles: `export interface Foo {}` disappears after stripping,
 *    but other files may `import { Foo }` from this module)
 *
 * Returns valid JavaScript.
 */
export function processTypeScript(code: string, filename: string): string {
  // Find type-only export names BEFORE stripping
  const typeExportNames = findTypeOnlyExports(code);

  // Strip TypeScript types
  const stripTypes = getStripTypeScriptTypes();
  let stripped: string;
  try {
    stripped = stripTypes(code, {
      mode: "transform",
      sourceMap: false,
    });
  } catch {
    stripped = stripTypes(code, {
      mode: "strip",
    });
  }

  // Elide unused import specifiers
  stripped = elideUnusedImports(stripped);

  // Add placeholder exports for type-only names not already value-exported
  if (typeExportNames.length > 0) {
    const needsPlaceholder = typeExportNames.filter(
      (name) => !isValueExported(name, stripped),
    );
    if (needsPlaceholder.length > 0) {
      const vars = needsPlaceholder.map((n) => `var ${n} = undefined;`).join(" ");
      stripped += "\n" + vars + "\nexport { " + needsPlaceholder.join(", ") + " };\n";
    }
  }

  return stripped;
}

// ─── Import elision ──────────────────────────────────────────────────────────

/**
 * Named import regex (handles single-line and multi-line).
 * Captures: [1] optional default part, [2] specifier list, [3] module path
 */
const NAMED_IMPORT_RE =
  /import\s+([\w$]+\s*,\s*)?\{([\s\S]*?)\}\s*from\s*['"]([^'"]+)['"];?/g;

/**
 * After type stripping, imported names that were only used in type positions
 * are unreferenced in the code body. Remove them from import statements
 * so V8's module linker doesn't demand them from the resolved module.
 */
function elideUnusedImports(code: string): string {
  // Collect all named-import regions
  const entries: Array<{
    fullMatch: string;
    start: number;
    end: number;
    defaultPart: string;
    specifiers: string[];
    modulePath: string;
  }> = [];

  NAMED_IMPORT_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = NAMED_IMPORT_RE.exec(code)) !== null) {
    entries.push({
      fullMatch: m[0],
      start: m.index,
      end: m.index + m[0].length,
      defaultPart: m[1] ?? "",
      specifiers: m[2]!
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0),
      modulePath: m[3]!,
    });
  }

  if (entries.length === 0) return code;

  // Build "body" = code with all import declarations blanked out
  let body = code;
  for (let i = entries.length - 1; i >= 0; i--) {
    const { start, end } = entries[i]!;
    body = body.slice(0, start) + " ".repeat(end - start) + body.slice(end);
  }

  // Process imports in reverse order to preserve string indices
  let result = code;
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i]!;
    const kept: string[] = [];

    for (const spec of entry.specifiers) {
      // "A as B" → local name is B; "A" → local name is A
      const asMatch = spec.match(/(\w+)\s+as\s+(\w+)/);
      const localName = asMatch ? asMatch[2]! : spec;

      // Keep if referenced anywhere in the body as a whole word
      if (new RegExp("\\b" + escapeRegExp(localName) + "\\b").test(body)) {
        kept.push(spec);
      }
    }

    // Nothing changed for this import
    if (kept.length === entry.specifiers.length) continue;

    let replacement: string;
    if (kept.length === 0 && !entry.defaultPart) {
      // All named specifiers gone, no default → remove entire import
      replacement = "";
    } else if (kept.length === 0) {
      // Default import survives, named specifiers all gone
      const def = entry.defaultPart.replace(/\s*,\s*$/, "").trim();
      replacement = `import ${def} from '${entry.modulePath}';`;
    } else {
      replacement = `import ${entry.defaultPart}{ ${kept.join(", ")} } from '${entry.modulePath}';`;
    }

    result = result.slice(0, entry.start) + replacement + result.slice(entry.end);
  }

  return result;
}

// ─── Type-only export placeholders ───────────────────────────────────────────

/**
 * Find export names that are type-only (will vanish after stripping).
 */
function findTypeOnlyExports(code: string): string[] {
  const names = new Set<string>();
  let m: RegExpExecArray | null;

  // export interface Name  /  export interface Name<T>
  const iface = /\bexport\s+interface\s+(\w+)/g;
  while ((m = iface.exec(code)) !== null) names.add(m[1]!);

  // export type Name = ...  /  export type Name<T> = ...
  // (but NOT `export type { ... }`)
  const alias = /\bexport\s+type\s+(\w+)\s*[=<]/g;
  while ((m = alias.exec(code)) !== null) names.add(m[1]!);

  // export type { A, B }  /  export type { A } from './mod'
  const reExport = /\bexport\s+type\s*\{([^}]+)\}/g;
  while ((m = reExport.exec(code)) !== null) {
    for (const item of m[1]!.split(",")) {
      const trimmed = item.trim();
      const asMatch = trimmed.match(/\w+\s+as\s+(\w+)/);
      if (asMatch) names.add(asMatch[1]!);
      else if (/^\w+$/.test(trimmed)) names.add(trimmed);
    }
  }

  return [...names];
}

/**
 * Check if a name is still exported as a runtime value in the stripped code.
 */
function isValueExported(name: string, code: string): boolean {
  const e = escapeRegExp(name);
  if (new RegExp(`\\bexport\\s+(?:var|let|const|function|class|async\\s+function)\\s+${e}\\b`).test(code)) return true;
  if (new RegExp(`\\bexport\\s*\\{[^}]*\\b${e}\\b[^}]*\\}`).test(code)) return true;
  if (name === "default" && /\bexport\s+default\b/.test(code)) return true;
  return false;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
