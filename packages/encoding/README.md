# @ricsam/isolate-encoding

Base64 encoding and decoding via `atob` and `btoa` for isolated-vm V8 sandbox.

## Installation

```bash
npm add @ricsam/isolate-encoding
```

## Usage

```typescript
import { setupEncoding } from "@ricsam/isolate-encoding";

const handle = await setupEncoding(context);
```

## Injected Globals

- `atob(encodedData)` - Decode a Base64-encoded string
- `btoa(stringToEncode)` - Encode a string to Base64

## Usage in Isolate

```javascript
// Encode string to Base64
const encoded = btoa("Hello, World!");
console.log(encoded); // "SGVsbG8sIFdvcmxkIQ=="

// Decode Base64 to string
const decoded = atob("SGVsbG8sIFdvcmxkIQ==");
console.log(decoded); // "Hello, World!"

// Common use case: encoding JSON for transport
const data = { user: "john", token: "abc123" };
const base64Data = btoa(JSON.stringify(data));

// Decode it back
const originalData = JSON.parse(atob(base64Data));
```

## Error Handling

```javascript
// btoa throws for characters outside Latin1 range (0-255)
try {
  btoa("Hello 世界"); // Throws DOMException
} catch (e) {
  console.error("Cannot encode non-Latin1 characters");
}

// atob throws for invalid Base64
try {
  atob("not valid base64!!!");
} catch (e) {
  console.error("Invalid Base64 string");
}
```

## License

MIT
