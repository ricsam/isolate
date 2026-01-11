import type ivm from "isolated-vm";

export interface EncodingHandle {
  dispose(): void;
}

/**
 * Setup encoding APIs in an isolated-vm context
 *
 * Injects atob and btoa for Base64 encoding/decoding
 *
 * @example
 * const handle = await setupEncoding(context);
 * await context.eval(`
 *   const encoded = btoa("hello");
 *   const decoded = atob(encoded);
 * `);
 */
export async function setupEncoding(
  context: ivm.Context
): Promise<EncodingHandle> {
  // TODO: Implement encoding setup for isolated-vm
  return {
    dispose() {
      // TODO: Cleanup resources
    },
  };
}
