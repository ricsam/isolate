import assert from "node:assert/strict";
import { test } from "node:test";
import ivm from "@ricsam/isolated-vm";
import { setupCrypto } from "./index.ts";

async function withCryptoContext<T>(
  run: (context: ivm.Context) => Promise<T>,
): Promise<T> {
  const isolate = new ivm.Isolate({ memoryLimit: 64 });
  const context = await isolate.createContext();
  const handle = await setupCrypto(context);

  try {
    return await run(context);
  } finally {
    handle.dispose();
    context.release();
    isolate.dispose();
  }
}

async function evalJson<T>(context: ivm.Context, source: string): Promise<T> {
  const resultJson = (await context.eval(source, {
    promise: true,
    copy: true,
  })) as string;
  return JSON.parse(resultJson) as T;
}

test("setupCrypto exposes the broader subtle surface and blocks direct CryptoKey construction", async () => {
  const result = await withCryptoContext((context) =>
    evalJson<{
      subtleMethods: Record<string, string>;
      constructorErrorName: string;
    }>(
      context,
      `(async () => {
        const subtleMethods = {
          generateKey: typeof crypto.subtle.generateKey,
          importKey: typeof crypto.subtle.importKey,
          exportKey: typeof crypto.subtle.exportKey,
          encrypt: typeof crypto.subtle.encrypt,
          decrypt: typeof crypto.subtle.decrypt,
          wrapKey: typeof crypto.subtle.wrapKey,
          unwrapKey: typeof crypto.subtle.unwrapKey,
        };

        let constructorErrorName = "";
        try {
          new CryptoKey();
        } catch (error) {
          constructorErrorName = error?.name ?? "";
        }

        return JSON.stringify({ subtleMethods, constructorErrorName });
      })()`,
    ),
  );

  assert.deepEqual(result.subtleMethods, {
    generateKey: "function",
    importKey: "function",
    exportKey: "function",
    encrypt: "function",
    decrypt: "function",
    wrapKey: "function",
    unwrapKey: "function",
  });
  assert.equal(result.constructorErrorName, "TypeError");
});

test("setupCrypto supports AES-GCM generate/import/export/encrypt/decrypt flows", async () => {
  const result = await withCryptoContext((context) =>
    evalJson<{
      decrypted: number[];
      rawKeyLength: number;
      rawCipherLength: number;
      jwkCipherLength: number;
      jwkKty: string;
      jwkPrototypeName: string;
      keyAlgorithmName: string;
      keyAlgorithmLength: number;
      keyType: string;
      keyUsages: string[];
      invalidIvName: string;
      invalidUsageName: string;
    }>(
      context,
      `(async () => {
        const plaintext = new Uint8Array([5, 4, 3, 2, 1, 0]);
        const iv = new Uint8Array([11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0]);

        const key = await crypto.subtle.generateKey(
          { name: "AES-GCM", length: 256 },
          true,
          ["encrypt", "decrypt"],
        );

        const ciphertext = await crypto.subtle.encrypt(
          { name: "AES-GCM", iv },
          key,
          plaintext,
        );
        const decrypted = await crypto.subtle.decrypt(
          { name: "AES-GCM", iv },
          key,
          ciphertext,
        );

        const rawKey = await crypto.subtle.exportKey("raw", key);
        const rawImportedKey = await crypto.subtle.importKey(
          "raw",
          rawKey,
          { name: "AES-GCM" },
          true,
          ["encrypt", "decrypt"],
        );
        const rawCiphertext = await crypto.subtle.encrypt(
          { name: "AES-GCM", iv },
          rawImportedKey,
          plaintext,
        );

        const jwk = await crypto.subtle.exportKey("jwk", key);
        const jwkImportedKey = await crypto.subtle.importKey(
          "jwk",
          jwk,
          { name: "AES-GCM" },
          true,
          ["encrypt", "decrypt"],
        );
        const jwkCiphertext = await crypto.subtle.encrypt(
          { name: "AES-GCM", iv },
          jwkImportedKey,
          plaintext,
        );

        let invalidIvName = "";
        try {
          await crypto.subtle.encrypt(
            { name: "AES-GCM", iv: new Uint8Array(8) },
            key,
            plaintext,
          );
        } catch (error) {
          invalidIvName = error?.name ?? "";
        }

        const decryptOnlyKey = await crypto.subtle.importKey(
          "raw",
          rawKey,
          { name: "AES-GCM" },
          true,
          ["decrypt"],
        );

        let invalidUsageName = "";
        try {
          await crypto.subtle.encrypt(
            { name: "AES-GCM", iv },
            decryptOnlyKey,
            plaintext,
          );
        } catch (error) {
          invalidUsageName = error?.name ?? "";
        }

        return JSON.stringify({
          decrypted: Array.from(new Uint8Array(decrypted)),
          rawKeyLength: new Uint8Array(rawKey).length,
          rawCipherLength: new Uint8Array(rawCiphertext).length,
          jwkCipherLength: new Uint8Array(jwkCiphertext).length,
          jwkKty: jwk.kty,
          jwkPrototypeName: Object.getPrototypeOf(jwk)?.constructor?.name ?? "",
          keyAlgorithmName: key.algorithm.name,
          keyAlgorithmLength: key.algorithm.length,
          keyType: key.type,
          keyUsages: key.usages,
          invalidIvName,
          invalidUsageName,
        });
      })()`,
    ),
  );

  assert.deepEqual(result.decrypted, [5, 4, 3, 2, 1, 0]);
  assert.equal(result.rawKeyLength, 32);
  assert.ok(result.rawCipherLength > result.decrypted.length);
  assert.ok(result.jwkCipherLength > result.decrypted.length);
  assert.equal(result.jwkKty, "oct");
  assert.equal(result.jwkPrototypeName, "Object");
  assert.equal(result.keyAlgorithmName, "AES-GCM");
  assert.equal(result.keyAlgorithmLength, 256);
  assert.equal(result.keyType, "secret");
  assert.deepEqual(result.keyUsages, ["encrypt", "decrypt"]);
  assert.equal(result.invalidIvName, "OperationError");
  assert.equal(result.invalidUsageName, "InvalidAccessError");
});

test("setupCrypto supports AES-KW wrapKey and unwrapKey", async () => {
  const result = await withCryptoContext((context) =>
    evalJson<{
      decrypted: number[];
      wrappedLength: number;
      unwrappedType: string;
      unwrappedUsages: string[];
    }>(
      context,
      `(async () => {
        const wrappingKey = await crypto.subtle.generateKey(
          { name: "AES-KW", length: 256 },
          true,
          ["wrapKey", "unwrapKey"],
        );
        const dataKey = await crypto.subtle.generateKey(
          { name: "AES-GCM", length: 256 },
          true,
          ["encrypt", "decrypt"],
        );

        const wrapped = await crypto.subtle.wrapKey(
          "raw",
          dataKey,
          wrappingKey,
          "AES-KW",
        );

        const unwrapped = await crypto.subtle.unwrapKey(
          "raw",
          wrapped,
          wrappingKey,
          "AES-KW",
          { name: "AES-GCM", length: 256 },
          true,
          ["encrypt", "decrypt"],
        );

        const plaintext = new Uint8Array([42, 99, 7]);
        const iv = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
        const ciphertext = await crypto.subtle.encrypt(
          { name: "AES-GCM", iv },
          unwrapped,
          plaintext,
        );
        const decrypted = await crypto.subtle.decrypt(
          { name: "AES-GCM", iv },
          unwrapped,
          ciphertext,
        );

        return JSON.stringify({
          decrypted: Array.from(new Uint8Array(decrypted)),
          wrappedLength: new Uint8Array(wrapped).length,
          unwrappedType: unwrapped.type,
          unwrappedUsages: unwrapped.usages,
        });
      })()`,
    ),
  );

  assert.deepEqual(result.decrypted, [42, 99, 7]);
  assert.equal(result.wrappedLength, 40);
  assert.equal(result.unwrappedType, "secret");
  assert.deepEqual(result.unwrappedUsages, ["encrypt", "decrypt"]);
});

test("setupCrypto supports RSA-OAEP key pairs and asymmetric import/export", async () => {
  const result = await withCryptoContext((context) =>
    evalJson<{
      decrypted: number[];
      publicKeyType: string;
      privateKeyType: string;
      publicUsages: string[];
      privateUsages: string[];
      publicExponent: number[];
      spkiLength: number;
      pkcs8Length: number;
      publicJwkKty: string;
      privateJwkKty: string;
    }>(
      context,
      `(async () => {
        const keyPair = await crypto.subtle.generateKey(
          {
            name: "RSA-OAEP",
            modulusLength: 2048,
            publicExponent: new Uint8Array([1, 0, 1]),
            hash: "SHA-256",
          },
          true,
          ["encrypt", "decrypt", "wrapKey", "unwrapKey"],
        );

        const spki = await crypto.subtle.exportKey("spki", keyPair.publicKey);
        const pkcs8 = await crypto.subtle.exportKey("pkcs8", keyPair.privateKey);
        const publicJwk = await crypto.subtle.exportKey("jwk", keyPair.publicKey);
        const privateJwk = await crypto.subtle.exportKey("jwk", keyPair.privateKey);

        const importedPublicKey = await crypto.subtle.importKey(
          "spki",
          spki,
          { name: "RSA-OAEP", hash: "SHA-256" },
          true,
          ["encrypt", "wrapKey"],
        );
        const importedPrivateKey = await crypto.subtle.importKey(
          "pkcs8",
          pkcs8,
          { name: "RSA-OAEP", hash: "SHA-256" },
          true,
          ["decrypt", "unwrapKey"],
        );

        const jwkImportedPublicKey = await crypto.subtle.importKey(
          "jwk",
          publicJwk,
          { name: "RSA-OAEP", hash: "SHA-256" },
          true,
          ["encrypt", "wrapKey"],
        );
        const jwkImportedPrivateKey = await crypto.subtle.importKey(
          "jwk",
          privateJwk,
          { name: "RSA-OAEP", hash: "SHA-256" },
          true,
          ["decrypt", "unwrapKey"],
        );

        const plaintext = new Uint8Array([8, 6, 7, 5, 3, 0, 9]);
        const ciphertext = await crypto.subtle.encrypt(
          { name: "RSA-OAEP" },
          importedPublicKey,
          plaintext,
        );
        const decrypted = await crypto.subtle.decrypt(
          { name: "RSA-OAEP" },
          importedPrivateKey,
          ciphertext,
        );

        const jwkCiphertext = await crypto.subtle.encrypt(
          { name: "RSA-OAEP" },
          jwkImportedPublicKey,
          plaintext,
        );
        await crypto.subtle.decrypt(
          { name: "RSA-OAEP" },
          jwkImportedPrivateKey,
          jwkCiphertext,
        );

        return JSON.stringify({
          decrypted: Array.from(new Uint8Array(decrypted)),
          publicKeyType: keyPair.publicKey.type,
          privateKeyType: keyPair.privateKey.type,
          publicUsages: keyPair.publicKey.usages,
          privateUsages: keyPair.privateKey.usages,
          publicExponent: Array.from(keyPair.publicKey.algorithm.publicExponent),
          spkiLength: new Uint8Array(spki).length,
          pkcs8Length: new Uint8Array(pkcs8).length,
          publicJwkKty: publicJwk.kty,
          privateJwkKty: privateJwk.kty,
        });
      })()`,
    ),
  );

  assert.deepEqual(result.decrypted, [8, 6, 7, 5, 3, 0, 9]);
  assert.equal(result.publicKeyType, "public");
  assert.equal(result.privateKeyType, "private");
  assert.deepEqual(result.publicUsages, ["encrypt", "wrapKey"]);
  assert.deepEqual(result.privateUsages, ["decrypt", "unwrapKey"]);
  assert.deepEqual(result.publicExponent, [1, 0, 1]);
  assert.ok(result.spkiLength > 0);
  assert.ok(result.pkcs8Length > 0);
  assert.equal(result.publicJwkKty, "RSA");
  assert.equal(result.privateJwkKty, "RSA");
});
