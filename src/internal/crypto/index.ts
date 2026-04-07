import ivm from "@ricsam/isolated-vm";
import crypto from "node:crypto";

export interface CryptoHandle {
  dispose(): void;
}

type HostCryptoKey = crypto.webcrypto.CryptoKey;
type HostKeyUsage = crypto.webcrypto.KeyUsage;
type HostKeyFormat = "raw" | "jwk" | "pkcs8" | "spki";

interface HostCryptoKeyPair {
  publicKey: HostCryptoKey;
  privateKey: HostCryptoKey;
}

interface SerializedKeyMetadata {
  keyId: number;
  algorithm: Record<string, unknown>;
  extractable: boolean;
  usages: HostKeyUsage[];
  type: HostCryptoKey["type"];
}

type SerializedKeyResult =
  | { kind: "key"; key: SerializedKeyMetadata }
  | {
      kind: "keyPair";
      publicKey: SerializedKeyMetadata;
      privateKey: SerializedKeyMetadata;
    };

interface SerializedExportedKey {
  format: HostKeyFormat;
  data: unknown;
}

// Host-side key storage for crypto.subtle
const cryptoKeysByContext = new WeakMap<ivm.Context, Map<number, HostCryptoKey>>();
let nextKeyId = 1;

function getKeyMapForContext(context: ivm.Context): Map<number, HostCryptoKey> {
  let map = cryptoKeysByContext.get(context);
  if (!map) {
    map = new Map();
    cryptoKeysByContext.set(context, map);
  }
  return map;
}

function isSerializedByteArrayObject(value: unknown): value is Record<string, number> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const keys = Object.keys(value);
  return keys.length > 0 && keys.every((key) => /^\d+$/.test(key));
}

function deserializeAlgorithm(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => deserializeAlgorithm(entry));
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  if (isSerializedByteArrayObject(value)) {
    const keys = Object.keys(value);
    const result = new Uint8Array(keys.length);
    for (let index = 0; index < keys.length; index += 1) {
      result[index] = value[String(index)] ?? 0;
    }
    return result;
  }

  const result: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    result[key] = deserializeAlgorithm(entry);
  }
  return result;
}

function serializeValue(value: unknown): unknown {
  if (value instanceof ArrayBuffer) {
    return Array.from(new Uint8Array(value));
  }

  if (ArrayBuffer.isView(value)) {
    return Array.from(new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
  }

  if (Array.isArray(value)) {
    return value.map((entry) => serializeValue(entry));
  }

  if (value && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      result[key] = serializeValue(entry);
    }
    return result;
  }

  return value;
}

function encodeError(err: unknown): never {
  if (err instanceof Error) {
    throw new Error(`[${err.name}]${err.message}`);
  }
  throw err;
}

function registerKey(
  keyMap: Map<number, HostCryptoKey>,
  cryptoKey: HostCryptoKey,
): SerializedKeyMetadata {
  const keyId = nextKeyId++;
  keyMap.set(keyId, cryptoKey);
  return {
    keyId,
    algorithm: serializeValue(cryptoKey.algorithm) as Record<string, unknown>,
    extractable: cryptoKey.extractable,
    usages: [...cryptoKey.usages],
    type: cryptoKey.type,
  };
}

function getKeyOrThrow(
  keyMap: Map<number, HostCryptoKey>,
  keyId: number,
): HostCryptoKey {
  const cryptoKey = keyMap.get(keyId);
  if (!cryptoKey) {
    throw new Error("[InvalidAccessError]Key not found");
  }
  return cryptoKey;
}

function isCryptoKeyPair(value: HostCryptoKey | HostCryptoKeyPair): value is HostCryptoKeyPair {
  return (
    value !== null &&
    typeof value === "object" &&
    "publicKey" in value &&
    "privateKey" in value
  );
}

function serializeKeyResult(
  keyMap: Map<number, HostCryptoKey>,
  value: HostCryptoKey | HostCryptoKeyPair,
): string {
  const result: SerializedKeyResult = isCryptoKeyPair(value)
    ? {
        kind: "keyPair",
        publicKey: registerKey(keyMap, value.publicKey),
        privateKey: registerKey(keyMap, value.privateKey),
      }
    : {
        kind: "key",
        key: registerKey(keyMap, value),
      };
  return JSON.stringify(result);
}

function serializeBytes(value: ArrayBuffer): string {
  return JSON.stringify(Array.from(new Uint8Array(value)));
}

function serializeExportedKey(
  format: HostKeyFormat,
  value: ArrayBuffer | crypto.webcrypto.JsonWebKey,
): string {
  const result: SerializedExportedKey = {
    format,
    data: format === "jwk" ? value : Array.from(new Uint8Array(value as ArrayBuffer)),
  };
  return JSON.stringify(result);
}

/**
 * Setup Web Crypto API in an isolated-vm context
 *
 * Provides crypto.getRandomValues, crypto.randomUUID, and a host-backed
 * subset of crypto.subtle.
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
  context: ivm.Context,
): Promise<CryptoHandle> {
  const global = context.global;

  // Register host callbacks
  global.setSync(
    "__crypto_randomUUID",
    new ivm.Callback(() => crypto.randomUUID()),
  );

  global.setSync(
    "__crypto_getRandomValues",
    new ivm.Callback((byteLength: number) => {
      const buffer = Buffer.alloc(byteLength);
      crypto.randomFillSync(buffer);
      return Array.from(buffer);
    }),
  );

  // Get key map for this context
  const keyMap = getKeyMapForContext(context);

  const importKeyRef = new ivm.Reference(
    async (
      format: HostKeyFormat,
      keyDataJson: string,
      algorithmJson: string,
      extractable: boolean,
      keyUsagesJson: string,
    ) => {
      try {
        const keyData = JSON.parse(keyDataJson) as number[] | crypto.webcrypto.JsonWebKey;
        const algorithm = deserializeAlgorithm(JSON.parse(algorithmJson));
        const keyUsages = JSON.parse(keyUsagesJson) as HostKeyUsage[];
        const importData =
          format === "jwk" ? keyData : new Uint8Array(keyData as number[]);
        const cryptoKey = await crypto.webcrypto.subtle.importKey(
          format as never,
          importData as never,
          algorithm as never,
          extractable,
          keyUsages,
        );
        return serializeKeyResult(keyMap, cryptoKey);
      } catch (err) {
        encodeError(err);
      }
    },
  );
  global.setSync("__crypto_subtle_importKey_ref", importKeyRef);

  const generateKeyRef = new ivm.Reference(
    async (
      algorithmJson: string,
      extractable: boolean,
      keyUsagesJson: string,
    ) => {
      try {
        const algorithm = deserializeAlgorithm(JSON.parse(algorithmJson));
        const keyUsages = JSON.parse(keyUsagesJson) as HostKeyUsage[];
        const generatedKey = (await crypto.webcrypto.subtle.generateKey(
          algorithm as never,
          extractable,
          keyUsages,
        )) as HostCryptoKey | HostCryptoKeyPair;
        return serializeKeyResult(keyMap, generatedKey);
      } catch (err) {
        encodeError(err);
      }
    },
  );
  global.setSync("__crypto_subtle_generateKey_ref", generateKeyRef);

  const exportKeyRef = new ivm.Reference(
    async (format: HostKeyFormat, keyId: number) => {
      try {
        const cryptoKey = getKeyOrThrow(keyMap, keyId);
        const exportedKey = await crypto.webcrypto.subtle.exportKey(
          format as never,
          cryptoKey,
        );
        return serializeExportedKey(format, exportedKey);
      } catch (err) {
        encodeError(err);
      }
    },
  );
  global.setSync("__crypto_subtle_exportKey_ref", exportKeyRef);

  const encryptRef = new ivm.Reference(
    async (algorithmJson: string, keyId: number, dataJson: string) => {
      try {
        const algorithm = deserializeAlgorithm(JSON.parse(algorithmJson));
        const data = new Uint8Array(JSON.parse(dataJson) as number[]);
        const cryptoKey = getKeyOrThrow(keyMap, keyId);
        const encrypted = await crypto.webcrypto.subtle.encrypt(
          algorithm as never,
          cryptoKey,
          data,
        );
        return serializeBytes(encrypted);
      } catch (err) {
        encodeError(err);
      }
    },
  );
  global.setSync("__crypto_subtle_encrypt_ref", encryptRef);

  const decryptRef = new ivm.Reference(
    async (algorithmJson: string, keyId: number, dataJson: string) => {
      try {
        const algorithm = deserializeAlgorithm(JSON.parse(algorithmJson));
        const data = new Uint8Array(JSON.parse(dataJson) as number[]);
        const cryptoKey = getKeyOrThrow(keyMap, keyId);
        const decrypted = await crypto.webcrypto.subtle.decrypt(
          algorithm as never,
          cryptoKey,
          data,
        );
        return serializeBytes(decrypted);
      } catch (err) {
        encodeError(err);
      }
    },
  );
  global.setSync("__crypto_subtle_decrypt_ref", decryptRef);

  const wrapKeyRef = new ivm.Reference(
    async (
      format: HostKeyFormat,
      keyId: number,
      wrappingKeyId: number,
      wrapAlgorithmJson: string,
    ) => {
      try {
        const cryptoKey = getKeyOrThrow(keyMap, keyId);
        const wrappingKey = getKeyOrThrow(keyMap, wrappingKeyId);
        const wrapAlgorithm = deserializeAlgorithm(JSON.parse(wrapAlgorithmJson));
        const wrappedKey = await crypto.webcrypto.subtle.wrapKey(
          format as never,
          cryptoKey,
          wrappingKey,
          wrapAlgorithm as never,
        );
        return serializeBytes(wrappedKey);
      } catch (err) {
        encodeError(err);
      }
    },
  );
  global.setSync("__crypto_subtle_wrapKey_ref", wrapKeyRef);

  const unwrapKeyRef = new ivm.Reference(
    async (
      format: HostKeyFormat,
      wrappedKeyJson: string,
      unwrappingKeyId: number,
      unwrapAlgorithmJson: string,
      unwrappedKeyAlgorithmJson: string,
      extractable: boolean,
      keyUsagesJson: string,
    ) => {
      try {
        const wrappedKey = new Uint8Array(JSON.parse(wrappedKeyJson) as number[]);
        const unwrappingKey = getKeyOrThrow(keyMap, unwrappingKeyId);
        const unwrapAlgorithm = deserializeAlgorithm(JSON.parse(unwrapAlgorithmJson));
        const unwrappedKeyAlgorithm = deserializeAlgorithm(
          JSON.parse(unwrappedKeyAlgorithmJson),
        );
        const keyUsages = JSON.parse(keyUsagesJson) as HostKeyUsage[];
        const unwrappedKey = await crypto.webcrypto.subtle.unwrapKey(
          format as never,
          wrappedKey,
          unwrappingKey,
          unwrapAlgorithm as never,
          unwrappedKeyAlgorithm as never,
          extractable,
          keyUsages,
        );
        return serializeKeyResult(keyMap, unwrappedKey);
      } catch (err) {
        encodeError(err);
      }
    },
  );
  global.setSync("__crypto_subtle_unwrapKey_ref", unwrapKeyRef);

  const signRef = new ivm.Reference(
    async (algorithmJson: string, keyId: number, dataJson: string) => {
      try {
        const algorithm = deserializeAlgorithm(JSON.parse(algorithmJson));
        const data = new Uint8Array(JSON.parse(dataJson) as number[]);
        const cryptoKey = getKeyOrThrow(keyMap, keyId);
        const signature = await crypto.webcrypto.subtle.sign(
          algorithm as never,
          cryptoKey,
          data,
        );
        return serializeBytes(signature);
      } catch (err) {
        encodeError(err);
      }
    },
  );
  global.setSync("__crypto_subtle_sign_ref", signRef);

  const verifyRef = new ivm.Reference(
    async (
      algorithmJson: string,
      keyId: number,
      signatureJson: string,
      dataJson: string,
    ) => {
      try {
        const algorithm = deserializeAlgorithm(JSON.parse(algorithmJson));
        const signature = new Uint8Array(JSON.parse(signatureJson) as number[]);
        const data = new Uint8Array(JSON.parse(dataJson) as number[]);
        const cryptoKey = getKeyOrThrow(keyMap, keyId);
        return await crypto.webcrypto.subtle.verify(
          algorithm as never,
          cryptoKey,
          signature,
          data,
        );
      } catch (err) {
        encodeError(err);
      }
    },
  );
  global.setSync("__crypto_subtle_verify_ref", verifyRef);

  const digestRef = new ivm.Reference(
    async (algorithmJson: string, dataJson: string) => {
      try {
        const algorithm = deserializeAlgorithm(JSON.parse(algorithmJson));
        const data = new Uint8Array(JSON.parse(dataJson) as number[]);
        const hash = await crypto.webcrypto.subtle.digest(algorithm as never, data);
        return serializeBytes(hash);
      } catch (err) {
        encodeError(err);
      }
    },
  );
  global.setSync("__crypto_subtle_digest_ref", digestRef);

  const deriveBitsRef = new ivm.Reference(
    async (algorithmJson: string, keyId: number, length: number) => {
      try {
        const algorithm = deserializeAlgorithm(JSON.parse(algorithmJson));
        const cryptoKey = getKeyOrThrow(keyMap, keyId);
        const bits = await crypto.webcrypto.subtle.deriveBits(
          algorithm as never,
          cryptoKey,
          length,
        );
        return serializeBytes(bits);
      } catch (err) {
        encodeError(err);
      }
    },
  );
  global.setSync("__crypto_subtle_deriveBits_ref", deriveBitsRef);

  const deriveKeyRef = new ivm.Reference(
    async (
      algorithmJson: string,
      baseKeyId: number,
      derivedKeyAlgorithmJson: string,
      extractable: boolean,
      keyUsagesJson: string,
    ) => {
      try {
        const algorithm = deserializeAlgorithm(JSON.parse(algorithmJson));
        const derivedKeyAlgorithm = deserializeAlgorithm(
          JSON.parse(derivedKeyAlgorithmJson),
        );
        const keyUsages = JSON.parse(keyUsagesJson) as HostKeyUsage[];
        const baseKey = getKeyOrThrow(keyMap, baseKeyId);
        const derivedKey = await crypto.webcrypto.subtle.deriveKey(
          algorithm as never,
          baseKey,
          derivedKeyAlgorithm as never,
          extractable,
          keyUsages,
        );
        return serializeKeyResult(keyMap, derivedKey);
      } catch (err) {
        encodeError(err);
      }
    },
  );
  global.setSync("__crypto_subtle_deriveKey_ref", deriveKeyRef);

  // Inject the crypto object into the isolate
  const cryptoCode = `
(function() {
  if (typeof DOMException === "undefined") {
    globalThis.DOMException = class DOMException extends Error {
      constructor(message, name) {
        super(message);
        this.name = name || "DOMException";
      }
    };
  }

  function deserializeAlgorithmValue(value) {
    if (Array.isArray(value)) {
      return value.map((entry) => deserializeAlgorithmValue(entry));
    }

    if (!value || typeof value !== "object") {
      return value;
    }

    const keys = Object.keys(value);
    if (!Array.isArray(value) && keys.length > 0 && keys.every((key) => /^\\d+$/.test(key))) {
      const result = new Uint8Array(keys.length);
      for (let index = 0; index < keys.length; index += 1) {
        result[index] = value[String(index)] ?? 0;
      }
      return result;
    }

    const result = {};
    for (const [key, entry] of Object.entries(value)) {
      result[key] = deserializeAlgorithmValue(entry);
    }
    return result;
  }

  function __decodeError(err) {
    if (!(err instanceof Error)) return err;
    const match = err.message.match(/^\\[(TypeError|RangeError|NotSupportedError|InvalidAccessError|InvalidStateError|OperationError|DataError|QuotaExceededError|SyntaxError|Error)\\](.*)$/);
    if (match) {
      if (["NotSupportedError", "InvalidAccessError", "InvalidStateError", "OperationError", "DataError", "QuotaExceededError", "SyntaxError"].includes(match[1])) {
        return new DOMException(match[2], match[1]);
      }
      const ErrorType = globalThis[match[1]] || Error;
      return new ErrorType(match[2]);
    }
    return err;
  }

  const _cryptoKeyIds = new WeakMap();
  const _cryptoKeyAlgorithms = new WeakMap();
  const _cryptoKeyExtractable = new WeakMap();
  const _cryptoKeyUsages = new WeakMap();
  const _cryptoKeyTypes = new WeakMap();
  const cryptoKeyBrand = Symbol("CryptoKeyBrand");

  class CryptoKey {
    constructor(brand, metadata) {
      if (brand !== cryptoKeyBrand) {
        throw new TypeError("Illegal constructor");
      }

      _cryptoKeyIds.set(this, metadata.keyId);
      _cryptoKeyAlgorithms.set(this, deserializeAlgorithmValue(metadata.algorithm));
      _cryptoKeyExtractable.set(this, metadata.extractable);
      _cryptoKeyUsages.set(this, [...metadata.usages]);
      _cryptoKeyTypes.set(this, metadata.type || "secret");
    }

    get algorithm() {
      return _cryptoKeyAlgorithms.get(this);
    }

    get extractable() {
      return _cryptoKeyExtractable.get(this);
    }

    get usages() {
      return [...(_cryptoKeyUsages.get(this) || [])];
    }

    get type() {
      return _cryptoKeyTypes.get(this);
    }
  }

  Object.defineProperty(CryptoKey.prototype, Symbol.toStringTag, {
    value: "CryptoKey",
    configurable: true,
  });

  function createCryptoKey(metadata) {
    return new CryptoKey(cryptoKeyBrand, metadata);
  }

  function getKeyId(key) {
    return _cryptoKeyIds.get(key);
  }

  function createCryptoKeyResult(serializedResult) {
    const result = JSON.parse(serializedResult);
    if (result.kind === "keyPair") {
      return {
        publicKey: createCryptoKey(result.publicKey),
        privateKey: createCryptoKey(result.privateKey),
      };
    }

    return createCryptoKey(result.key);
  }

  function toByteArray(data) {
    if (typeof data === "string") {
      return Array.from(new TextEncoder().encode(data));
    }
    if (data instanceof ArrayBuffer) {
      return Array.from(new Uint8Array(data));
    }
    if (ArrayBuffer.isView(data)) {
      return Array.from(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
    }
    throw new TypeError("Data must be a BufferSource");
  }

  function normalizeAlgorithm(algorithm) {
    if (typeof algorithm === "string") {
      return { name: algorithm };
    }
    return algorithm;
  }

  function decodeByteResult(bytesJson) {
    const bytes = JSON.parse(bytesJson);
    return new Uint8Array(bytes).buffer;
  }

  function decodeExportedKey(serializedResult) {
    const result = JSON.parse(serializedResult);
    if (result.format === "jwk") {
      return result.data;
    }
    return new Uint8Array(result.data).buffer;
  }

  globalThis.CryptoKey = CryptoKey;

  globalThis.crypto = {
    randomUUID() {
      return __crypto_randomUUID();
    },

    getRandomValues(typedArray) {
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

      const bytes = __crypto_getRandomValues(byteLength);
      const view = new Uint8Array(typedArray.buffer, typedArray.byteOffset, typedArray.byteLength);
      for (let index = 0; index < bytes.length; index += 1) {
        view[index] = bytes[index];
      }

      return typedArray;
    },

    subtle: {
      async importKey(format, keyData, algorithm, extractable, keyUsages) {
        try {
          const normalizedAlgo = normalizeAlgorithm(algorithm);
          const keyDataJson = format === "jwk"
            ? JSON.stringify(keyData)
            : JSON.stringify(toByteArray(keyData));

          return createCryptoKeyResult(await __crypto_subtle_importKey_ref.apply(undefined, [
            format,
            keyDataJson,
            JSON.stringify(normalizedAlgo),
            extractable,
            JSON.stringify(keyUsages),
          ], { result: { promise: true, copy: true } }));
        } catch (err) {
          throw __decodeError(err);
        }
      },

      async generateKey(algorithm, extractable, keyUsages) {
        try {
          const normalizedAlgo = normalizeAlgorithm(algorithm);
          const serializedKey = await __crypto_subtle_generateKey_ref.apply(undefined, [
            JSON.stringify(normalizedAlgo),
            extractable,
            JSON.stringify(keyUsages),
          ], { result: { promise: true, copy: true } });
          return createCryptoKeyResult(serializedKey);
        } catch (err) {
          throw __decodeError(err);
        }
      },

      async exportKey(format, key) {
        try {
          if (!(key instanceof CryptoKey)) {
            throw new TypeError("Key must be a CryptoKey");
          }

          const serializedResult = await __crypto_subtle_exportKey_ref.apply(undefined, [
            format,
            getKeyId(key),
          ], { result: { promise: true, copy: true } });
          return decodeExportedKey(serializedResult);
        } catch (err) {
          throw __decodeError(err);
        }
      },

      async encrypt(algorithm, key, data) {
        try {
          if (!(key instanceof CryptoKey)) {
            throw new TypeError("Key must be a CryptoKey");
          }

          const normalizedAlgo = normalizeAlgorithm(algorithm);
          const bytesJson = await __crypto_subtle_encrypt_ref.apply(undefined, [
            JSON.stringify(normalizedAlgo),
            getKeyId(key),
            JSON.stringify(toByteArray(data)),
          ], { result: { promise: true, copy: true } });
          return decodeByteResult(bytesJson);
        } catch (err) {
          throw __decodeError(err);
        }
      },

      async decrypt(algorithm, key, data) {
        try {
          if (!(key instanceof CryptoKey)) {
            throw new TypeError("Key must be a CryptoKey");
          }

          const normalizedAlgo = normalizeAlgorithm(algorithm);
          const bytesJson = await __crypto_subtle_decrypt_ref.apply(undefined, [
            JSON.stringify(normalizedAlgo),
            getKeyId(key),
            JSON.stringify(toByteArray(data)),
          ], { result: { promise: true, copy: true } });
          return decodeByteResult(bytesJson);
        } catch (err) {
          throw __decodeError(err);
        }
      },

      async wrapKey(format, key, wrappingKey, wrapAlgorithm) {
        try {
          if (!(key instanceof CryptoKey) || !(wrappingKey instanceof CryptoKey)) {
            throw new TypeError("Key must be a CryptoKey");
          }

          const normalizedWrapAlgo = normalizeAlgorithm(wrapAlgorithm);
          const bytesJson = await __crypto_subtle_wrapKey_ref.apply(undefined, [
            format,
            getKeyId(key),
            getKeyId(wrappingKey),
            JSON.stringify(normalizedWrapAlgo),
          ], { result: { promise: true, copy: true } });
          return decodeByteResult(bytesJson);
        } catch (err) {
          throw __decodeError(err);
        }
      },

      async unwrapKey(format, wrappedKey, unwrappingKey, unwrapAlgorithm, unwrappedKeyAlgorithm, extractable, keyUsages) {
        try {
          if (!(unwrappingKey instanceof CryptoKey)) {
            throw new TypeError("Key must be a CryptoKey");
          }

          const normalizedUnwrapAlgo = normalizeAlgorithm(unwrapAlgorithm);
          const normalizedUnwrappedKeyAlgo = normalizeAlgorithm(unwrappedKeyAlgorithm);
          const serializedKey = await __crypto_subtle_unwrapKey_ref.apply(undefined, [
            format,
            JSON.stringify(toByteArray(wrappedKey)),
            getKeyId(unwrappingKey),
            JSON.stringify(normalizedUnwrapAlgo),
            JSON.stringify(normalizedUnwrappedKeyAlgo),
            extractable,
            JSON.stringify(keyUsages),
          ], { result: { promise: true, copy: true } });
          return createCryptoKeyResult(serializedKey);
        } catch (err) {
          throw __decodeError(err);
        }
      },

      async sign(algorithm, key, data) {
        try {
          if (!(key instanceof CryptoKey)) {
            throw new TypeError("Key must be a CryptoKey");
          }

          const normalizedAlgo = normalizeAlgorithm(algorithm);
          const signatureBytesJson = await __crypto_subtle_sign_ref.apply(undefined, [
            JSON.stringify(normalizedAlgo),
            getKeyId(key),
            JSON.stringify(toByteArray(data)),
          ], { result: { promise: true, copy: true } });
          return decodeByteResult(signatureBytesJson);
        } catch (err) {
          throw __decodeError(err);
        }
      },

      async verify(algorithm, key, signature, data) {
        try {
          if (!(key instanceof CryptoKey)) {
            throw new TypeError("Key must be a CryptoKey");
          }

          const normalizedAlgo = normalizeAlgorithm(algorithm);
          return await __crypto_subtle_verify_ref.apply(undefined, [
            JSON.stringify(normalizedAlgo),
            getKeyId(key),
            JSON.stringify(toByteArray(signature)),
            JSON.stringify(toByteArray(data)),
          ], { result: { promise: true, copy: true } });
        } catch (err) {
          throw __decodeError(err);
        }
      },

      async digest(algorithm, data) {
        try {
          const normalizedAlgo = normalizeAlgorithm(algorithm);
          const hashBytesJson = await __crypto_subtle_digest_ref.apply(undefined, [
            JSON.stringify(normalizedAlgo),
            JSON.stringify(toByteArray(data)),
          ], { result: { promise: true, copy: true } });
          return decodeByteResult(hashBytesJson);
        } catch (err) {
          throw __decodeError(err);
        }
      },

      async deriveBits(algorithm, baseKey, length) {
        try {
          if (!(baseKey instanceof CryptoKey)) {
            throw new TypeError("Key must be a CryptoKey");
          }

          const normalizedAlgo = normalizeAlgorithm(algorithm);
          const bitsBytesJson = await __crypto_subtle_deriveBits_ref.apply(undefined, [
            JSON.stringify(normalizedAlgo),
            getKeyId(baseKey),
            length,
          ], { result: { promise: true, copy: true } });
          return decodeByteResult(bitsBytesJson);
        } catch (err) {
          throw __decodeError(err);
        }
      },

      async deriveKey(algorithm, baseKey, derivedKeyAlgorithm, extractable, keyUsages) {
        try {
          if (!(baseKey instanceof CryptoKey)) {
            throw new TypeError("Key must be a CryptoKey");
          }

          const normalizedAlgo = normalizeAlgorithm(algorithm);
          const normalizedDerivedAlgo = normalizeAlgorithm(derivedKeyAlgorithm);
          const serializedKey = await __crypto_subtle_deriveKey_ref.apply(undefined, [
            JSON.stringify(normalizedAlgo),
            getKeyId(baseKey),
            JSON.stringify(normalizedDerivedAlgo),
            extractable,
            JSON.stringify(keyUsages),
          ], { result: { promise: true, copy: true } });
          return createCryptoKeyResult(serializedKey);
        } catch (err) {
          throw __decodeError(err);
        }
      },
    },
  };
})();
`;

  context.evalSync(cryptoCode);

  return {
    dispose() {
      keyMap.clear();
    },
  };
}
