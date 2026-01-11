import type ivm from "isolated-vm";

export interface FsTestContext {
  isolate: ivm.Isolate;
  context: ivm.Context;
  dispose(): void;
}

/**
 * Create a test context with file system APIs set up
 */
export async function createFsTestContext(): Promise<FsTestContext> {
  // TODO: Implement fs test context creation
  throw new Error("Not implemented");
}
