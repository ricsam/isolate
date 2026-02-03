/**
 * Type-checking utility for isolated-vm user code using ts-morph.
 *
 * This utility allows you to validate TypeScript code strings against
 * the isolate global type definitions before running them in the sandbox.
 *
 * @example
 * import { typecheckIsolateCode } from "@ricsam/isolate-types";
 *
 * const result = typecheckIsolateCode(`
 *   serve({
 *     fetch(request, server) {
 *       return new Response("Hello!");
 *     }
 *   });
 * `, { include: ["fetch"] });
 *
 * if (!result.success) {
 *   console.error("Type errors:", result.errors);
 * }
 */

import { Project, ts } from "ts-morph";
import { TYPE_DEFINITIONS, type TypeDefinitionKey } from "./isolate-types.ts";

/**
 * Result of type-checking isolate code.
 */
export interface TypecheckResult {
  /**
   * Whether the code passed type checking.
   */
  success: boolean;

  /**
   * Array of type errors found in the code.
   */
  errors: TypecheckError[];
}

/**
 * A single type-checking error.
 */
export interface TypecheckError {
  /**
   * The error message from TypeScript.
   */
  message: string;

  /**
   * The line number where the error occurred (1-indexed).
   */
  line?: number;

  /**
   * The column number where the error occurred (1-indexed).
   */
  column?: number;

  /**
   * The TypeScript error code.
   */
  code?: number;
}

/**
 * A single library type file to inject into the virtual file system.
 */
export interface LibraryTypeFile {
  /** The file content (e.g., .d.ts or package.json content) */
  content: string;
  /** The virtual path (e.g., "node_modules/zod/index.d.ts") */
  path: string;
}

/**
 * Library types bundle for a single package.
 */
export interface LibraryTypes {
  files: LibraryTypeFile[];
}

/**
 * Options for type-checking isolate code.
 */
export interface TypecheckOptions {
  /**
   * Which isolate global types to include.
   * @default ["core", "fetch", "fs"]
   */
  include?: Array<"core" | "fetch" | "fs" | "console" | "encoding" | "timers" | "testEnvironment" | "playwright">;

  /**
   * Library type definitions to inject for import resolution.
   * These are added to the virtual node_modules/ for module resolution.
   *
   * Use the build-library-types.ts script to generate these bundles from
   * your project's node_modules, then pass them here.
   *
   * @example
   * import { LIBRARY_TYPES } from "./my-library-types.ts";
   *
   * typecheckIsolateCode(code, {
   *   libraryTypes: {
   *     zod: LIBRARY_TYPES.zod,
   *     "@richie-rpc/core": LIBRARY_TYPES["@richie-rpc/core"],
   *   }
   * });
   */
  libraryTypes?: Record<string, LibraryTypes>;

  /**
   * Additional compiler options to pass to TypeScript.
   */
  compilerOptions?: Partial<ts.CompilerOptions>;
}

/**
 * Get the message text from a TypeScript diagnostic message.
 * Handles both string messages and DiagnosticMessageChain objects.
 */
function getMessageText(messageText: unknown): string {
  if (typeof messageText === "string") {
    return messageText;
  }

  // Handle ts-morph DiagnosticMessageChain wrapper
  if (
    messageText &&
    typeof messageText === "object" &&
    "getMessageText" in messageText &&
    typeof (messageText as { getMessageText: unknown }).getMessageText ===
      "function"
  ) {
    return (messageText as { getMessageText: () => string }).getMessageText();
  }

  // Handle raw TypeScript DiagnosticMessageChain
  if (
    messageText &&
    typeof messageText === "object" &&
    "messageText" in messageText
  ) {
    return String((messageText as { messageText: unknown }).messageText);
  }

  return String(messageText);
}


/**
 * Type-check isolate user code against the package type definitions.
 *
 * @param code - The TypeScript/JavaScript code to check
 * @param options - Configuration options
 * @returns The result of type checking
 *
 * @example
 * // Check code that uses the fetch API
 * const result = typecheckIsolateCode(`
 *   const response = await fetch("https://api.example.com/data");
 *   const data = await response.json();
 * `, { include: ["core", "fetch"] });
 *
 * @example
 * // Check code that uses serve()
 * const result = typecheckIsolateCode(`
 *   serve({
 *     fetch(request, server) {
 *       return new Response("Hello!");
 *     }
 *   });
 * `, { include: ["fetch"] });
 *
 * @example
 * // Check code that uses the file system API
 * const result = typecheckIsolateCode(`
 *   const root = await getDirectory("/data");
 *   const file = await root.getFileHandle("config.json");
 * `, { include: ["core", "fs"] });
 */
export function typecheckIsolateCode(
  code: string,
  options?: TypecheckOptions
): TypecheckResult {
  const include = options?.include ?? ["core", "fetch", "fs"];
  const libraryTypes = options?.libraryTypes ?? {};
  const hasLibraries = Object.keys(libraryTypes).length > 0;

  // Create a project with in-memory file system
  const project = new Project({
    useInMemoryFileSystem: true,
    compilerOptions: {
      target: ts.ScriptTarget.ESNext,
      module: ts.ModuleKind.ESNext,
      // Use NodeJs resolution for node_modules/ lookup when libraries are included
      moduleResolution: hasLibraries
        ? ts.ModuleResolutionKind.NodeJs
        : undefined,
      lib: ["lib.esnext.d.ts", "lib.dom.d.ts"],
      strict: true,
      noEmit: true,
      skipLibCheck: true,
      esModuleInterop: true,
      allowSyntheticDefaultImports: true,
      ...options?.compilerOptions,
    },
  });

  const memFs = project.getFileSystem();

  // Add type definition files from embedded strings (isolate globals)
  for (const pkg of include) {
    const content = TYPE_DEFINITIONS[pkg as TypeDefinitionKey];
    if (content) {
      project.createSourceFile(`${pkg}.d.ts`, content);
    }
  }

  // Add library type definitions to virtual node_modules/
  for (const [_libName, lib] of Object.entries(libraryTypes)) {
    for (const typeFile of lib.files) {
      // JSON files go to file system, TS files as source files
      if (typeFile.path.endsWith(".json")) {
        memFs.writeFileSync(`/${typeFile.path}`, typeFile.content);
      } else {
        project.createSourceFile(`/${typeFile.path}`, typeFile.content, { overwrite: true });
      }
    }
  }

  // Add the user code
  const sourceFile = project.createSourceFile("usercode.ts", code);

  // Get diagnostics
  const diagnostics = sourceFile.getPreEmitDiagnostics();

  // Convert diagnostics to our error format
  const errors: TypecheckError[] = diagnostics.map((diagnostic) => {
    const start = diagnostic.getStart();
    const sourceFile = diagnostic.getSourceFile();

    let line: number | undefined;
    let column: number | undefined;

    if (start !== undefined && sourceFile) {
      const lineAndChar = sourceFile.getLineAndColumnAtPos(start);
      line = lineAndChar.line;
      column = lineAndChar.column;
    }

    return {
      message: getMessageText(diagnostic.getMessageText()),
      line,
      column,
      code: diagnostic.getCode(),
    };
  });

  return {
    success: errors.length === 0,
    errors,
  };
}

/**
 * Format type-check errors for display.
 *
 * @param result - The type-check result
 * @returns A formatted string of errors
 *
 * @example
 * const result = typecheckIsolateCode(code);
 * if (!result.success) {
 *   console.error(formatTypecheckErrors(result));
 * }
 */
export function formatTypecheckErrors(result: TypecheckResult): string {
  if (result.success) {
    return "No type errors found.";
  }

  return result.errors
    .map((error) => {
      const location =
        error.line !== undefined ? `:${error.line}:${error.column ?? 1}` : "";
      const code = error.code ? ` (TS${error.code})` : "";
      return `usercode.ts${location}${code}: ${error.message}`;
    })
    .join("\n");
}
