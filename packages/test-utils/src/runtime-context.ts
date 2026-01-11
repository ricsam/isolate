import type ivm from "isolated-vm";

export interface RuntimeTestContext {
  isolate: ivm.Isolate;
  context: ivm.Context;
  tick(): Promise<void>;
  dispose(): void;
}

/**
 * Create a test context with full runtime APIs set up
 */
export async function createRuntimeTestContext(): Promise<RuntimeTestContext> {
  // TODO: Implement runtime test context creation
  throw new Error("Not implemented");
}
