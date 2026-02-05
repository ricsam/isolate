---
"@ricsam/isolate-client": patch
"@ricsam/isolate-daemon": patch
"@ricsam/isolate-playwright": patch
"@ricsam/isolate-protocol": patch
"@ricsam/isolate-runtime": patch
---

Finalize client/runtime parity refactor and tighten the Playwright public API to handler-first.

### Breaking changes

- `PlaywrightOptions` in the shared protocol/runtime/client contract is now handler-only:
  - keep: `handler`, `timeout?`, `console?`, `onEvent?`
  - remove from the public options object: `page`, `readFile`, `writeFile`, `createPage`, `createContext`
- Remove deprecated Playwright test protocol messages (`RUN_PLAYWRIGHT_TESTS`, `RESET_PLAYWRIGHT_TESTS`).

### Added and improved

- Add/standardize `defaultPlaywrightHandler(page, options?)` and metadata helpers for handler-first ergonomics.
- Daemon runtime creation and namespace reuse now rebind Playwright/test callbacks via mutable callback context.
- Runtime custom function marshalling parity improved for returned callbacks/promises/async iterators in standalone mode.
- `runTests(timeout)` timeout behavior aligned for direct runtime and daemon client.
- Add shared parity conformance tests that run identical scenarios against direct runtime and client+daemon adapters.
- Add API design guidance in `CONTRIBUTING.md` to keep public contracts tight and expandable.
