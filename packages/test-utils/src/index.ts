import type ivm from "isolated-vm";

// ============================================================================
// Types
// ============================================================================

export interface TestContext {
  isolate: ivm.Isolate;
  context: ivm.Context;
  dispose(): void;
}

export interface TestResult<T> {
  result: T;
  logs: Array<{ level: string; args: unknown[] }>;
}

// ============================================================================
// Context Creation
// ============================================================================

/**
 * Create a basic test context for isolated-vm tests.
 * This creates a bare context without any APIs set up.
 */
export async function createTestContext(): Promise<TestContext> {
  const ivm = await import("isolated-vm");
  const isolate = new ivm.default.Isolate();
  const context = await isolate.createContext();

  return {
    isolate,
    context,
    dispose() {
      context.release();
      isolate.dispose();
    },
  };
}

/**
 * Create a test context with core APIs set up (Blob, File, URL, streams, etc.)
 */
export async function createCoreTestContext(): Promise<TestContext> {
  const ivm = await import("isolated-vm");
  const { setupCore } = await import("@ricsam/isolate-core");

  const isolate = new ivm.default.Isolate();
  const context = await isolate.createContext();
  const coreHandle = await setupCore(context);

  return {
    isolate,
    context,
    dispose() {
      coreHandle.dispose();
      context.release();
      isolate.dispose();
    },
  };
}

// ============================================================================
// Code Evaluation Helpers
// ============================================================================

/**
 * Synchronously evaluate code and return typed result.
 * Use this for simple expressions that don't involve promises.
 *
 * @example
 * const result = evalCode<number>(ctx.context, "1 + 1");
 * // result === 2
 */
export function evalCode<T = unknown>(context: ivm.Context, code: string): T {
  return context.evalSync(code) as T;
}

/**
 * Asynchronously evaluate code that may return promises.
 * Automatically wraps code to handle promise resolution.
 *
 * @example
 * const result = await evalCodeAsync<string>(ctx.context, `
 *   (async () => {
 *     return "hello";
 *   })()
 * `);
 */
export async function evalCodeAsync<T = unknown>(
  context: ivm.Context,
  code: string
): Promise<T> {
  return (await context.eval(code, { promise: true })) as T;
}

/**
 * Evaluate code and return the result as JSON (for complex objects).
 * Useful when you need to extract structured data from the isolate.
 *
 * @example
 * const data = evalCodeJson<{ name: string }>(ctx.context, `
 *   JSON.stringify({ name: "test" })
 * `);
 */
export function evalCodeJson<T = unknown>(context: ivm.Context, code: string): T {
  const jsonString = context.evalSync(code) as string;
  return JSON.parse(jsonString) as T;
}

/**
 * Evaluate async code and return the result as JSON (for complex objects).
 *
 * @example
 * const data = await evalCodeJsonAsync<{ status: number }>(ctx.context, `
 *   (async () => {
 *     const response = await fetch("...");
 *     return JSON.stringify({ status: response.status });
 *   })()
 * `);
 */
export async function evalCodeJsonAsync<T = unknown>(
  context: ivm.Context,
  code: string
): Promise<T> {
  const jsonString = (await context.eval(code, { promise: true })) as string;
  return JSON.parse(jsonString) as T;
}

/**
 * Inject values into the isolate's global scope before running code.
 *
 * @example
 * await injectGlobals(ctx.context, {
 *   testInput: "hello",
 *   testConfig: { debug: true }
 * });
 * const result = evalCode<string>(ctx.context, "testInput");
 */
export async function injectGlobals(
  context: ivm.Context,
  values: Record<string, unknown>
): Promise<void> {
  const global = context.global;

  for (const [key, value] of Object.entries(values)) {
    if (typeof value === "function") {
      const ivm = await import("isolated-vm");
      global.setSync(key, new ivm.default.Callback(value as (...args: unknown[]) => unknown));
    } else if (typeof value === "object" && value !== null) {
      // For objects, serialize as JSON and inject
      context.evalSync(`globalThis.${key} = ${JSON.stringify(value)}`);
    } else {
      // For primitives, set directly
      global.setSync(key, value);
    }
  }
}

// ============================================================================
// Exports from other modules
// ============================================================================

export { MockFileSystem } from "./mock-fs.ts";
export { createFsTestContext } from "./fs-context.ts";
export type { FsTestContext } from "./fs-context.ts";
export { createRuntimeTestContext } from "./runtime-context.ts";
export type { RuntimeTestContext } from "./runtime-context.ts";
export { startIntegrationServer } from "./server.ts";
export type { IntegrationServer } from "./server.ts";
export { runTestCode } from "./native-input-test.ts";
export type { TestRunner, TestRuntime } from "./native-input-test.ts";
export { createFetchTestContext } from "./fetch-context.ts";
export type { FetchTestContext } from "./fetch-context.ts";

// Re-export useful types
export type { FileSystemHandler } from "@ricsam/isolate-fs";

// ============================================================================
// Type Checking Utilities
// ============================================================================

export {
  typecheckIsolateCode,
  formatTypecheckErrors,
  type TypecheckResult,
  type TypecheckError,
  type TypecheckOptions,
  type LibraryTypes,
  type LibraryTypeFile,
} from "./typecheck.ts";

// ============================================================================
// Type Definitions
// ============================================================================

export {
  CORE_TYPES,
  CONSOLE_TYPES,
  CRYPTO_TYPES,
  ENCODING_TYPES,
  FETCH_TYPES,
  FS_TYPES,
  PATH_TYPES,
  TEST_ENV_TYPES,
  TIMERS_TYPES,
  TYPE_DEFINITIONS,
  type TypeDefinitionKey,
} from "./isolate-types.ts";
