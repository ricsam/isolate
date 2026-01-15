# @ricsam/isolate-core

Core utilities and Web Streams API for isolated-vm V8 sandbox.

## Installation

```bash
npm add @ricsam/isolate-core
```

## Usage

```typescript
import { setupCore } from "@ricsam/isolate-core";

const handle = await setupCore(context);
```

## Injected Globals

- `ReadableStream`, `WritableStream`, `TransformStream`
- `ReadableStreamDefaultReader`, `WritableStreamDefaultWriter`
- `Blob`, `File`
- `URL`, `URLSearchParams`
- `DOMException`
- `AbortController`, `AbortSignal`
- `TextEncoder`, `TextDecoder`

## Usage in Isolate

```javascript
// Streams
const stream = new ReadableStream({
  start(controller) {
    controller.enqueue("chunk1");
    controller.enqueue("chunk2");
    controller.close();
  }
});

const reader = stream.getReader();
const { value, done } = await reader.read();

// Blob
const blob = new Blob(["hello", " ", "world"], { type: "text/plain" });
const text = await blob.text(); // "hello world"

// File
const file = new File(["content"], "file.txt", { type: "text/plain" });
console.log(file.name); // "file.txt"
```

## License

MIT
