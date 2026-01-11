import type ivm from "isolated-vm";

export interface CryptoHandle {
  dispose(): void;
}

/**
 * Setup Web Crypto API in an isolated-vm context
 *
 * Provides crypto.getRandomValues and crypto.randomUUID
 *
 * @example
 * const handle = await setupCrypto(context);
 * await context.eval(`
 *   const uuid = crypto.randomUUID();
 *   const array = new Uint8Array(16);
 *   crypto.getRandomValues(array);
 * `);
 */
export async function setupCrypto(
  context: ivm.Context
): Promise<CryptoHandle> {
  // TODO: Implement crypto setup for isolated-vm
  return {
    dispose() {
      // TODO: Cleanup resources
    },
  };
}
