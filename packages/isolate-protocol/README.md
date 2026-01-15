# @ricsam/isolate-protocol

Binary protocol for daemon-client communication. Uses MessagePack for efficient serialization.

## Installation

```bash
npm add @ricsam/isolate-protocol
```

## Frame Format

```
┌──────────┬──────────┬─────────────────┐
│ Length   │ Type     │ Payload         │
│ (4 bytes)│ (1 byte) │ (MessagePack)   │
└──────────┴──────────┴─────────────────┘
```

## Features

- MessagePack serialization (5-10x faster than JSON)
- Request/response correlation via request IDs
- Bidirectional callbacks for console, fetch, and fs operations
- Streaming support for large request/response bodies
- Event streaming for Playwright console logs and network activity

## Usage

```typescript
import {
  createFrameParser,
  buildFrame,
  MessageType,
  type CreateRuntimeRequest,
  type ResponseOk,
} from "@ricsam/isolate-protocol";

// Build a frame to send
const request: CreateRuntimeRequest = {
  type: MessageType.CREATE_RUNTIME,
  requestId: 1,
  options: { memoryLimit: 128 },
};
const frame = buildFrame(request);

// Parse incoming frames
const parser = createFrameParser();
for (const { message } of parser.feed(data)) {
  if (message.type === MessageType.RESPONSE_OK) {
    console.log("Response:", (message as ResponseOk).data);
  }
}
```

## License

MIT
