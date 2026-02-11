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
 * Named import regex (handles single-line and multi-line).
 * Captures: [1] optional default part, [2] specifier list, [3] module path
 */
const NAMED_IMPORT_RE =
  /import\s+([\w$]+\s*,\s*)?\{([\s\S]*?)\}\s*from\s*['"]([^'"]+)['"];?/g;

/**
 * Find the 0-based line index of the last import declaration's closing line.
 * Returns -1 if no imports found.
 * Handles single-line imports, multi-line imports, `import type`, side-effect imports.
 */
function findLastImportEnd(code: string): number {
  const lines = code.split("\n");
  let lastImportLine = -1;
  let inImport = false;

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i]!.trim();

    if (inImport) {
      // Inside a multi-line import, look for closing
      if (trimmed.includes("from ") && (trimmed.endsWith(";") || trimmed.endsWith("'") || trimmed.endsWith('"'))) {
        inImport = false;
        lastImportLine = i;
      } else if (trimmed.endsWith(";")) {
        inImport = false;
        lastImportLine = i;
      }
      continue;
    }

    if (trimmed.startsWith("import ") || trimmed.startsWith("import{")) {
      // Check if it's a single-line import
      if (trimmed.includes(" from ") || trimmed.endsWith(";")) {
        lastImportLine = i;
      } else if (/^import\s+['"]/.test(trimmed)) {
        // Side-effect import: import "module" or import 'module'
        lastImportLine = i;
      } else {
        // Multi-line import
        inImport = true;
      }
    }
  }

  return lastImportLine;
}

/**
 * Elide unused imports from full stripped code.
 * Works on the entire code: blanks out import declarations to build reference body,
 * then removes specifiers not referenced in the body.
 * Line-preserving: removed imports are replaced with equivalent newlines.
 */
function elideUnusedImports(code: string): string {
  // Only search for imports in the import section at the top of the file.
  // Searching the entire code causes false matches inside strings/comments
  // in large bundled files (e.g. zod at 525KB).
  const lastImportLine = findLastImportEnd(code);
  if (lastImportLine < 0) return code;

  const lines = code.split("\n");
  const importSectionEnd = lines.slice(0, lastImportLine + 1).join("\n").length;
  const importSection = code.slice(0, importSectionEnd);

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
  while ((m = NAMED_IMPORT_RE.exec(importSection)) !== null) {
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

  // Build reference body: the entire code with import declarations blanked out.
  // This ensures we check for references everywhere outside imports.
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
      const asMatch = spec.match(/(\w+)\s+as\s+(\w+)/);
      const localName = asMatch ? asMatch[2]! : spec;
      const escaped = localName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const nameRe = new RegExp("\\b" + escaped + "\\b");

      if (nameRe.test(body)) {
        kept.push(spec);
      }
    }

    if (kept.length === entry.specifiers.length) continue;

    // Count newlines in the original match to preserve line count
    const originalNewlines = (entry.fullMatch.match(/\n/g) || []).length;

    let replacement: string;
    if (kept.length === 0 && !entry.defaultPart) {
      // Replace with equivalent newlines to preserve line positions
      replacement = "\n".repeat(originalNewlines);
    } else if (kept.length === 0) {
      const def = entry.defaultPart.replace(/\s*,\s*$/, "").trim();
      replacement = `import ${def} from '${entry.modulePath}';` + "\n".repeat(Math.max(0, originalNewlines));
    } else {
      replacement = `import ${entry.defaultPart}{ ${kept.join(", ")} } from '${entry.modulePath}';` + "\n".repeat(Math.max(0, originalNewlines));
    }

    result = result.slice(0, entry.start) + replacement + result.slice(entry.end);
  }

  return result;
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
 * 1. Find import/body boundary
 * 2. Validate body (on original code)
 * 3. Strip TypeScript types from full code
 * 4. Split at boundary, elide unused imports, clean blank lines
 * 5. Wrap body in `export default async function() { ... }`
 */
export async function transformEntryCode(
  code: string,
  filename: string
): Promise<TransformResult> {
  // Step 1: Find import/body boundary on original code
  const lastImportLine = findLastImportEnd(code);
  const lines = code.split("\n");
  const bodyStartLine = lastImportLine + 1;

  // Step 2: Validate body on original code (before stripping)
  const originalBody = lines.slice(bodyStartLine).join("\n");
  validateBody(originalBody);

  // Step 3: Strip types on full code
  const stripped = stripTypeScriptTypes(code, { mode: "strip" });

  // Step 4: Split stripped code at the boundary
  const strippedLines = stripped.split("\n");
  const strippedImportLines = strippedLines.slice(0, bodyStartLine);
  const strippedBody = strippedLines.slice(bodyStartLine).join("\n");

  // Step 5: Clean up import section (remove blank lines left by stripped `import type` declarations)
  let importSection = strippedImportLines
    .filter((line) => line.trim() !== "")
    .join("\n");

  // Step 6: Wrap body in async function
  const parts: string[] = [];
  if (importSection.trim()) {
    parts.push(importSection);
  }
  parts.push("export default async function() {");
  parts.push(strippedBody);
  parts.push("}");
  const wrappedCode = parts.join("\n");

  // Step 7: Build source map
  const wrappedImportLineCount = importSection.trim() ? importSection.split("\n").length : 0;
  const sourceMap = buildOffsetSourceMap(filename, wrappedImportLineCount + 1, bodyStartLine);

  return {
    code: wrappedCode,
    sourceMap,
  };
}

/**
 * Transform module code:
 * 1. Strip TypeScript types from full code
 * 2. Elide unused imports (line-preserving)
 * 3. Return with identity source map
 */
export async function transformModuleCode(
  code: string,
  filename: string
): Promise<TransformResult> {
  // Step 1: Strip types on full code
  const stripped = stripTypeScriptTypes(code, { mode: "strip" });

  // Step 2: Elide unused imports (line-preserving)
  const finalCode = elideUnusedImports(stripped);

  // Step 3: Identity source map (line positions preserved by strip + line-preserving elision)
  const sourceMap = buildOffsetSourceMap(filename, 0, 0);

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
