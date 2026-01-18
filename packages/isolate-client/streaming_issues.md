# Streaming Tests Issues

## Summary

The streaming tests in `streaming.test.ts` revealed that **response streaming is currently buffered, not truly streaming**. The daemon/client protocol appears to wait for the complete response body before sending it to the client.

## Test Results

- **Passing**: 18 tests
- **Failing**: 8 tests
- **Root cause**: Response bodies are buffered, not streamed incrementally

## Evidence of Buffering

### 1. Chunks are batched together

**Test**: `should read chunks via getReader()`
```
Expected: ["A", "B", "C"]
Actual:   ["ABC"]
```

The stream produces 3 separate chunks, but the client receives them as a single concatenated chunk.

### 2. High time-to-first-byte (TTFB)

**Test**: `should have low time-to-first-byte`
```
Expected: TTFB < 150ms
Actual:   TTFB = 202ms
```

The first chunk should arrive immediately, but instead waits ~200ms for subsequent chunks (matching the `setTimeout` delay in the stream).

### 3. All chunks arrive at once

**Test**: `should deliver chunks incrementally, not buffered`
```
Expected: 4 timestamps (3 chunks + done)
Actual:   2 timestamps (1 batched chunk + done)
```

Instead of receiving chunks with 100ms gaps (proving streaming), all chunks arrive together.

### 4. Pull-based streams with infinite data timeout

**Test**: `should handle early cancel via reader`
```
Error: Request timeout (30s)
```

When using `pull()` controller (which only produces data when requested), the request times out. This suggests the daemon waits for stream completion before responding.

## WHATWG Compliance Gap

Per the WHATWG Streams Standard, `ReadableStream` should:
1. Allow incremental chunk delivery via `reader.read()`
2. Support backpressure through `pull()` controller
3. Propagate errors chunk-by-chunk

Current behavior:
- Chunks are concatenated before transmission
- `pull()` based streams don't work correctly
- Response waits for `controller.close()` before sending

## Passing Tests (18)

These tests pass because they don't verify **timing** of chunk delivery:

- **Basic streaming**: sync chunks, empty streams, header preservation
- **SSE streaming**: format response, setInterval delays (content is correct, just not streamed)
- **POST request streaming**: JSON body handling
- **Delayed streaming**: NDJSON content is correct after full buffering
- **Binary streaming**: raw bytes correct after buffering
- **Large streams**: many chunks and larger sizes work when buffered

## Failing Tests (8)

1. `should allow partial consumption of SSE stream` - only 1 chunk received instead of 3
2. `should read chunks via getReader()` - chunks batched as "ABC"
3. `should handle early cancel via reader` - 30s timeout (pull-based stream)
4. `should propagate errors via reader` - 0 chunks instead of 2
5. `should allow partial read and cancel` - 30s timeout (pull-based stream)
6. `should deliver chunks incrementally, not buffered` - 2 timestamps instead of 4
7. `should have low time-to-first-byte` - TTFB 202ms instead of <150ms
8. `should stream with observable delays between chunks` - 1 chunk instead of 5

## Technical Analysis

The buffering likely occurs in one of these locations:

### 1. Daemon side (isolate-daemon)
The daemon may call `response.text()` or `response.arrayBuffer()` on the isolate's Response before sending it to the client, which consumes the entire stream.

### 2. Protocol layer (isolate-protocol)
The `DISPATCH_REQUEST` response may require the full body to be serialized before sending.

### 3. Client side (isolate-client/connection.ts)
The response handling in `connection.ts` does have streaming infrastructure:
- `RESPONSE_STREAM_START`
- `RESPONSE_STREAM_CHUNK`
- `RESPONSE_STREAM_END`

But these may not be used for all responses, or the daemon may not be sending chunked responses.

## Recommendations

### To enable true streaming:

1. **Daemon changes**: When the isolate returns a streaming Response, use `RESPONSE_STREAM_START` immediately with headers, then send each chunk via `RESPONSE_STREAM_CHUNK` as it becomes available.

2. **Pull-based support**: Implement `STREAM_PULL` to request more data from the isolate's stream, enabling backpressure.

3. **Early response**: Send response headers before body is complete.

### For now (documentation):

The current implementation is functional for most use cases where:
- Total response size is reasonable
- Client doesn't need real-time chunk delivery
- Content correctness matters more than timing

True streaming is needed for:
- AI token-by-token responses
- Server-Sent Events (SSE)
- Large file downloads
- Progress indicators
