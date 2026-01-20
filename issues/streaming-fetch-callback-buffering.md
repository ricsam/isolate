# Issue: External Fetch Callback Buffers Entire Response (No Streaming)

## Summary

When an isolate makes an external `fetch()` call through the daemon's fetch callback, the entire response body is buffered before being returned to the isolate. This breaks streaming use cases like LLM API responses (OpenAI, Anthropic, etc.) where chunks should arrive incrementally.

## Affected Use Case

The `agent-sdk` and similar libraries that:
1. Make `fetch()` calls to external LLM APIs from within the isolate
2. Expect to stream the response body back to the client (browser)
3. May use `stream.tee()` or `TransformStream` to process the stream

## Symptoms

1. **All chunks arrive at once** - Instead of receiving chunks incrementally with ~100ms delays, all data arrives in a single burst after the LLM completes its entire response
2. **`response.body.tee()` throws** - `TypeError: llmResponse.body.tee is not a function` because the deserialized body is a `Uint8Array`, not a `ReadableStream`
3. **Browser SSE appears buffered** - User sees all events at once instead of streaming token-by-token

## Root Cause

Located in `packages/isolate-client/src/connection.ts` around line 1637:

```typescript
async function serializeResponse(response: Response): Promise<SerializedResponseData> {
  const headers: [string, string][] = [];
  response.headers.forEach((value, key) => {
    headers.push([key, value]);
  });

  let body: Uint8Array | null = null;
  if (response.body) {
    // THIS IS THE PROBLEM - waits for entire response body
    body = new Uint8Array(await response.arrayBuffer());
  }

  return {
    status: response.status,
    statusText: response.statusText,
    headers,
    body,
  };
}
```

The `await response.arrayBuffer()` call consumes the entire response body before serialization, blocking until the external server (e.g., OpenAI) completes its response.

On the daemon side in `packages/isolate-daemon/src/connection.ts`, the `deserializeResponse` function creates a `Response` with the buffered body:

```typescript
function deserializeResponse(data: SerializedResponse): Response {
  return new Response(data.body as unknown as BodyInit | null, {
    status: data.status,
    statusText: data.statusText,
    headers: data.headers,
  });
}
```

This results in `response.body` being a simple buffer, not a `ReadableStream` with methods like `.tee()`, `.pipeThrough()`, etc.

## Reproduction

### Test Script

Save as `bun-demo/external-fetch-test.ts` and run with `bun run external-fetch-test.ts`:

```typescript
import { spawn } from "bun";
import { connect } from "@ricsam/isolate-client";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  // Start mock LLM server that streams with 100ms delays
  const mockLLM = Bun.serve({
    port: 3300,
    fetch() {
      const encoder = new TextEncoder();
      const chunks = ["Hello", " from", " streaming", " LLM"];
      let i = 0;

      const stream = new ReadableStream({
        start(controller) {
          const emit = () => {
            if (i >= chunks.length) {
              controller.close();
              return;
            }
            controller.enqueue(encoder.encode(`data: {"content":"${chunks[i]}"}\n\n`));
            i++;
            setTimeout(emit, 100);
          };
          emit();
        },
      });

      return new Response(stream, {
        headers: { "Content-Type": "text/event-stream" },
      });
    },
  });

  // Start daemon
  const daemon = spawn({
    cmd: ["node", "--experimental-strip-types",
          "../packages/isolate-daemon/src/daemon.ts", "--port", "3100"],
    cwd: import.meta.dir,
    stdout: "inherit",
    stderr: "inherit",
  });

  await sleep(1000);
  const connection = await connect({ port: 3100 });

  const runtime = await connection.createRuntime({
    fetch: async (req) => fetch(req), // Forward to real network
  });

  await runtime.eval(`
    serve({
      async fetch(request) {
        // Fetch from mock LLM
        const llmResponse = await fetch("http://localhost:3300/");

        // Try to tee the stream (WILL FAIL)
        // const [s1, s2] = llmResponse.body.tee();

        // Even direct passthrough is buffered
        return new Response(llmResponse.body, {
          headers: { "Content-Type": "text/event-stream" }
        });
      }
    });
  `);

  const server = Bun.serve({
    port: 3200,
    fetch: (req) => runtime.fetch.dispatchRequest(req),
  });

  // Test - observe timing
  console.log("Fetching...");
  const start = Date.now();
  const res = await fetch("http://localhost:3200/");
  const reader = res.body!.getReader();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    console.log(`+${Date.now() - start}ms:`, new TextDecoder().decode(value));
  }

  // Expected: chunks at +0ms, +100ms, +200ms, +300ms
  // Actual: ALL chunks at +400ms (buffered)

  server.stop();
  mockLLM.stop();
  await connection.close();
  daemon.kill();
}

main();
```

### Expected Output
```
Fetching...
+2ms: data: {"content":"Hello"}
+102ms: data: {"content":" from"}
+203ms: data: {"content":" streaming"}
+304ms: data: {"content":" LLM"}
```

### Actual Output
```
Fetching...
+412ms: data: {"content":"Hello"}

data: {"content":" from"}

data: {"content":" streaming"}

data: {"content":" LLM"}
```

All chunks arrive together after ~400ms (the total streaming time).

## Proposed Solution

The fetch callback protocol needs to support streaming response bodies. Similar to how `RESPONSE_STREAM_CHUNK` messages are used for streaming responses FROM the isolate's `serve()` handler TO the client, we need the reverse:

### Option A: Stream Chunks Over Protocol

1. When `serializeResponse` encounters a streaming body, instead of buffering:
   - Send initial response metadata (status, headers)
   - Create a stream ID
   - Start pumping chunks through the protocol as `FETCH_RESPONSE_STREAM_CHUNK` messages

2. On daemon side, `deserializeResponse`:
   - Create a proper `ReadableStream`
   - Feed it chunks as they arrive over the protocol
   - Return a `Response` with this stream as the body

### Option B: Direct Connection for Streaming Fetch

For streaming responses, establish a direct connection between the isolate's fetch and the external server, bypassing the protocol serialization.

### Considerations

- **Backpressure** - Need to handle slow consumers
- **Error handling** - Stream errors need to propagate correctly
- **Cancellation** - If isolate cancels the stream, external request should be aborted
- **Memory** - Large streams shouldn't accumulate in memory
- **Protocol changes** - New message types needed

## Related Code Paths

### Client Side (where buffering happens)
- `packages/isolate-client/src/connection.ts`
  - `serializeResponse()` - line ~1637
  - `registerFetchCallback()` - line ~1190

### Daemon Side (where streaming would be consumed)
- `packages/isolate-daemon/src/connection.ts`
  - `deserializeResponse()`
  - `onFetch` handler in `createRuntime()` - line ~721

### Existing Streaming Infrastructure (for reference)
- `packages/isolate-protocol/src/messages.ts` - `RESPONSE_STREAM_CHUNK` message type
- `packages/isolate-client/src/connection.ts` - Response streaming from serve() handler
- `packages/fetch/src/stream-state.ts` - Stream state registry

## Workarounds

Until this is fixed:

1. **Use in-process runtime** - Don't use daemon for LLM streaming workloads (requires Node.js)
2. **Proxy outside isolate** - Make LLM calls in the host process, pass results to isolate
3. **Use WebSocket** - Stream LLM responses over WebSocket instead of fetch

## Unit Tests

The issue is reproduced in `packages/isolate-client/src/fetch-callback-streaming.test.ts`:

```bash
cd packages/isolate-client && npm test -- --test-name-pattern="Fetch Callback Streaming"
```

The tests currently **FAIL** with descriptive error messages:

```
✖ "External fetch should stream with ~100ms gaps between chunks,
    but got 0.0ms average gap. This indicates the response is being
    buffered instead of streamed."

✖ "External fetch response.body should have tee() method, but hasTee=false.
    Body constructor is 'HostBackedReadableStream' instead of a proper ReadableStream."

✖ "External fetch should stream like internal streams with ~100ms gaps,
    but got 0.0ms average gap. Internal stream works (100.0ms gaps),
    but external fetch is buffered."
```

When the bug is fixed, these tests will pass.

## Impact

- **High** for AI/LLM applications using agent-sdk or similar
- Streaming is a core feature for modern AI applications
- Users will see unacceptable latency (entire response time) instead of progressive streaming
