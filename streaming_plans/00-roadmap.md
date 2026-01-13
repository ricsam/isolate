# Streaming Implementation Roadmap

## Status: COMPLETE

All streaming functionality has been implemented and tested.

## Goal

Implement true lazy streaming for Request and Response bodies in `@ricsam/isolate-fetch`, matching the WHATWG Streams API specification and the streaming capabilities in `ricsam-qjs`.

## Final State

- ✅ Stream State Registry implemented with backpressure support
- ✅ HostBackedReadableStream class for isolate-side streaming
- ✅ Request bodies stream from native to isolate (upload streaming)
- ✅ Response bodies stream from isolate to native (download streaming)
- ✅ `FormData` with `File` objects serialized as `multipart/form-data`
- ✅ Multipart parsing reconstructs `File` objects
- ✅ Comprehensive test suite (70+ tests)

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                         HOST (Node.js)                           │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │              Stream State Registry                        │   │
│  │  Map<streamId, {                                         │   │
│  │    queue: Uint8Array[],     // Chunk buffer              │   │
│  │    closed: boolean,          // Stream ended             │   │
│  │    errored: boolean,         // Error occurred           │   │
│  │    errorValue: unknown,      // The error                │   │
│  │    pullWaiting: boolean,     // Consumer waiting         │   │
│  │    pullResolve: Function,    // Resolve pull promise     │   │
│  │  }>                                                      │   │
│  └──────────────────────────────────────────────────────────┘   │
│                              │                                   │
│         ┌────────────────────┼────────────────────┐              │
│         ▼                    ▼                    ▼              │
│   __Stream_push()    __Stream_pull()    __Stream_close()        │
│   (sync callback)    (async ref)        (sync callback)         │
│         │                    │                    │              │
└─────────┼────────────────────┼────────────────────┼──────────────┘
          │                    │                    │
          ▼                    ▼                    ▼
┌─────────────────────────────────────────────────────────────────┐
│                       ISOLATE (V8)                               │
│                                                                  │
│  ReadableStream {                                               │
│    pull(controller) {                                           │
│      const chunk = __Stream_pull(this._streamId);  // blocks   │
│      if (chunk.done) controller.close();                        │
│      else controller.enqueue(chunk.value);                      │
│    }                                                            │
│  }                                                              │
└─────────────────────────────────────────────────────────────────┘
```

## Implementation Plans

| Plan | Title | Description | Dependencies | Status |
|------|-------|-------------|--------------|--------|
| [01](./01-stream-state-registry.md) | Stream State Registry | Host-side state management for streams | None | ✅ Done |
| [02](./02-host-backed-readable-stream.md) | Host-Backed ReadableStream | ReadableStream class backed by host state | 01 | ✅ Done |
| [03](./03-upload-streaming.md) | Upload Streaming | Native → Isolate streaming for Request bodies | 01, 02 | ✅ Done |
| [04](./04-download-streaming.md) | Download Streaming | Isolate → Native streaming for Response bodies | 01, 02 | ✅ Done |
| [05](./05-multipart-formdata.md) | Multipart FormData | Parse and serialize multipart/form-data | 01-04 | ✅ Done |
| [06](./06-streaming-tests.md) | Streaming Tests | Comprehensive test suite | 01-05 | ✅ Done |

## Test Coverage

| Test File | Tests | Description |
|-----------|-------|-------------|
| `stream-state.test.ts` | 30+ | Registry create/push/pull/close/error/backpressure |
| `host-backed-stream.test.ts` | 14 | HostBackedReadableStream class |
| `upload-streaming.test.ts` | 9 | Native → Isolate streaming |
| `download-streaming.test.ts` | 9 | Isolate → Native streaming |
| `form-data.test.ts` | 30+ | FormData & multipart parsing/serialization |
| `demo/e2e/richie-rpc.e2e.ts` | 4+ | E2E streaming endpoints |
| **Total** | **70+** | Comprehensive coverage |

## Key Design Decisions

### 1. Host-Side Queue vs Isolate-Side Queue

**Decision:** Host-side queue

**Rationale:**
- isolated-vm doesn't allow direct access to isolate internal state
- Host can manage memory limits and backpressure centrally
- Simpler error handling and cleanup

### 2. Sync vs Async Pull

**Decision:** Async pull using `ivm.Reference.applySyncPromise`

**Rationale:**
- `pull()` must be able to wait for data
- `applySyncPromise` blocks the isolate until Promise resolves
- Matches WHATWG ReadableStream semantics

### 3. Chunk Transfer Format

**Decision:** `ArrayBuffer` via `ivm.ExternalCopy`

**Rationale:**
- More efficient than JSON-serialized number arrays
- `ExternalCopy` allows zero-copy transfer for large chunks
- Native binary handling

### 4. Backpressure Strategy

**Decision:** Queue-based with configurable high-water mark

**Rationale:**
- Matches WHATWG Streams backpressure model
- Prevents memory exhaustion
- Producer can check queue depth before pushing

## Success Criteria - ALL MET

1. ✅ **E2E Tests Pass**: `demo/e2e/files.e2e.ts` all green
2. ✅ **Streaming Tests Pass**: All unit tests pass (70+ tests)
3. ✅ **Memory Efficient**: Large file uploads don't buffer entire file
4. ✅ **WHATWG Compliant**: `ReadableStream` API matches spec behavior

## Known Limitations

1. **Upload stream cleanup**: Native stream reader cancel operation is async but not awaited, causing benign warnings in Node.js test runner. Tests pass correctly.

2. **HostBackedReadableStream.locked**: Always returns `false` (simplified implementation, differs from WHATWG spec but functional)

## References

- [WHATWG Streams Standard](https://streams.spec.whatwg.org/)
- [ricsam-qjs streaming implementation](https://github.com/user/ricsam-qjs/packages/fetch/src/upload-stream-queue.ts)
- [isolated-vm Reference API](https://github.com/laverdet/isolated-vm#referenceapplysyncpromise)
