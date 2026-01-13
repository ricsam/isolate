# Streaming Implementation Roadmap

## Goal

Implement true lazy streaming for Request and Response bodies in `@ricsam/isolate-fetch`, matching the WHATWG Streams API specification and the streaming capabilities in `ricsam-qjs`.

## Current State

- Bodies are fully buffered as `Uint8Array` before crossing the isolate boundary
- `ReadableStream` as body throws an error
- `FormData` with files only serializes string values (ignores files)
- No backpressure support

## Target State

- True lazy streaming with chunk-by-chunk data transfer
- Backpressure support (producer waits when consumer is slow)
- `ReadableStream` accepted as Request/Response body
- `FormData` with `File` objects serialized as `multipart/form-data`
- Multipart parsing reconstructs `File` objects

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
| [02](./02-host-backed-readable-stream.md) | Host-Backed ReadableStream | ReadableStream class backed by host state | 01 | Pending |
| [03](./03-upload-streaming.md) | Upload Streaming | Native → Isolate streaming for Request bodies | 01, 02 | Pending |
| [04](./04-download-streaming.md) | Download Streaming | Isolate → Native streaming for Response bodies | 01, 02 | Pending |
| [05](./05-multipart-formdata.md) | Multipart FormData | Parse and serialize multipart/form-data | 01-04 | Pending |
| [06](./06-streaming-tests.md) | Streaming Tests | Comprehensive test suite | 01-05 | Pending |

## Implementation Order

```
Phase 1: Foundation
├── 01-stream-state-registry.md     (Day 1)
└── 02-host-backed-readable-stream.md (Day 1-2)

Phase 2: Core Streaming
├── 03-upload-streaming.md          (Day 2-3)
└── 04-download-streaming.md        (Day 3-4)

Phase 3: Features
├── 05-multipart-formdata.md        (Day 4-5)
└── 06-streaming-tests.md           (Day 5-6)
```

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

## Success Criteria

1. **E2E Tests Pass**: `demo/e2e/files.e2e.ts` all green
2. **Streaming Tests Pass**: New streaming tests from ricsam-qjs port
3. **Memory Efficient**: 10MB file upload doesn't buffer entire file
4. **WHATWG Compliant**: `ReadableStream` API matches spec behavior

## Risk Mitigation

| Risk | Mitigation |
|------|------------|
| `applySyncPromise` deadlock | Timeout mechanism, clear error messages |
| Memory leaks in stream state | Cleanup on context dispose, WeakMap for state |
| Performance regression | Benchmark before/after, optimize hot paths |
| API incompatibility | Test against WHATWG test suite subset |

## References

- [WHATWG Streams Standard](https://streams.spec.whatwg.org/)
- [ricsam-qjs streaming implementation](https://github.com/user/ricsam-qjs/packages/fetch/src/upload-stream-queue.ts)
- [isolated-vm Reference API](https://github.com/laverdet/isolated-vm#referenceapplysyncpromise)
