import ivm from "isolated-vm";
import crypto from "node:crypto";

export interface CryptoHandle {
  dispose(): void;
}

// Host-side key storage for crypto.subtle
const cryptoKeysByContext = new WeakMap<ivm.Context, Map<number, crypto.webcrypto.CryptoKey>>();
let nextKeyId = 1;

function getKeyMapForContext(context: ivm.Context): Map<number, crypto.webcrypto.CryptoKey> {
  let map = cryptoKeysByContext.get(context);
  if (!map) {
    map = new Map();
    cryptoKeysByContext.set(context, map);
  }
  return map;
}

function deserializeAlgorithm(algorithm: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(algorithm)) {
    if (value && typeof value === 'object' && !Array.isArray(value) &&
        Object.keys(value).every(k => /^\d+$/.test(k))) {
      // Convert {"0": n, "1": m, ...} back to Uint8Array
      const length = Object.keys(value).length;
      const arr = new Uint8Array(length);
      for (let i = 0; i < length; i++) {
        arr[i] = (value as Record<string, number>)[String(i)] ?? 0;
      }
      result[key] = arr;
    } else {
      result[key] = value;
    }
  }
  return result;
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

  // Get key map for this context
  const keyMap = getKeyMapForContext(context);

  // crypto.subtle.importKey - async reference
  const importKeyRef = new ivm.Reference(
    async (
      format: string,
      keyDataJson: string,
      algorithmJson: string,
      extractable: boolean,
      keyUsagesJson: string
    ) => {
      const keyData = JSON.parse(keyDataJson) as number[];
      const algorithm = JSON.parse(algorithmJson);
      const keyUsages = JSON.parse(keyUsagesJson) as crypto.webcrypto.KeyUsage[];

      try {
        let cryptoKey: crypto.webcrypto.CryptoKey;
        if (format === "raw") {
          const importData = new Uint8Array(keyData);
          cryptoKey = await crypto.webcrypto.subtle.importKey(
            "raw",
            importData,
            algorithm,
            extractable,
            keyUsages
          );
        } else if (format === "jwk") {
          const importData = keyData as unknown as crypto.webcrypto.JsonWebKey;
          cryptoKey = await crypto.webcrypto.subtle.importKey(
            "jwk",
            importData,
            algorithm,
            extractable,
            keyUsages
          );
        } else {
          throw new Error(`[NotSupportedError]Unsupported key format: ${format}`);
        }

        // Store key on host and return ID
        const keyId = nextKeyId++;
        keyMap.set(keyId, cryptoKey);
        return keyId;
      } catch (err) {
        if (err instanceof Error) {
          throw new Error(`[${err.name}]${err.message}`);
        }
        throw err;
      }
    }
  );
  global.setSync("__crypto_subtle_importKey_ref", importKeyRef);

  // crypto.subtle.sign - async reference
  const signRef = new ivm.Reference(
    async (algorithmJson: string, keyId: number, dataJson: string) => {
      const algorithm = JSON.parse(algorithmJson);
      const data = new Uint8Array(JSON.parse(dataJson) as number[]);

      const cryptoKey = keyMap.get(keyId);
      if (!cryptoKey) {
        throw new Error("[InvalidAccessError]Key not found");
      }

      try {
        const signature = await crypto.webcrypto.subtle.sign(
          algorithm,
          cryptoKey,
          data
        );
        return JSON.stringify(Array.from(new Uint8Array(signature)));
      } catch (err) {
        if (err instanceof Error) {
          throw new Error(`[${err.name}]${err.message}`);
        }
        throw err;
      }
    }
  );
  global.setSync("__crypto_subtle_sign_ref", signRef);

  // crypto.subtle.verify - async reference
  const verifyRef = new ivm.Reference(
    async (
      algorithmJson: string,
      keyId: number,
      signatureJson: string,
      dataJson: string
    ) => {
      const algorithm = JSON.parse(algorithmJson);
      const signature = new Uint8Array(JSON.parse(signatureJson) as number[]);
      const data = new Uint8Array(JSON.parse(dataJson) as number[]);

      const cryptoKey = keyMap.get(keyId);
      if (!cryptoKey) {
        throw new Error("[InvalidAccessError]Key not found");
      }

      try {
        return await crypto.webcrypto.subtle.verify(
          algorithm,
          cryptoKey,
          signature,
          data
        );
      } catch (err) {
        if (err instanceof Error) {
          throw new Error(`[${err.name}]${err.message}`);
        }
        throw err;
      }
    }
  );
  global.setSync("__crypto_subtle_verify_ref", verifyRef);

  // crypto.subtle.digest - async reference
  const digestRef = new ivm.Reference(
    async (algorithmJson: string, dataJson: string) => {
      const algorithm = JSON.parse(algorithmJson);
      const data = new Uint8Array(JSON.parse(dataJson) as number[]);

      try {
        const hash = await crypto.webcrypto.subtle.digest(algorithm, data);
        return JSON.stringify(Array.from(new Uint8Array(hash)));
      } catch (err) {
        if (err instanceof Error) {
          throw new Error(`[${err.name}]${err.message}`);
        }
        throw err;
      }
    }
  );
  global.setSync("__crypto_subtle_digest_ref", digestRef);

  // crypto.subtle.deriveBits - async reference
  const deriveBitsRef = new ivm.Reference(
    async (algorithmJson: string, keyId: number, length: number) => {
      const algorithm = deserializeAlgorithm(JSON.parse(algorithmJson));

      const cryptoKey = keyMap.get(keyId);
      if (!cryptoKey) {
        throw new Error("[InvalidAccessError]Key not found");
      }

      try {
        const bits = await crypto.webcrypto.subtle.deriveBits(
          algorithm as unknown as crypto.webcrypto.EcdhKeyDeriveParams | crypto.webcrypto.HkdfParams | crypto.webcrypto.Pbkdf2Params,
          cryptoKey,
          length
        );
        return JSON.stringify(Array.from(new Uint8Array(bits)));
      } catch (err) {
        if (err instanceof Error) {
          throw new Error(`[${err.name}]${err.message}`);
        }
        throw err;
      }
    }
  );
  global.setSync("__crypto_subtle_deriveBits_ref", deriveBitsRef);

  // crypto.subtle.deriveKey - async reference
  const deriveKeyRef = new ivm.Reference(
    async (
      algorithmJson: string,
      baseKeyId: number,
      derivedKeyAlgorithmJson: string,
      extractable: boolean,
      keyUsagesJson: string
    ) => {
      const algorithm = deserializeAlgorithm(JSON.parse(algorithmJson));
      const derivedKeyAlgorithm = JSON.parse(derivedKeyAlgorithmJson);
      const keyUsages = JSON.parse(keyUsagesJson) as crypto.webcrypto.KeyUsage[];

      const baseKey = keyMap.get(baseKeyId);
      if (!baseKey) {
        throw new Error("[InvalidAccessError]Key not found");
      }

      try {
        const derivedKey = await crypto.webcrypto.subtle.deriveKey(
          algorithm as unknown as crypto.webcrypto.EcdhKeyDeriveParams | crypto.webcrypto.HkdfParams | crypto.webcrypto.Pbkdf2Params,
          baseKey,
          derivedKeyAlgorithm,
          extractable,
          keyUsages
        );

        // Store derived key on host and return ID
        const keyId = nextKeyId++;
        keyMap.set(keyId, derivedKey);
        return keyId;
      } catch (err) {
        if (err instanceof Error) {
          throw new Error(`[${err.name}]${err.message}`);
        }
        throw err;
      }
    }
  );
  global.setSync("__crypto_subtle_deriveKey_ref", deriveKeyRef);

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

  // Helper to decode error from host
  function __decodeError(err) {
    if (!(err instanceof Error)) return err;
    const match = err.message.match(/^\\[(TypeError|RangeError|NotSupportedError|InvalidAccessError|OperationError|DataError|Error)\\](.*)$/);
    if (match) {
      if (['NotSupportedError', 'InvalidAccessError', 'OperationError', 'DataError'].includes(match[1])) {
        return new DOMException(match[2], match[1]);
      }
      const ErrorType = globalThis[match[1]] || Error;
      return new ErrorType(match[2]);
    }
    return err;
  }

  // CryptoKey class to wrap key IDs
  const _cryptoKeyIds = new WeakMap();

  class CryptoKey {
    constructor(keyId, algorithm, extractable, usages, type) {
      _cryptoKeyIds.set(this, keyId);
      this._algorithm = algorithm;
      this._extractable = extractable;
      this._usages = usages;
      this._type = type || 'secret';
    }

    _getKeyId() {
      return _cryptoKeyIds.get(this);
    }

    get algorithm() {
      return this._algorithm;
    }

    get extractable() {
      return this._extractable;
    }

    get usages() {
      return [...this._usages];
    }

    get type() {
      return this._type;
    }
  }

  globalThis.CryptoKey = CryptoKey;

  // Helper to convert data to byte array
  function toByteArray(data) {
    if (typeof data === 'string') {
      return Array.from(new TextEncoder().encode(data));
    }
    if (data instanceof ArrayBuffer) {
      return Array.from(new Uint8Array(data));
    }
    if (ArrayBuffer.isView(data)) {
      return Array.from(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
    }
    throw new TypeError('Data must be a BufferSource');
  }

  // Normalize algorithm to object form
  function normalizeAlgorithm(algorithm) {
    if (typeof algorithm === 'string') {
      return { name: algorithm };
    }
    return algorithm;
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
    },

    subtle: {
      async importKey(format, keyData, algorithm, extractable, keyUsages) {
        try {
          const normalizedAlgo = normalizeAlgorithm(algorithm);
          let keyDataJson;

          if (format === 'raw') {
            keyDataJson = JSON.stringify(toByteArray(keyData));
          } else if (format === 'jwk') {
            keyDataJson = JSON.stringify(keyData);
          } else {
            throw new DOMException('Unsupported key format: ' + format, 'NotSupportedError');
          }

          const keyId = __crypto_subtle_importKey_ref.applySyncPromise(undefined, [
            format,
            keyDataJson,
            JSON.stringify(normalizedAlgo),
            extractable,
            JSON.stringify(keyUsages)
          ]);

          return new CryptoKey(keyId, normalizedAlgo, extractable, keyUsages);
        } catch (err) {
          throw __decodeError(err);
        }
      },

      async sign(algorithm, key, data) {
        try {
          if (!(key instanceof CryptoKey)) {
            throw new TypeError('Key must be a CryptoKey');
          }
          const normalizedAlgo = normalizeAlgorithm(algorithm);
          const signatureBytesJson = __crypto_subtle_sign_ref.applySyncPromise(undefined, [
            JSON.stringify(normalizedAlgo),
            key._getKeyId(),
            JSON.stringify(toByteArray(data))
          ]);
          const signatureBytes = JSON.parse(signatureBytesJson);
          return new Uint8Array(signatureBytes).buffer;
        } catch (err) {
          throw __decodeError(err);
        }
      },

      async verify(algorithm, key, signature, data) {
        try {
          if (!(key instanceof CryptoKey)) {
            throw new TypeError('Key must be a CryptoKey');
          }
          const normalizedAlgo = normalizeAlgorithm(algorithm);
          return __crypto_subtle_verify_ref.applySyncPromise(undefined, [
            JSON.stringify(normalizedAlgo),
            key._getKeyId(),
            JSON.stringify(toByteArray(signature)),
            JSON.stringify(toByteArray(data))
          ]);
        } catch (err) {
          throw __decodeError(err);
        }
      },

      async digest(algorithm, data) {
        try {
          const normalizedAlgo = normalizeAlgorithm(algorithm);
          const hashBytesJson = __crypto_subtle_digest_ref.applySyncPromise(undefined, [
            JSON.stringify(normalizedAlgo),
            JSON.stringify(toByteArray(data))
          ]);
          const hashBytes = JSON.parse(hashBytesJson);
          return new Uint8Array(hashBytes).buffer;
        } catch (err) {
          throw __decodeError(err);
        }
      },

      async deriveBits(algorithm, baseKey, length) {
        try {
          if (!(baseKey instanceof CryptoKey)) {
            throw new TypeError('Key must be a CryptoKey');
          }
          const normalizedAlgo = normalizeAlgorithm(algorithm);
          const bitsBytesJson = __crypto_subtle_deriveBits_ref.applySyncPromise(undefined, [
            JSON.stringify(normalizedAlgo),
            baseKey._getKeyId(),
            length
          ]);
          const bitsBytes = JSON.parse(bitsBytesJson);
          return new Uint8Array(bitsBytes).buffer;
        } catch (err) {
          throw __decodeError(err);
        }
      },

      async deriveKey(algorithm, baseKey, derivedKeyAlgorithm, extractable, keyUsages) {
        try {
          if (!(baseKey instanceof CryptoKey)) {
            throw new TypeError('Key must be a CryptoKey');
          }
          const normalizedAlgo = normalizeAlgorithm(algorithm);
          const normalizedDerivedAlgo = normalizeAlgorithm(derivedKeyAlgorithm);
          const keyId = __crypto_subtle_deriveKey_ref.applySyncPromise(undefined, [
            JSON.stringify(normalizedAlgo),
            baseKey._getKeyId(),
            JSON.stringify(normalizedDerivedAlgo),
            extractable,
            JSON.stringify(keyUsages)
          ]);
          return new CryptoKey(keyId, normalizedDerivedAlgo, extractable, keyUsages);
        } catch (err) {
          throw __decodeError(err);
        }
      }
    }
  };
})();
`;

  context.evalSync(cryptoCode);

  return {
    dispose() {
      // Clean up key storage for this context
      keyMap.clear();
    },
  };
}
