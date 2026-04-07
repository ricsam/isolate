# Nested Console CI Flake

## Scope

This note is only about the remaining nested console callback flake in the main test suite.

It is not about the separate vendored `isolated-vm` macOS/Node 24 instability.

## Current Status

- `origin/main` / `HEAD` is commit `d0556477363c39b94e79af1c548258a1e23cff82` (`fix tests`).
- That commit improved the original Linux CI failures, but did not fully eliminate them.
- The current uncommitted worktree only contains CI quarantine changes for vendored `isolated-vm` tests:
  - `.github/workflows/ci.yml`
  - `scripts/run-vendor-isolated-vm-tests.mjs`
- There are no uncommitted runtime-code experiments left in the worktree.

## Failing Run

Primary remaining failing run:

- Workflow: `publish`
- Run: <https://github.com/ricsam/isolate/actions/runs/24057179860>
- Job: <https://github.com/ricsam/isolate/actions/runs/24057179860/job/70165623453>
- Date: April 6-7, 2026
- Runner: Ubuntu 24.04 (`ubuntu-24.04`, image `20260329.72.1`)
- Node: `24.14.1`
- npm: `11.11.0`

Only failing test in that job:

- `src/host/integration.test.ts:1687`
- Test name: `delivers nested console entries back into the parent isolate`

Failure:

- Outer runtime times out after `20000ms`
- Timeout originates from `src/internal/runtime/index.ts:331` and `src/internal/runtime/index.ts:453`

## Earlier Related Run

Earlier Linux failure before `d055647`:

- Run: <https://github.com/ricsam/isolate/actions/runs/24055936490/job/70161934304>

That earlier run failed in both:

- `src/browser/integration.test.ts:778`
- `src/host/integration.test.ts:1602`

Those two cases passed after `d055647`.

## What `d055647` Changed

The partial fix in `d055647` added a non-reentrant best-effort event path and applied it in:

- `src/internal/event-callback.ts`
- `src/bridge/runtime-bindings.ts`
- `src/host/nested-host-controller.ts`

The intent was to defer async proxy event handlers to the next macrotask and avoid re-entering the parent isolate while nested work was still on the stack.

This appears to have fixed:

- nested browser event forwarding
- nested test lifecycle forwarding

but not the remaining nested console forwarding case.

## Remaining Symptom

In the failing `publish` job:

- the parent runtime is created
- the nested child runtime is created
- the nested console test then stalls until the outer runtime times out

Relevant test:

- `src/host/integration.test.ts:1687`

Key observation:

- unlike the earlier failures, this remaining failure does **not** log the usual async-handler warning before timing out
- specifically, the log does **not** show:
  - `bindings.console.onEntry handlers are sync-only and best-effort. Returned promises are ignored.`

That suggests the remaining hang is not simply "async handler returned a promise and we ignored it".
It looks more like a synchronous re-entrancy or callback-marshalling issue on the nested console path.

## Most Suspicious Remaining Path

The strongest remaining suspect is the client-side console callback registration path:

- `src/internal/client/connection.ts:1764`

That code registers child runtime `console.onEntry` callbacks and still uses the plain synchronous best-effort handler path in `d055647`.

This feels more likely than the already-patched runtime-bindings layer because the remaining failure is specifically about a nested child runtime console callback, not browser or test events.

## Reproduction Notes

The failure is flaky and CI-only so far.

Locally:

- the host integration suite passes on the committed runtime code from `d055647`
- the remaining failure has not been reproduced deterministically outside GitHub Actions

Useful local commands:

```sh
npm run typecheck
node --test --test-concurrency=1 --experimental-strip-types src/host/integration.test.ts --test-reporter tap --test-reporter-destination stdout
```

Likely useful stress command:

```sh
for i in {1..50}; do
  node --test --test-concurrency=1 --experimental-strip-types src/host/integration.test.ts --test-name-pattern='delivers nested console entries back into the parent isolate' --test-reporter tap --test-reporter-destination stdout || break
done
```

## Reverted Follow-up Experiments

These were tried locally after `d055647` and then reverted because they caused regressions.

### Experiment 1

Approach:

- tag all unmarshalled callback proxies in `src/internal/protocol/marshalValue.ts`
- treat tagged proxies as non-reentrant in `src/internal/event-callback.ts`

Result:

- fixed the flaky nested console test locally
- regressed `src/host/integration.test.ts:1915`
- failing test:
  - `supports isolate-authored bindings across nested app server reloads`

### Experiment 2

Approach:

- change only `src/internal/client/connection.ts:1764` so `registerConsoleCallbacks()` used `invokeBestEffortEventHandlerNonReentrant(...)`

Result:

- fixed the flaky nested console test locally
- regressed `src/host/integration.test.ts:1772`
- failing test:
  - `supports isolate-authored bindings in nested runtimes`

Conclusion:

- broad deferral and client-layer console deferral both fix the target flake
- both also break legitimate nested binding flows
- the eventual fix probably needs to be narrower than "defer all callback proxies" or "defer all client console callbacks"

## Suggested Investigation Angles

1. Compare the callback path for:
   - `src/host/integration.test.ts:1687`
   - `src/host/integration.test.ts:1772`
   - `src/host/integration.test.ts:1915`

2. Trace exactly where the child runtime `console.onEntry` callback is marshalled and invoked:
   - `src/internal/client/connection.ts`
   - `src/internal/runtime/index.ts`
   - `src/bridge/runtime-bindings.ts`
   - `src/host/nested-host-controller.ts`

3. Figure out why the remaining flaky path does not emit the async-handler warning in CI.

4. Check whether the problem is:
   - callback invocation timing
   - callback result marshalling
   - host-call context reuse
   - nested callback draining order
   - parent/child connection ownership during nested runtime eval

5. Look for a condition that distinguishes:
   - nested child console forwarding that should be deferred
   - isolate-authored nested bindings that must stay synchronous enough to avoid breaking tests at `1772` and `1915`

## Minimal Summary

`d055647` was a partial improvement, not a full fix.

The remaining CI failure is a flaky nested child `console.onEntry` forwarding hang on Ubuntu/Node 24 in GitHub Actions.
Naive "defer more callback proxies" follow-ups do fix that flake, but they regress other nested binding tests.
