import type ivm from "isolated-vm";

export interface PathHandle {
  dispose(): void;
}

/**
 * Setup path utilities in an isolated-vm context
 *
 * Provides path manipulation utilities similar to Node.js path module
 *
 * @example
 * const handle = await setupPath(context);
 * await context.eval(`
 *   const joined = path.join("/foo", "bar", "baz");
 *   const dir = path.dirname("/foo/bar/baz.txt");
 * `);
 */
export async function setupPath(
  context: ivm.Context
): Promise<PathHandle> {
  // TODO: Implement path setup for isolated-vm
  return {
    dispose() {
      // TODO: Cleanup resources
    },
  };
}
