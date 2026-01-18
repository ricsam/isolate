# Stream Error Propagation Issue

## Problem

The test "should propagate errors via reader" fails because chunks received before a stream error are lost. The test expects to receive 2 chunks before the error, but receives 0 chunks (`chunks.length === 0`).

## Root Cause

The issue is in the client-side `STREAM_ERROR` message handler in `packages/isolate-client/src/connection.ts` (lines 452-480).

When a `STREAM_ERROR` message is received, the handler:
1. Marks the stream as errored
2. Calls `controller.error(new Error(msg.error))`
3. Cleans up

**But it does NOT flush `pendingChunks` before erroring the stream.**

This is different from the `RESPONSE_STREAM_END` handler (lines 409-436), which correctly flushes pending chunks before closing:

```typescript
// RESPONSE_STREAM_END handler (correct)
while (receiver.pendingChunks.length > 0) {
  const chunk = receiver.pendingChunks.shift()!;
  receiver.controller.enqueue(chunk);
}
receiver.controller.close();
```

## Why Chunks End Up Pending

The race condition occurs because:

1. **Client sends initial credit immediately** - On receiving `RESPONSE_STREAM_START`, the client sends `STREAM_PULL` with initial credit (line 383) before the consumer has called `reader.read()`.

2. **Daemon sends chunks immediately** - The daemon receives credit and starts reading from the isolate stream, sending `RESPONSE_STREAM_CHUNK` messages.

3. **Chunks arrive before consumer reads** - These chunk messages arrive at the client while no `pullResolver` is set (the test's `reader.read()` hasn't been called yet), so they're buffered in `pendingChunks`.

4. **Error arrives and discards pending chunks** - When `STREAM_ERROR` arrives, `controller.error()` is called immediately, making it impossible to deliver the buffered chunks.

## Sequence Diagram

```
Daemon                          Client                          Test
  |                               |                               |
  |<------ STREAM_PULL -----------|  (initial credit sent)        |
  |                               |                               |
  | read() -> pull() -> chunk1    |                               |
  |------- STREAM_CHUNK --------->|  pendingChunks: [chunk1]      |
  |                               |                               |
  | read() -> pull() -> chunk2    |                               |
  |------- STREAM_CHUNK --------->|  pendingChunks: [chunk1,chunk2]|
  |                               |                               |
  | read() -> pull() -> ERROR     |                               |
  |------- STREAM_ERROR --------->|  controller.error() called    |
  |                               |  pendingChunks LOST!          |
  |                               |                               |
  |                               |                               | reader.read()
  |                               |                               | -> throws error
  |                               |                               | chunks.length === 0
```

## Fix

The `STREAM_ERROR` handler should flush pending chunks before erroring the stream:

```typescript
case MessageType.STREAM_ERROR: {
  const msg = message as StreamError;
  // ... upload session handling ...

  const receiver = state.streamResponses.get(msg.streamId);
  if (receiver) {
    receiver.state = "errored";

    // MISSING: Flush pending chunks before erroring
    while (receiver.pendingChunks.length > 0) {
      const chunk = receiver.pendingChunks.shift()!;
      receiver.controller.enqueue(chunk);
    }

    // Now error the stream
    receiver.controller.error(new Error(msg.error));

    if (receiver.pullResolver) {
      const resolver = receiver.pullResolver;
      receiver.pullResolver = undefined;
      resolver();
    }

    state.streamResponses.delete(msg.streamId);
  }
  break;
}
```

## Why This Matters

Real-world streaming scenarios like AI token streaming or SSE often include useful data before an error:
- An AI model might stream several tokens before hitting a rate limit
- An SSE stream might send events before a connection error
- A streaming HTTP response might send partial content before a server error

Consumers should receive all successfully-transmitted data before the error is propagated.

## Verification

After the fix, the test "should propagate errors via reader" should pass, verifying that:
1. 2 chunks are received (`chunks.length === 2`)
2. The error is then thrown with message "Stream error at chunk 3"
