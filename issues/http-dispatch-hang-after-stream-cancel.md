# Issue: HTTP Dispatch Can Hang After Stream Cancellation (Daemon Mode)

## Summary

In daemon mode, canceling a streaming response can leave daemon-side response pumping blocked indefinitely. After enough cancel/disconnect events, subsequent `dispatchRequest()` calls may hang, and runtime reload/restart operations can stall behind the same stuck lifecycle.

This presents as:
- new HTTP requests never reaching `serve()`
- no handler logs for those requests
- runtime still alive for other operations
- restart/reload commands timing out

## Impact

- Breaks reliability for SSE/streaming endpoints (LLM token streaming, long-polling, event streams).
- A single bad cancellation sequence can wedge HTTP request handling for a runtime.
- Operational recovery may require full process recycle instead of normal runtime reload.

## Symptoms Observed

1. Streaming endpoints work initially.
2. Repeated client disconnects/cancels during active streaming occur (e.g. browser/page closed mid-stream).
3. Later HTTP requests hang indefinitely.
4. `serve()`/route handler logs stop for those requests.
5. Non-HTTP runtime work can still appear alive.
6. Reload/restart can time out waiting for completion.

## Likely Root Cause

Daemon response streaming uses a credit-based loop:
- `/Users/richard.samuelsson/projects/isolate/packages/isolate-daemon/src/connection.ts` (`sendStreamedResponse`)
- waits in `waitForCredit(session)` while `session.credit < STREAM_CHUNK_SIZE`

On cancellation/error, `handleStreamError` marks session closed and deletes it:
- `/Users/richard.samuelsson/projects/isolate/packages/isolate-daemon/src/connection.ts`
- `session.state = "closed"; connection.activeStreams.delete(...)`

But if the sender is currently awaiting `waitForCredit(session)`, there is no resolver wake-up on this path. The pending promise can remain unresolved, leaving the response pump stuck.

## Ways To Reproduce

### Repro A: Daemon-level Stress (recommended, isolate-only)

1. Start isolate daemon and connect with `@ricsam/isolate-client`.
2. Create a runtime with a `serve()` handler containing:
   - `GET /stream`: returns an unbounded `ReadableStream` (chunks every ~5-20ms)
   - `GET /ping`: returns immediate `"ok"`
3. Loop 50-200 times:
   - `dispatchRequest("/stream")`
   - read 1-3 chunks from `response.body.getReader()`
   - call `reader.cancel("test cancel")` immediately
4. After the loop, call `dispatchRequest("/ping")`.

Expected:
- `/ping` always completes quickly.

Actual (intermittent, higher probability with more iterations/concurrency):
- `/ping` hangs or takes extremely long.

### Repro B: SSE client-disconnect pattern (app-like)

1. Expose an endpoint returning SSE (`text/event-stream`) backed by streaming model output.
2. Start multiple clients (Playwright/browser tabs) that:
   - begin streaming request
   - navigate away/close context mid-stream
3. Repeat rapidly for several minutes.
4. Send a fresh non-streaming HTTP request.

Expected:
- request reaches handler and returns.

Actual:
- request may hang and not reach handler logging.

### Repro C: Recovery behavior

After reproducing A or B:
1. Attempt runtime reload (`IsolateServer.reload()` or higher-level restart command).

Expected:
- reload completes.

Actual:
- reload may stall/time out, consistent with a stuck in-flight response path.

## Notes

There can also be app-side abort propagation issues in specific integrations (e.g. mapped requests dropping original signals), but isolate daemon should still guarantee that stream cancellation cannot deadlock request processing.

## Proposed Fix Direction

1. In daemon `handleStreamError` (and any equivalent close/cancel path), if a session has `creditResolver`, invoke it before cleanup.
2. Ensure response pump exits deterministically when session is closed/cancelled.
3. Add regression test:
   - cancel many streaming responses
   - assert subsequent `dispatchRequest()` still succeeds.
4. Optionally add defensive timeout/diagnostic logging around long-lived `sendStreamedResponse` loops.

## Acceptance Criteria

1. Repro A no longer hangs after repeated cancellations.
2. Repro B no longer wedges HTTP dispatch.
3. Reload/restart still works after cancellation stress.
4. No regression in normal streaming throughput/chunk ordering.
