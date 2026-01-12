import ivm from "isolated-vm";
import crypto from "node:crypto";

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
  const global = context.global;

  // Register host callbacks
  global.setSync(
    "__crypto_randomUUID",
    new ivm.Callback(() => {
      return crypto.randomUUID();
    })
  );

  global.setSync(
    "__crypto_getRandomValues",
    new ivm.Callback((byteLength: number) => {
      const buffer = Buffer.alloc(byteLength);
      crypto.randomFillSync(buffer);
      return Array.from(buffer);
    })
  );

  // Inject the crypto object into the isolate
  const cryptoCode = `
(function() {
  // DOMException polyfill (Pattern #12)
  if (typeof DOMException === 'undefined') {
    globalThis.DOMException = class DOMException extends Error {
      constructor(message, name) {
        super(message);
        this.name = name || 'DOMException';
      }
    };
  }

  globalThis.crypto = {
    randomUUID() {
      return __crypto_randomUUID();
    },

    getRandomValues(typedArray) {
      // Validate input is an integer TypedArray
      if (!(typedArray instanceof Int8Array ||
            typedArray instanceof Uint8Array ||
            typedArray instanceof Uint8ClampedArray ||
            typedArray instanceof Int16Array ||
            typedArray instanceof Uint16Array ||
            typedArray instanceof Int32Array ||
            typedArray instanceof Uint32Array ||
            typedArray instanceof BigInt64Array ||
            typedArray instanceof BigUint64Array)) {
        throw new TypeError("Argument 1 must be an integer typed array");
      }

      const byteLength = typedArray.byteLength;
      if (byteLength > 65536) {
        throw new DOMException(
          "The ArrayBufferView's byte length exceeds the number of bytes of entropy available via this API (65536)",
          "QuotaExceededError"
        );
      }

      // Get random bytes from host
      const bytes = __crypto_getRandomValues(byteLength);

      // Copy bytes into the TypedArray
      const view = new Uint8Array(typedArray.buffer, typedArray.byteOffset, typedArray.byteLength);
      for (let i = 0; i < bytes.length; i++) {
        view[i] = bytes[i];
      }

      return typedArray;
    }
  };
})();
`;

  context.evalSync(cryptoCode);

  return {
    dispose() {
      // No resources to cleanup - callbacks are stateless
    },
  };
}
