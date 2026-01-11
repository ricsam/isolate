import type ivm from "isolated-vm";

// Types for isolated-vm context
export type { Isolate, Context, Reference } from "isolated-vm";

/**
 * Options for setting up core APIs
 */
export interface SetupCoreOptions {
  // TODO: Define options for core setup
}

/**
 * Handle returned from setupCore
 */
export interface CoreHandle {
  /** Dispose all resources */
  dispose(): void;
}

/**
 * Setup core APIs in an isolated-vm context
 *
 * Injects the following globals:
 * - ReadableStream, WritableStream, TransformStream
 * - ReadableStreamDefaultReader, WritableStreamDefaultWriter
 * - Blob
 * - File
 * - DOMException
 * - URL, URLSearchParams
 * - TextEncoder, TextDecoder
 *
 * @example
 * const isolate = new ivm.Isolate();
 * const context = await isolate.createContext();
 * const handle = await setupCore(context);
 *
 * await context.eval(`
 *   const blob = new Blob(["hello", " ", "world"], { type: "text/plain" });
 *   const text = await blob.text(); // "hello world"
 * `);
 */
export async function setupCore(
  context: ivm.Context,
  options?: SetupCoreOptions
): Promise<CoreHandle> {
  // TODO: Implement core setup for isolated-vm
  return {
    dispose() {
      // TODO: Cleanup resources
    },
  };
}

// Re-export types (to be implemented)
export interface Scope {
  // TODO: Define scope interface
}

export interface MarshalOptions {
  maxDepth?: number;
}

export interface UnmarshalOptions {
  maxDepth?: number;
}

// Placeholder exports (to be implemented)
export function withScope<T>(
  context: ivm.Context,
  callback: (scope: Scope) => T
): T {
  // TODO: Implement scope management
  throw new Error("Not implemented");
}

export async function withScopeAsync<T>(
  context: ivm.Context,
  callback: (scope: Scope) => Promise<T>
): Promise<T> {
  // TODO: Implement async scope management
  throw new Error("Not implemented");
}

export function marshal(
  context: ivm.Context,
  value: unknown,
  options?: MarshalOptions
): ivm.Reference {
  // TODO: Implement marshalling
  throw new Error("Not implemented");
}

export function unmarshal(
  context: ivm.Context,
  reference: ivm.Reference,
  options?: UnmarshalOptions
): unknown {
  // TODO: Implement unmarshalling
  throw new Error("Not implemented");
}

export function defineFunction(
  context: ivm.Context,
  name: string,
  fn: (...args: unknown[]) => unknown
): ivm.Reference {
  // TODO: Implement function definition
  throw new Error("Not implemented");
}

export function defineAsyncFunction(
  context: ivm.Context,
  name: string,
  fn: (...args: unknown[]) => Promise<unknown>
): ivm.Reference {
  // TODO: Implement async function definition
  throw new Error("Not implemented");
}

export function defineClass<TState extends object = object>(
  context: ivm.Context,
  definition: ClassDefinition<TState>
): ivm.Reference {
  // TODO: Implement class definition
  throw new Error("Not implemented");
}

export interface ClassDefinition<TState extends object = object> {
  name: string;
  construct?: (args: unknown[]) => TState;
  methods?: Record<string, (this: TState, ...args: unknown[]) => unknown>;
  properties?: Record<string, PropertyDescriptor<TState>>;
  staticMethods?: Record<string, (...args: unknown[]) => unknown>;
  staticProperties?: Record<string, unknown>;
}

export interface PropertyDescriptor<TState = unknown> {
  get?: (this: TState) => unknown;
  set?: (this: TState, value: unknown) => void;
  value?: unknown;
  writable?: boolean;
  enumerable?: boolean;
  configurable?: boolean;
}

export function clearAllInstanceState(): void {
  // TODO: Implement instance state cleanup
}

export function cleanupUnmarshaledHandles(context: ivm.Context): void {
  // TODO: Implement handle cleanup
}
