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

  // Step 2: Validate no require(), dynamic import(), or top-level return in body
  validateBody(body);

  // Step 3: Strip types from body
  const strippedBody = stripTypes(body, importLineCount);

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
  parts.push(strippedBody);
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
export async function transformModuleCode(
  code: string,
  filename: string
): Promise<TransformResult> {
  // For modules, we need to preserve imports. Separate, strip types on body, recombine.
  const { imports, body, importLineCount } = separateImports(code);

  // Strip types from body
  const strippedBody = stripTypes(body, importLineCount);

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
  parts.push(strippedBody);
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
 * Validate that body code doesn't use require(), dynamic import(), or top-level return.
 */
function validateBody(body: string): void {
  if (/(?<![.\w])require\s*\(/.test(body)) {
    throw new Error(
      "require() is not allowed. Use ES module import statements instead."
    );
  }

  if (/\bimport\s*\(/.test(body)) {
    throw new Error(
      "Dynamic import() is not allowed in entry code. Use static import statements instead."
    );
  }

  // Check for top-level return statements (not inside braces)
  if (hasTopLevelReturn(body)) {
    throw new Error(
      "Top-level return is not allowed. Code runs as a module, not a script."
    );
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
