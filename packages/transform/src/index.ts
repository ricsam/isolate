import { stripTypeScriptTypes } from "node:module";
import { createHash } from "node:crypto";

export interface SourceMap {
  version: number;
  sources: string[];
  sourcesContent?: string[];
  mappings: string;
  names: string[];
  file?: string;
}

export interface TransformResult {
  code: string;
  sourceMap?: SourceMap;
}

/**
 * Separate import declarations from the rest of the code.
 * Handles single-line and multi-line import statements.
 */
function separateImports(code: string): { imports: string; body: string; importLineCount: number } {
  const lines = code.split("\n");
  const importLines: string[] = [];
  const bodyLines: string[] = [];
  let inImport = false;
  let pastImports = false;

  for (const line of lines) {
    const trimmed = line.trim();

    if (inImport) {
      importLines.push(line);
      // Check if this line closes the import statement
      if (trimmed.includes("from ") && (trimmed.endsWith(";") || trimmed.endsWith("'"))) {
        inImport = false;
      } else if (trimmed.endsWith(";")) {
        inImport = false;
      }
      continue;
    }

    if (!pastImports && (trimmed.startsWith("import ") || trimmed.startsWith("import{"))) {
      importLines.push(line);
      // Check if it's a multi-line import (no `from` and no closing semicolon)
      if (!trimmed.includes(" from ") && !trimmed.endsWith(";")) {
        inImport = true;
      }
    } else if (!pastImports && trimmed === "") {
      importLines.push(line);
    } else {
      pastImports = true;
      bodyLines.push(line);
    }
  }

  return {
    imports: importLines.join("\n"),
    body: bodyLines.join("\n"),
    importLineCount: importLines.length,
  };
}

/**
 * Strip TypeScript types from code using node:module.
 * Throws SyntaxError with adjusted line numbers on failure.
 */
function stripTypes(code: string, lineOffset: number): string {
  try {
    return stripTypeScriptTypes(code, { mode: "strip" });
  } catch (err: unknown) {
    const e = err as Error;
    const syntaxError = new SyntaxError(e.message);
    throw syntaxError;
  }
}

/**
 * Build a simple line-offset source map.
 * Since strip mode preserves line/column positions (replaces types with whitespace),
 * we only need to account for the line offset from wrapping.
 */
function buildOffsetSourceMap(
  filename: string,
  outputOffset: number,
  originalImportLines: number
): SourceMap {
  // The body in the wrapped output starts at line (outputOffset + 1).
  // The body in the original source starts at line (originalImportLines + 1).
  // Since strip mode preserves positions, the mapping is:
  //   originalLine = wrappedLine - outputOffset + originalImportLines
  // We encode this as a source map with empty lines for the offset, then an identity-ish mapping
  // shifted by originalImportLines.

  // For the first mapped line, origLine = originalImportLines (0-based)
  const vlqChars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

  function encodeVLQ(value: number): string {
    let vlq = value < 0 ? ((-value) << 1) | 1 : value << 1;
    let result = "";
    do {
      let digit = vlq & 31;
      vlq >>>= 5;
      if (vlq > 0) digit |= 32;
      result += vlqChars[digit];
    } while (vlq > 0);
    return result;
  }

  // First segment: genCol=0, sourceIdx=0, origLine=originalImportLines, origCol=0
  const firstSegment = encodeVLQ(0) + encodeVLQ(0) + encodeVLQ(originalImportLines) + encodeVLQ(0);

  // Subsequent body lines: genCol=0, sourceIdx=0, origLine=+1, origCol=0
  const nextSegment = encodeVLQ(0) + encodeVLQ(0) + encodeVLQ(1) + encodeVLQ(0);

  const prefix = Array(outputOffset).fill("").join(";");
  // We don't know exactly how many body lines there are, but we can generate a generous amount
  // Actually, let's just generate 1000 lines of mapping — more than enough for any reasonable code
  const bodyMappings = [firstSegment, ...Array(999).fill(nextSegment)];
  const mappings = prefix + (prefix ? ";" : "") + bodyMappings.join(";");

  return {
    version: 3,
    sources: [filename],
    mappings,
    names: [],
  };
}

/**
 * Transform user entry code:
 * 1. Separate imports from body
 * 2. Strip TypeScript types from body
 * 3. Strip TypeScript types from imports
 * 4. Validate no require(), dynamic import(), or top-level return
 * 5. Wrap body in `export default async function() { ... }`
 */
export async function transformEntryCode(
  code: string,
  filename: string
): Promise<TransformResult> {
  // Step 1: Separate imports from body
  const { imports, body, importLineCount } = separateImports(code);

  // Step 2: Validate no top-level return in body
  validateBody(body);

  // Step 3: Strip types from body
  const strippedBody = stripTypes(body, importLineCount);

  // Step 3.5: Rewrite dynamic import() and require() calls
  const rewrittenBody = rewriteDynamicImports(strippedBody, filename);

  // Step 4: Strip type-only imports
  let strippedImports = "";
  if (imports.trim()) {
    strippedImports = stripTypeImports(imports);
  }

  // Step 5: Wrap body in async function
  const parts: string[] = [];
  if (strippedImports) {
    parts.push(strippedImports);
  }
  parts.push("export default async function() {");
  parts.push(rewrittenBody);
  parts.push("}");
  const wrappedCode = parts.join("\n");

  // Step 6: Build source map
  const wrappedImportLines = strippedImports ? strippedImports.split("\n").length : 0;
  const sourceMap = buildOffsetSourceMap(filename, wrappedImportLines + 1, importLineCount);

  return {
    code: wrappedCode,
    sourceMap,
  };
}

/**
 * Transform module code: strip TypeScript types only (no wrapping).
 */
/**
 * Detect whether code is CommonJS (no ES module syntax, uses module.exports/exports.X).
 * Returns false if code contains any `export` or static `import ... from` statements.
 */
function isCJS(code: string): boolean {
  // Quick check: if code has ES export/import keywords, it's ESM
  // We check for common ES module patterns (avoiding matches inside strings/comments for simplicity)
  if (/\bexport\s+(default|const|let|var|function|class|async\s+function)\b/.test(code)) return false;
  if (/\bexport\s*\{/.test(code)) return false;
  if (/\bexport\s*\*/.test(code)) return false;
  if (/\bimport\s+.*\s+from\s+/.test(code)) return false;
  if (/\bimport\s*\{.*\}\s*from\s+/.test(code)) return false;
  if (/\bimport\s*\*\s*as\s+/.test(code)) return false;

  // Check for CJS patterns
  return /\bmodule\.exports\b/.test(code) || /\bexports\./.test(code);
}

/**
 * Extract named export names from CJS code by analyzing exports.NAME = ... patterns.
 * Returns deduplicated list of export names.
 */
function extractCJSExportNames(code: string): string[] {
  const names = new Set<string>();

  // exports.NAME = ...
  const exportsPattern = /\bexports\.(\w+)\s*=/g;
  let match;
  while ((match = exportsPattern.exec(code)) !== null) {
    names.add(match[1]!);
  }

  // module.exports.NAME = ...
  const moduleExportsPattern = /\bmodule\.exports\.(\w+)\s*=/g;
  while ((match = moduleExportsPattern.exec(code)) !== null) {
    names.add(match[1]!);
  }

  // Object.defineProperty(exports, "NAME", ...)
  const definePattern = /\bObject\.defineProperty\s*\(\s*exports\s*,\s*['"](\w+)['"]/g;
  while ((match = definePattern.exec(code)) !== null) {
    names.add(match[1]!);
  }

  return [...names];
}

/**
 * Convert CJS code to an ES module by wrapping in a function scope and adding export declarations.
 * Wraps CJS code in an IIFE to avoid name conflicts between CJS declarations and ES export bindings.
 * Detects `exports.NAME = ...` patterns and generates corresponding named ES exports.
 * Also generates `export default` for the full module.exports object.
 */
function convertCJSToESModule(code: string, filename: string): string {
  const names = extractCJSExportNames(code);
  const rewrittenCode = rewriteDynamicImports(code, filename);

  const parts: string[] = [];

  // Wrap CJS code in a function scope to avoid name conflicts
  // The function receives `module` and `exports` as parameters, matching CJS expectations
  parts.push('var __cjs_module = { exports: {} };');
  parts.push('(function(module, exports) {');
  parts.push(rewrittenCode);
  parts.push('})(__cjs_module, __cjs_module.exports);');

  // Add named exports extracted from CJS patterns
  // Skip 'default' (handled by export default below) and '__esModule' (internal CJS marker)
  for (const name of names) {
    if (name === 'default' || name === '__esModule') continue;
    parts.push(`export var ${name} = __cjs_module.exports.${name};`);
  }

  // Always export default as the full module.exports object
  parts.push('export default __cjs_module.exports;');

  return parts.join('\n');
}

export async function transformModuleCode(
  code: string,
  filename: string
): Promise<TransformResult> {
  // Check if code is CJS — if so, convert to ESM wrapper
  if (isCJS(code)) {
    const esmCode = convertCJSToESModule(code, filename);
    return {
      code: esmCode,
      // No source map for CJS conversion (line mapping would be complex)
    };
  }

  // For modules, we need to preserve imports. Separate, strip types on body, recombine.
  const { imports, body, importLineCount } = separateImports(code);

  // Strip types from body
  const strippedBody = stripTypes(body, importLineCount);

  // Rewrite dynamic import() and require() calls
  const rewrittenBody = rewriteDynamicImports(strippedBody, filename);

  // Strip type-only imports
  let strippedImports = "";
  if (imports.trim()) {
    strippedImports = stripTypeImports(imports);
  }

  // Recombine
  const parts: string[] = [];
  if (strippedImports) {
    parts.push(strippedImports);
  }
  parts.push(rewrittenBody);
  const finalCode = parts.join("\n");

  const outputImportLines = strippedImports ? strippedImports.split("\n").length : 0;
  const sourceMap = buildOffsetSourceMap(filename, outputImportLines, importLineCount);

  return {
    code: finalCode,
    sourceMap,
  };
}

/**
 * Compute SHA-256 content hash for caching.
 */
export function contentHash(code: string): string {
  return createHash("sha256").update(code).digest("hex");
}

/**
 * Map error stack traces through stored source maps back to original code.
 */
export function mapErrorStack(
  stack: string,
  sourceMaps: Map<string, SourceMap>
): string {
  return stack.replace(
    /(\s+at\s+(?:.*?\s+\()?)([^:(\s]+):(\d+):(\d+)(\)?)/g,
    (match, prefix, file, lineStr, colStr, suffix) => {
      const sourceMap = sourceMaps.get(file);
      if (!sourceMap) return match;

      const line = parseInt(lineStr, 10);
      const col = parseInt(colStr, 10);
      const originalPos = resolveSourceMapPosition(sourceMap, line, col);
      if (!originalPos) return match;

      return `${prefix}${file}:${originalPos.line}:${originalPos.column}${suffix}`;
    }
  );
}

/**
 * Strip type-only imports from import declarations.
 * - Removes `import type { ... } from "..."` entirely
 * - Converts `import { type Foo, Bar } from "..."` to `import { Bar } from "..."`
 * - Preserves value imports unchanged
 */
function stripTypeImports(imports: string): string {
  const lines = imports.split("\n");
  const result: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();

    // Remove `import type ...` declarations entirely
    if (/^import\s+type\s+/.test(trimmed)) {
      continue;
    }

    // Handle `import { type Foo, Bar } from "..."`
    // Remove `type ` prefix from individual specifiers
    const replaced = line.replace(
      /\{([^}]+)\}/,
      (match, specifiers: string) => {
        const cleaned = specifiers
          .split(",")
          .map((s: string) => s.trim())
          .filter((s: string) => !s.startsWith("type "))
          .join(", ");
        if (!cleaned) return "{ }"; // All were type imports
        return `{ ${cleaned} }`;
      }
    );

    // If all specifiers were type-only, skip the entire import
    if (replaced.includes("{ }")) {
      continue;
    }

    // Skip empty lines
    if (!trimmed) continue;

    result.push(replaced);
  }

  return result.join("\n");
}

/**
 * Check if code contains a top-level return statement (not inside any braces).
 */
function hasTopLevelReturn(body: string): boolean {
  let depth = 0;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (ch === "{") { depth++; continue; }
    if (ch === "}") { depth--; continue; }
    // Skip string literals
    if (ch === '"' || ch === "'" || ch === "`") {
      const quote = ch;
      i++;
      while (i < body.length && body[i] !== quote) {
        if (body[i] === "\\" && quote !== "`") i++; // skip escaped char
        if (quote === "`" && body[i] === "\\") i++; // skip escaped in template
        i++;
      }
      continue;
    }
    // Skip line comments
    if (ch === "/" && body[i + 1] === "/") {
      i += 2;
      while (i < body.length && body[i] !== "\n") i++;
      continue;
    }
    // Skip block comments
    if (ch === "/" && body[i + 1] === "*") {
      i += 2;
      while (i < body.length && !(body[i] === "*" && body[i + 1] === "/")) i++;
      i++; // skip the closing /
      continue;
    }
    // Check for return keyword at depth 0
    if (depth === 0 && body.substring(i, i + 6) === "return" && !/[\w$]/.test(body[i + 6] || "")) {
      // Make sure it's not part of a larger identifier
      if (i === 0 || !/[\w$]/.test(body[i - 1]!)) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Validate that body code doesn't use top-level return.
 */
function validateBody(body: string): void {
  // Check for top-level return statements (not inside braces)
  if (hasTopLevelReturn(body)) {
    throw new Error(
      "Top-level return is not allowed. Code runs as a module, not a script."
    );
  }
}

/**
 * Check if a character is an identifier character (part of a variable/property name).
 */
function isIdentChar(ch: string): boolean {
  return /[\w$]/.test(ch);
}

/**
 * Rewrite dynamic import() and require() calls into __dynamicImport() and __require() calls.
 * Walks the code character-by-character (same pattern as hasTopLevelReturn), skipping
 * strings and comments. Injects the importer filename as a second argument so the host
 * handler knows which file is importing for module resolution.
 *
 * - `import(EXPR)` → `__dynamicImport(EXPR, "FILENAME")`
 * - `require(EXPR)` → `__require(EXPR, "FILENAME")`
 *
 * Guards against `foo.import(` / `foo.require(` by checking the preceding character.
 */
function rewriteDynamicImports(body: string, filename: string): string {
  const escapedFilename = filename.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  let result = "";
  let i = 0;

  while (i < body.length) {
    const ch = body[i]!;

    // Skip string literals
    if (ch === '"' || ch === "'" || ch === "`") {
      const quote = ch;
      result += ch;
      i++;
      while (i < body.length && body[i] !== quote) {
        if (body[i] === "\\") {
          result += body[i]!;
          i++;
          if (i < body.length) {
            result += body[i]!;
            i++;
          }
          continue;
        }
        if (quote === "`" && body[i] === "$" && body[i + 1] === "{") {
          // Template literal expression - track brace depth
          result += "${";
          i += 2;
          let tmplDepth = 1;
          while (i < body.length && tmplDepth > 0) {
            if (body[i] === "{") tmplDepth++;
            else if (body[i] === "}") tmplDepth--;
            if (tmplDepth > 0) {
              result += body[i]!;
              i++;
            }
          }
          if (i < body.length) {
            result += "}";
            i++;
          }
          continue;
        }
        result += body[i]!;
        i++;
      }
      if (i < body.length) {
        result += body[i]!;
        i++;
      }
      continue;
    }

    // Skip line comments
    if (ch === "/" && body[i + 1] === "/") {
      result += "//";
      i += 2;
      while (i < body.length && body[i] !== "\n") {
        result += body[i]!;
        i++;
      }
      continue;
    }

    // Skip block comments
    if (ch === "/" && body[i + 1] === "*") {
      result += "/*";
      i += 2;
      while (i < body.length && !(body[i] === "*" && body[i + 1] === "/")) {
        result += body[i]!;
        i++;
      }
      if (i < body.length) {
        result += "*/";
        i += 2;
      }
      continue;
    }

    // Check for `import(`
    if (body.substring(i, i + 7) === "import(" || (body.substring(i, i + 6) === "import" && body.substring(i + 6).match(/^\s*\(/))) {
      // Guard: preceding char must not be identifier char or '.'
      const prevChar = i > 0 ? body[i - 1]! : "";
      if (prevChar !== "." && !isIdentChar(prevChar)) {
        // Find the opening paren
        let j = i + 6;
        while (j < body.length && body[j] !== "(") j++;
        // j is now at '('
        const parenStart = j;
        // Find matching closing paren by tracking depth
        let depth = 1;
        j++;
        while (j < body.length && depth > 0) {
          if (body[j] === "(") depth++;
          else if (body[j] === ")") depth--;
          if (depth > 0) j++;
        }
        // j is now at the closing ')'
        if (depth === 0) {
          const innerExpr = body.substring(parenStart + 1, j);
          result += `__dynamicImport(${innerExpr}, "${escapedFilename}")`;
          i = j + 1;
          continue;
        }
      }
    }

    // Check for `require(`
    if (body.substring(i, i + 8) === "require(" || (body.substring(i, i + 7) === "require" && body.substring(i + 7).match(/^\s*\(/))) {
      // Guard: preceding char must not be identifier char or '.'
      const prevChar = i > 0 ? body[i - 1]! : "";
      if (prevChar !== "." && !isIdentChar(prevChar)) {
        // Find the opening paren
        let j = i + 7;
        while (j < body.length && body[j] !== "(") j++;
        // j is now at '('
        const parenStart = j;
        // Find matching closing paren by tracking depth
        let depth = 1;
        j++;
        while (j < body.length && depth > 0) {
          if (body[j] === "(") depth++;
          else if (body[j] === ")") depth--;
          if (depth > 0) j++;
        }
        // j is now at the closing ')'
        if (depth === 0) {
          const innerExpr = body.substring(parenStart + 1, j);
          result += `__require(${innerExpr}, "${escapedFilename}")`;
          i = j + 1;
          continue;
        }
      }
    }

    result += ch;
    i++;
  }

  return result;
}

/**
 * Convert static import declarations to dynamic import/require calls for script mode.
 * - `import { a, b } from "mod"` → `const { a, b } = await __dynamicImport("mod", specifier);`
 * - `import x from "mod"` → `const { default: x } = await __dynamicImport("mod", specifier);`
 * - `import * as x from "mod"` → `const x = await __dynamicImport("mod", specifier);`
 * - `import "mod"` → `await __dynamicImport("mod", specifier);`
 */
function convertStaticImportsToScript(imports: string, escapedSpecifier: string, mode: 'async' | 'sync'): string {
  const awaitPrefix = mode === 'async' ? 'await ' : '';
  const importFn = mode === 'async' ? '__dynamicImport' : '__require';
  let result = imports;

  // import * as name from "mod" (must come before default import pattern)
  result = result.replace(
    /import\s*\*\s*as\s+(\w+)\s+from\s*(['"][^'"]+['"])\s*;?/g,
    (_, name, mod) => `const ${name} = ${awaitPrefix}${importFn}(${mod}, "${escapedSpecifier}");`
  );

  // import { a, b } from "mod"
  result = result.replace(
    /import\s*\{([^}]+)\}\s*from\s*(['"][^'"]+['"])\s*;?/g,
    (_, specs, mod) => `const {${specs}} = ${awaitPrefix}${importFn}(${mod}, "${escapedSpecifier}");`
  );

  // import defaultName from "mod"
  result = result.replace(
    /import\s+(\w+)\s+from\s*(['"][^'"]+['"])\s*;?/g,
    (_, name, mod) => `const { default: ${name} } = ${awaitPrefix}${importFn}(${mod}, "${escapedSpecifier}");`
  );

  // import "mod" (side-effect only)
  result = result.replace(
    /import\s*(['"][^'"]+['"])\s*;?/g,
    (_, mod) => `${awaitPrefix}${importFn}(${mod}, "${escapedSpecifier}");`
  );

  return result;
}

interface ReExport {
  specifiers: Array<{ exported: string; local: string }>;
  moduleSpecifier: string;
}

interface StarReExport {
  moduleSpecifier: string;
  alias?: string;
}

interface RemoveExportsResult {
  processed: string;
  exportEntries: Array<{ exported: string; local: string }>;
  reExports: ReExport[];
  starReExports: StarReExport[];
}

/**
 * Remove export keywords from body code and track exported names.
 */
function removeExports(body: string): RemoveExportsResult {
  const exportEntries: Array<{ exported: string; local: string }> = [];
  const reExports: ReExport[] = [];
  const starReExports: StarReExport[] = [];
  let processed = body;

  // export default (must come before other export patterns)
  processed = processed.replace(
    /\bexport\s+default\s+/g,
    () => {
      exportEntries.push({ exported: 'default', local: '__default__' });
      return 'var __default__ = ';
    }
  );

  // export const/let/var NAME
  processed = processed.replace(
    /\bexport\s+(const|let|var)\s+(\w+)/g,
    (_, keyword, name) => {
      exportEntries.push({ exported: name, local: name });
      return `${keyword} ${name}`;
    }
  );

  // export async function NAME
  processed = processed.replace(
    /\bexport\s+(async\s+function)\s+(\w+)/g,
    (_, keyword, name) => {
      exportEntries.push({ exported: name, local: name });
      return `${keyword} ${name}`;
    }
  );

  // export function NAME
  processed = processed.replace(
    /\bexport\s+(function)\s+(\w+)/g,
    (_, keyword, name) => {
      exportEntries.push({ exported: name, local: name });
      return `${keyword} ${name}`;
    }
  );

  // export class NAME
  processed = processed.replace(
    /\bexport\s+(class)\s+(\w+)/g,
    (_, keyword, name) => {
      exportEntries.push({ exported: name, local: name });
      return `${keyword} ${name}`;
    }
  );

  // export * as name from "mod" (must come before export * from)
  processed = processed.replace(
    /\bexport\s*\*\s*as\s+(\w+)\s+from\s*(['"][^'"]+['"])\s*;?/g,
    (_, alias: string, mod: string) => {
      const moduleSpecifier = mod.slice(1, -1);
      starReExports.push({ moduleSpecifier, alias });
      return '';
    }
  );

  // export * from "mod"
  processed = processed.replace(
    /\bexport\s*\*\s+from\s*(['"][^'"]+['"])\s*;?/g,
    (_, mod: string) => {
      const moduleSpecifier = mod.slice(1, -1);
      starReExports.push({ moduleSpecifier });
      return '';
    }
  );

  // export { a, b as c } from "mod" (must come before local export { ... })
  processed = processed.replace(
    /\bexport\s*\{([^}]+)\}\s*from\s*(['"][^'"]+['"])\s*;?/g,
    (_, specs: string, mod: string) => {
      const moduleSpecifier = mod.slice(1, -1);
      const specifiers = specs.split(',').map((s: string) => s.trim()).filter(Boolean);
      const parsed: Array<{ exported: string; local: string }> = [];
      for (const spec of specifiers) {
        const match = spec.match(/^(\w+)\s+as\s+(\w+)$/);
        if (match) {
          parsed.push({ exported: match[2]!, local: match[1]! });
        } else {
          parsed.push({ exported: spec, local: spec });
        }
      }
      reExports.push({ specifiers: parsed, moduleSpecifier });
      return '';
    }
  );

  // export { a, b as c } (local, no "from")
  processed = processed.replace(
    /\bexport\s*\{([^}]+)\}\s*;?/g,
    (_, specs: string) => {
      const specifiers = specs.split(',').map((s: string) => s.trim()).filter(Boolean);
      for (const spec of specifiers) {
        const match = spec.match(/^(\w+)\s+as\s+(\w+)$/);
        if (match) {
          exportEntries.push({ exported: match[2]!, local: match[1]! });
        } else {
          exportEntries.push({ exported: spec, local: spec });
        }
      }
      return '';
    }
  );

  return { processed, exportEntries, reExports, starReExports };
}

/**
 * Transform module code into a script that can be eval'd in the isolate.
 * Converts ES module syntax (import/export) to script-compatible code:
 * - Static imports become __dynamicImport() or __require() calls
 * - Export keywords are stripped, export names are tracked
 * - Code is wrapped in an async IIFE (for import) or sync IIFE (for require)
 * - The IIFE returns an object with all exports
 *
 * @param code - Raw module source code (may contain TypeScript)
 * @param specifier - The module specifier (used as importer filename for nested imports)
 * @param mode - 'async' for import() (async IIFE), 'sync' for require() (sync IIFE)
 */
export async function transformModuleCodeAsScript(
  code: string,
  specifier: string,
  mode: 'async' | 'sync'
): Promise<string> {
  const escapedSpecifier = specifier.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

  // Strip TypeScript types
  const stripped = stripTypes(code, 0);

  // Separate imports from body
  const { imports, body } = separateImports(stripped);

  const awaitPrefix = mode === 'async' ? 'await ' : '';
  const importFn = mode === 'async' ? '__dynamicImport' : '__require';

  // Process imports: strip type-only, convert to dynamic calls, and also remove any exports
  // (handles case where import and export are on the same line)
  let convertedImports = '';
  let importSectionExports: Array<{ exported: string; local: string }> = [];
  let importSectionReExports: ReExport[] = [];
  let importSectionStarReExports: StarReExport[] = [];
  if (imports.trim()) {
    const strippedImports = stripTypeImports(imports);
    if (strippedImports.trim()) {
      const { processed: importsNoExport, exportEntries: importExportEntries, reExports: importReExports, starReExports: importStarReExports } = removeExports(strippedImports);
      convertedImports = convertStaticImportsToScript(importsNoExport, escapedSpecifier, mode);
      importSectionExports = importExportEntries;
      importSectionReExports = importReExports;
      importSectionStarReExports = importStarReExports;
    }
  }

  // Remove export keywords from body and track exports
  const { processed, exportEntries: bodyExportEntries, reExports: bodyReExports, starReExports: bodyStarReExports } = removeExports(body);

  // Combine export entries from both sections
  const exportEntries = [...importSectionExports, ...bodyExportEntries];
  const allReExports = [...importSectionReExports, ...bodyReExports];
  const allStarReExports = [...importSectionStarReExports, ...bodyStarReExports];

  // Rewrite dynamic import() and require() calls in body
  const rewrittenBody = rewriteDynamicImports(processed, specifier);

  // Generate re-export code
  const reExportLines: string[] = [];
  const reExportReturnEntries: string[] = [];
  let reExportCounter = 0;

  for (const reExport of allReExports) {
    const varName = `__reexport_${reExportCounter++}`;
    const escapedMod = reExport.moduleSpecifier.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    reExportLines.push(`const ${varName} = ${awaitPrefix}${importFn}("${escapedMod}", "${escapedSpecifier}");`);
    for (const spec of reExport.specifiers) {
      const localAccess = `${varName}[${JSON.stringify(spec.local)}]`;
      reExportReturnEntries.push(`${JSON.stringify(spec.exported)}: ${localAccess}`);
    }
  }

  const starSpreadEntries: string[] = [];
  for (const starReExport of allStarReExports) {
    const varName = `__reexport_star_${reExportCounter++}`;
    const escapedMod = starReExport.moduleSpecifier.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    reExportLines.push(`const ${varName} = ${awaitPrefix}${importFn}("${escapedMod}", "${escapedSpecifier}");`);
    if (starReExport.alias) {
      reExportReturnEntries.push(`${JSON.stringify(starReExport.alias)}: ${varName}`);
    } else {
      starSpreadEntries.push(`...${varName}`);
    }
  }

  // Build return statement
  const localReturnEntries = exportEntries.map(e =>
    e.exported === e.local ? e.local : `${JSON.stringify(e.exported)}: ${e.local}`
  );
  const allReturnEntries = [...starSpreadEntries, ...reExportReturnEntries, ...localReturnEntries];
  const returnStatement = allReturnEntries.length > 0
    ? `return { ${allReturnEntries.join(', ')} };`
    : 'return module.exports;';

  // CJS preamble: inject module/exports objects for CommonJS compatibility
  const cjsPreamble = 'var module = { exports: {} }; var exports = module.exports;';

  // Combine imports, re-export imports, and body
  const reExportCode = reExportLines.length > 0 ? reExportLines.join('\n') + '\n' : '';
  const codeBody = convertedImports
    ? `${cjsPreamble}\n${convertedImports}\n${reExportCode}${rewrittenBody}`
    : `${cjsPreamble}\n${reExportCode}${rewrittenBody}`;

  // Wrap in IIFE
  if (mode === 'async') {
    return `(async () => {\n${codeBody}\n${returnStatement}\n})()`;
  } else {
    return `(function() {\n${codeBody}\n${returnStatement}\n})()`;
  }
}

/**
 * Resolve a position through a source map using VLQ decoding.
 */
function resolveSourceMapPosition(
  sourceMap: SourceMap,
  line: number,
  column: number
): { line: number; column: number } | null {
  const mappingLines = sourceMap.mappings.split(";");
  const lineIndex = line - 1;

  if (lineIndex < 0 || lineIndex >= mappingLines.length) return null;

  // We need cumulative state across all lines up to our target line
  const state = [0, 0, 0, 0, 0]; // genCol, sourceIdx, origLine, origCol, nameIdx

  for (let l = 0; l <= lineIndex; l++) {
    const lineMapping = mappingLines[l]!;
    if (!lineMapping) continue;

    // Reset genCol per line (it's relative within each line)
    state[0] = 0;

    const segments = decodeMappingLineWithState(lineMapping, state);
    if (l === lineIndex) {
      if (segments.length === 0) return null;

      const col0 = column - 1;
      let bestSegment: { genCol: number; origLine: number; origCol: number } | null = null;

      for (const seg of segments) {
        if (seg.genCol <= col0) {
          bestSegment = seg;
        } else {
          break;
        }
      }

      if (!bestSegment) return null;

      return {
        line: bestSegment.origLine + 1,
        column: bestSegment.origCol + 1,
      };
    }
  }

  return null;
}

/**
 * Decode VLQ segments for a line, updating cumulative state.
 */
function decodeMappingLineWithState(
  line: string,
  state: number[]
): Array<{ genCol: number; origLine: number; origCol: number }> {
  const vlqChars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const results: Array<{ genCol: number; origLine: number; origCol: number }> = [];
  let i = 0;

  while (i < line.length) {
    if (line[i] === ",") { i++; continue; }

    let fieldCount = 0;
    const savedState = [...state];

    while (i < line.length && line[i] !== ",") {
      let value = 0;
      let shift = 0;
      let continuation = true;

      while (continuation && i < line.length) {
        const digit = vlqChars.indexOf(line[i]!);
        if (digit === -1) break;
        i++;
        continuation = (digit & 32) !== 0;
        value += (digit & 31) << shift;
        shift += 5;
      }

      const decoded = value & 1 ? -(value >> 1) : value >> 1;
      state[fieldCount] = state[fieldCount]! + decoded;
      fieldCount++;
    }

    if (fieldCount >= 4) {
      results.push({
        genCol: state[0]!,
        origLine: state[2]!,
        origCol: state[3]!,
      });
    }
  }

  return results;
}
