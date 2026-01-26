import type ivm from "isolated-vm";
import { MockFileSystem } from "./mock-fs.ts";
import ivmModule from "isolated-vm";
import { setupFs } from "@ricsam/isolate-fs";
import { clearAllInstanceState } from "@ricsam/isolate-core";
import { setupCore } from "@ricsam/isolate-core";

export interface FsTestContext {
  isolate: ivm.Isolate;
  context: ivm.Context;
  mockFs: MockFileSystem;
  dispose(): void;
}

/**
 * Create a test context with file system APIs set up using a mock file system.
 *
 * @example
 * const ctx = await createFsTestContext();
 *
 * // Set up initial files
 * ctx.mockFs.setFile("/test.txt", "Hello, World!");
 *
 * // Use file system APIs in the isolate
 * const result = await ctx.context.eval(`
 *   (async () => {
 *     const root = await navigator.storage.getDirectory();
 *     const fileHandle = await root.getFileHandle("test.txt");
 *     const file = await fileHandle.getFile();
 *     return await file.text();
 *   })()
 * `, { promise: true });
 *
 * ctx.dispose();
 */
export async function createFsTestContext(): Promise<FsTestContext> {
  const isolate = new ivmModule.Isolate();
  const context = await isolate.createContext();

  // Clear any previous instance state
  clearAllInstanceState();

  // Create mock file system
  const mockFs = new MockFileSystem();

  // Setup core APIs (required for Blob, File, streams)
  const coreHandle = await setupCore(context);

  // Setup file system APIs with mock handler
  const fsHandle = await setupFs(context, { getDirectory: async () => mockFs });

  return {
    isolate,
    context,
    mockFs,
    dispose() {
      fsHandle.dispose();
      coreHandle.dispose();
      context.release();
      isolate.dispose();
    },
  };
}
