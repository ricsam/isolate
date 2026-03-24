# 13-async-host-bridge.md - Node-Like Async Host Bridge Roadmap

## Goal

Make isolate behave much more like a Node.js runtime for long-lived server workloads:

- Replace blocking host bridges with fully async, message-based APIs
- Treat shell, fs, network, and tool calls as true async resources
- Allow one request to await host I/O without pinning the entire runtime
- Preserve streaming, cancellation, timers, and AbortController behavior while host work is in flight

This plan aims for **Node-like responsiveness**, not exact Node parity. The isolate will still run JavaScript on a single thread, but host-backed I/O should no longer monopolize that thread.

## Why This Work Is Needed

Today, several hot paths still rely on `applySyncPromise`, especially in `packages/runtime/src/index.ts`. That makes host-backed work effectively blocking from the isolate's point of view.

Current consequences:

- Long shell/fs/tool/fetch work can starve unrelated requests sharing the same runtime
- Timers and abort handling become less reliable during host-backed operations
- External fetch callback responses can still buffer instead of streaming incrementally
- `runtime.eval()` is constrained by `isolated-vm` `Module.evaluate()` not properly awaiting async `Reference.apply(...)`

## Target Runtime Model

We should treat host-backed operations the same way Node treats I/O:

- JavaScript inside the isolate stays single-threaded
- Host I/O runs outside that thread
- The isolate receives promise/stream completions asynchronously
- While one request is awaiting host work, other pending work can continue to make progress
- Abort, backpressure, and cleanup are first-class protocol concepts rather than afterthoughts

## Non-Goals

- Perfect Node.js API compatibility
- Reproducing libuv inside the isolate
- Keeping the current sync bridge as a long-term compatibility layer

Because this repo is greenfield, prefer replacing blocking patterns instead of carrying dual sync/async architectures indefinitely.

## Constraints To Design Around

### 1. `Module.evaluate()` is not enough

`isolated-vm` `Module.evaluate()` does not correctly await async `Reference.apply(...)` calls. That means the runtime cannot become async-first simply by swapping `applySyncPromise` for `Reference.apply(...)` everywhere.

The current best path is the approach described in [`packages/isolate-client/fetch-response-issues.md`](../packages/isolate-client/fetch-response-issues.md):

- keep imports at module scope
- wrap the executable body in an exported async function
- evaluate the module to define the function
- call the default export via async `Reference.apply(...)`

### 2. Streaming gaps already exist

The daemon/client protocol already has streaming machinery for some response paths, but external fetch callbacks still buffer entire bodies. We need one coherent async resource model rather than piecemeal streaming fixes.

### 3. Cancellation and cleanup are part of the architecture

If async resources are introduced without explicit lifecycle ownership, we will trade blocking bugs for leaked streams, leaked callbacks, orphaned requests, and reload/dispose races.

## Phases

### Phase 0: Define Semantics And Baselines

- [ ] Define the runtime contract for "Node-like" behavior
- [ ] Inventory every blocking bridge and classify it by API surface
- [ ] Add observability for "runtime pinned by host call" time, active async resources, and overlapping request latency
- [ ] Add benchmark/repro cases for:
  - one long host call plus concurrent request
  - streaming fetch passthrough
  - abort during long fetch/tool call
  - runtime dispose/reload while async work is active

Deliverable:

- a short architecture note that lists every remaining `applySyncPromise` dependency and the target async replacement

### Phase 1: Introduce Async Resource Primitives

- [ ] Define protocol-level concepts for async operations:
  - request/response correlation
  - stream/resource IDs
  - completion, error, abort, close, and disposal messages
- [ ] Add a host-side async resource registry with ownership per runtime/request
- [ ] Add isolate-side promise/stream proxies that resolve from protocol messages instead of blocking callbacks
- [ ] Decide and document backpressure behavior for streamed bodies
- [ ] Define timeout and abort propagation rules across all host-backed APIs

Deliverable:

- a reusable async bridge layer that shell/fs/network/custom functions can all share

### Phase 2: Make `runtime.eval()` Async-First

- [ ] Replace the current module-evaluation flow with the "imports + async default export" model
- [ ] Preserve import resolution and module scoping for imported bindings
- [ ] Ensure top-level async host calls work in `runtime.eval()`
- [ ] Add regression coverage for:
  - `await fetch(...)`
  - streamed response consumption
  - timers advancing while host work is pending
  - `AbortController` aborting host-backed operations
  - blob/file/stream-based response bodies that previously depended on blocking evaluation

Deliverable:

- `runtime.eval()` no longer depends on blocking host bridges for async behavior

### Phase 3: Replace Blocking Custom Function Bridges

- [ ] Rework callback, promise, and async iterator marshalling to resolve through the async bridge
- [ ] Replace `__customFn_invoke.applySyncPromise(...)` wrappers with async request/response handling
- [ ] Rework returned callback refs so isolate code can call host callbacks without pinning the runtime
- [ ] Rework promise refs and async iterator refs so `next()/return()/throw()` are truly async
- [ ] Decide whether any "sync custom function" surface should remain; if so, keep it explicitly limited to CPU-local work only

Deliverable:

- no `applySyncPromise` in the custom function hot path

### Phase 4: Make Fetch And Streaming Fully Async

- [ ] Unify fetch callback behavior with the async resource protocol
- [ ] Replace buffered external fetch callback responses with true streamed bodies
- [ ] Preserve `ReadableStream`, `tee()`, `pipeThrough()`, chunk timing, and incremental SSE delivery
- [ ] Ensure slow consumers apply backpressure instead of forcing full buffering
- [ ] Propagate aborts from isolate to host request and from host failure back into isolate streams
- [ ] Consolidate duplicate streaming paths between serve responses and callback fetch responses where practical

Deliverable:

- external LLM/API responses stream through the daemon/client path incrementally

### Phase 5: Move Fs, Shell, And Tooling Onto The Async Bridge

- [ ] Rework fs handlers to use async request/response lifecycles instead of blocking callbacks
- [ ] Rework shell/tool execution surfaces to behave like long-lived async resources
- [ ] Ensure large output can stream incrementally rather than requiring full buffering
- [ ] Add cancellation and ownership so disconnecting requests can terminate orphaned host work when appropriate
- [ ] Audit whether any "sync-looking" fs APIs should become explicitly async-only in this runtime model

Deliverable:

- long-running tool/fs/shell operations no longer starve unrelated runtime traffic

### Phase 6: Concurrency, Scheduling, And Lifecycle Hardening

- [ ] Validate overlapping request handling against the same runtime while host async work is in flight
- [ ] Ensure timers, microtasks, and abort callbacks still make progress during active host operations
- [ ] Harden reload/close/dispose behavior with active async resources
- [ ] Resolve stream-cancel and dispatch hang edge cases
- [ ] Add soak tests for concurrent requests, cancellations, and repeated runtime reuse

Deliverable:

- clear concurrency guarantees for a shared runtime under load

### Phase 7: Remove Legacy Blocking Paths And Document The Model

- [ ] Remove remaining `applySyncPromise` dependencies from request-serving code paths
- [ ] Update docs and examples to describe the async resource architecture
- [ ] Document which operations are now Node-like and which limitations remain due to `isolated-vm`
- [ ] Add a migration note for package consumers if any public surface changes were made
- [ ] Publish benchmark numbers comparing blocking vs async bridge behavior

Deliverable:

- async host bridging is the default architecture rather than an experimental side path

## Cross-Cutting Design Decisions

These decisions should be made early and reused across phases:

### Ownership

Every async resource should have an owner:

- runtime-owned
- request-owned
- stream-owned

This determines who is responsible for aborting and cleaning it up.

### Cancellation

Cancellation should propagate in both directions:

- isolate aborts host work
- host disconnect/error rejects isolate promises and closes isolate streams
- runtime dispose aborts all owned resources deterministically

### Backpressure

Backpressure must be explicit in the protocol. If the host can outproduce the isolate, we need bounded buffering and flow control instead of unbounded queues.

### Error Encoding

All async bridge errors should cross the boundary in a consistent encoded form so callbacks, promises, iterators, streams, and fetch all report failures the same way.

### Testing Strategy

Every new async bridge feature should have:

- local runtime tests
- daemon/client integration tests
- cancellation tests
- stream timing tests
- concurrency tests that prove one long host operation does not block unrelated work

## Suggested Implementation Order By Package

1. `packages/runtime`
2. `packages/isolate-protocol`
3. `packages/isolate-client`
4. `packages/isolate-daemon`
5. `packages/fetch`
6. `packages/fs`
7. any shell/tool integration surfaces that sit above runtime custom functions

This keeps the evaluation model and bridge primitives stable before reworking higher-level APIs.

## Success Criteria

We can call this initiative successful when all of the following are true:

- A request waiting on host fetch/fs/tool work does not prevent a second request from being served by the same runtime
- External fetch callback responses stream incrementally through the daemon/client stack
- Timers and `AbortController` continue to function while host-backed work is pending
- Async iterators and returned callbacks no longer depend on blocking bridge calls
- Runtime dispose/reload cleanly aborts or settles all owned async resources
- Request-serving hot paths no longer rely on `applySyncPromise`

## Open Questions

- All host-backed APIs become explicitly async?
- Should streaming protocol messages be unified across fetch, fs, shell, and tool output from day one, or staged behind a fetch-first implementation?
- Do we want per-runtime fairness scheduling, or is "host I/O yields, JS stays single-threaded" sufficient as a first milestone?
- Is any extra `isolated-vm` work or upstream contribution needed to reduce the `Module.evaluate()` constraint over time?
