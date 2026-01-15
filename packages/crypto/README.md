# @ricsam/isolate-crypto

Web Crypto API implementation for isolated-vm V8 sandbox.

## Installation

```bash
npm add @ricsam/isolate-crypto
```

## Usage

```typescript
import { setupCrypto } from "@ricsam/isolate-crypto";

const handle = await setupCrypto(context);
```

## Injected Globals

- `crypto.getRandomValues(array)` - Fill a TypedArray with random bytes
- `crypto.randomUUID()` - Generate a random UUID v4
- `crypto.subtle` - SubtleCrypto interface for cryptographic operations

## Usage in Isolate

```javascript
// Generate random bytes
const bytes = new Uint8Array(16);
crypto.getRandomValues(bytes);

// Generate UUID
const uuid = crypto.randomUUID();
console.log(uuid); // "550e8400-e29b-41d4-a716-446655440000"

// Hash data with SHA-256
const data = new TextEncoder().encode("Hello, World!");
const hash = await crypto.subtle.digest("SHA-256", data);

// Generate encryption key
const key = await crypto.subtle.generateKey(
  { name: "AES-GCM", length: 256 },
  true,
  ["encrypt", "decrypt"]
);

// Encrypt data
const iv = crypto.getRandomValues(new Uint8Array(12));
const encrypted = await crypto.subtle.encrypt(
  { name: "AES-GCM", iv },
  key,
  data
);

// Decrypt data
const decrypted = await crypto.subtle.decrypt(
  { name: "AES-GCM", iv },
  key,
  encrypted
);
```

## SubtleCrypto Methods

| Method | Description |
|--------|-------------|
| `digest` | Generate hash (SHA-256, SHA-384, SHA-512) |
| `generateKey` | Generate symmetric or asymmetric keys |
| `sign` / `verify` | Sign and verify data (HMAC, ECDSA) |
| `encrypt` / `decrypt` | Encrypt and decrypt data (AES-GCM, AES-CBC) |
| `importKey` / `exportKey` | Import/export keys (raw, jwk, pkcs8, spki) |
| `deriveBits` / `deriveKey` | Derive keys (PBKDF2, ECDH) |
| `wrapKey` / `unwrapKey` | Wrap/unwrap keys for secure transport |

**See also:** [MDN Web Crypto API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Crypto_API)

## License

MIT
