# Streaming Test Hang Investigation

## Summary

The `streaming.test.ts` file hangs after all tests complete when run without the `--test-force-exit` flag. The tests pass successfully, but the Node.js process doesn't exit, eventually timing out with:

```
'Promise resolution is still pending but the event loop has already resolved'
```

## Root Cause

The hang is caused by running **3 or more tests that call `reader.cancel()`** on streaming responses within the same test file.

### Affected Tests

There are 3 tests in `streaming.test.ts` that use `reader.cancel()`:

1. **Line 375** - `"should allow partial consumption of SSE stream"` (SSE streaming section)
2. **Line 784** - `"should handle early cancel via reader"` (reader-based iteration section)
3. **Line 918** - `"should allow partial read and cancel"` (error handling section)

### Reproduction

Running any 2 of these tests together works fine:
```bash
# Works - exits cleanly
node --test --experimental-strip-types src/streaming.test.ts  # with 2 reader.cancel tests
```

Running all 3 together causes the hang:
```bash
# Hangs for ~30 seconds then times out
node --test --experimental-strip-types src/streaming.test.ts  # with 3 reader.cancel tests
```

### Isolated Reproduction

The issue can be reproduced with a minimal test file that runs the same `reader.cancel()` test 3 times:

```typescript
// This hangs
for (let i = 1; i <= 3; i++) {
  it(`reader cancel test ${i}`, async () => {
    const runtime = await client.createRuntime();
    try {
      await runtime.eval(`
        serve({
          fetch: () => {
            const stream = new ReadableStream({
              pull(controller) {
                controller.enqueue(new TextEncoder().encode("data"));
              }
            });
            return new Response(stream);
          }
        });
      `);
      const response = await runtime.fetch.dispatchRequest(new Request("http://localhost/"));
      const reader = response.body!.getReader();
      await reader.read();
      await reader.cancel("done");
    } finally {
      await runtime.dispose();
    }
  });
}
```

## Investigation Details

### What was ruled out

- **Test structure**: 26 tests with 9 nested describe blocks work fine with simple implementations
- **`assert.rejects()`**: Using `assert.rejects()` 3+ times doesn't cause the hang
- **Stream errors**: Running stream error tests (`controller.error()`) 3 times works fine
- **Before/after hooks**: The cleanup hooks complete successfully before the hang occurs
- **Active handles**: Only stdio sockets remain after cleanup (normal)

### Key observations

1. All tests pass and complete successfully
2. The `after()` hook runs and completes (`client.close()` and `daemon.close()` both finish)
3. The daemon stops properly ("Isolate daemon stopped" is logged)
4. The hang occurs after all explicit cleanup is done
5. The issue only manifests when running to a terminal (redirecting to a file works)

## Likely Cause

Something in the `reader.cancel()` flow creates a promise or callback that:
1. Is not properly cleaned up when the stream is cancelled
2. Accumulates with each cancelled stream
3. Eventually prevents the Node.js event loop from exiting

The issue is likely in `packages/isolate-client/src/connection.ts` in the stream response handling code, specifically around how stream cancellation is propagated and cleaned up.

## Current Workaround

The `--test-force-exit` flag in `package.json` forces the test runner to exit after tests complete:

```json
{
  "scripts": {
    "test": "node --test --experimental-strip-types --test-force-exit 'src/**/*.test.ts'"
  }
}
```

## Potential Fixes

1. **Keep `--test-force-exit`** - Simple workaround, tests pass correctly
2. **Skip one reader.cancel test** - Reduce to 2 tests that use reader.cancel
3. **Fix root cause** - Investigate stream cancellation handling in connection.ts to ensure all promises/callbacks are properly cleaned up when a reader is cancelled

## Files Involved

- `packages/isolate-client/src/streaming.test.ts` - Test file with the 3 reader.cancel tests
- `packages/isolate-client/src/connection.ts` - Client-side stream handling (likely location of root cause)
- `packages/isolate-client/package.json` - Contains the `--test-force-exit` workaround
