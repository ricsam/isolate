# Fetch Response Fixes

## Early Cancellation Hang (CALLBACK_STREAM_CANCEL)

### Problem

The "Early cancellation" test hung indefinitely. When an isolate handler fetches an infinite stream, reads 2 chunks, then calls `reader.cancel()`, the cancellation propagated correctly through the isolate → daemon stream registry → native stream reader cleanup. However, nothing told the **client** to stop streaming.

The flow:
1. Isolate calls `fetch(url)` which goes through daemon to client
2. Client's `registerFetchCallback` detects a network response with unknown content-length → takes the streaming path
3. `streamCallbackResponseBody` starts an infinite loop reading from the native HTTP response and sending `CALLBACK_STREAM_CHUNK` messages to the daemon
4. Isolate reads 2 chunks, calls `reader.cancel()`
5. Daemon-side stream registry cancels the `startNativeStreamReader` cleanup, which cancels the daemon-side ReadableStream
6. **But**: the client-side `streamCallbackResponseBody` is still reading from the real HTTP response and sending chunks to the daemon forever

The daemon had no way to tell the client "stop streaming, I don't need this data anymore."

### Solution

Added a `CALLBACK_STREAM_CANCEL` protocol message (daemon → client):

1. **Protocol** (`packages/isolate-protocol/src/types.ts`): Added `CALLBACK_STREAM_CANCEL: 0x95` message type and `CallbackStreamCancel` interface
2. **Daemon** (`packages/isolate-daemon/src/connection.ts`): In the `cancel()` callback of the ReadableStream created by `handleCallbackStreamStart`, send `CALLBACK_STREAM_CANCEL` to the client
3. **Client** (`packages/isolate-client/src/connection.ts`):
   - Added `callbackStreamReaders` map to `ConnectionState` to track active readers by streamId
   - `streamCallbackResponseBody` registers its reader in the map
   - `handleMessage` handles `CALLBACK_STREAM_CANCEL` by calling `reader.cancel()` on the tracked reader
   - The cancel causes the read loop to exit, which closes the HTTP connection to the upstream server
