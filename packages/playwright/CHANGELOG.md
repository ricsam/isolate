# @ricsam/isolate-playwright

## 0.1.15

### Patch Changes

- new release
- Updated dependencies
  - @ricsam/isolate-protocol@0.1.15

## 0.1.14

### Patch Changes

- new isolate-server package
- Updated dependencies
  - @ricsam/isolate-protocol@0.1.14

## 0.1.13

### Patch Changes

- new version
- 1369fd1: Finalize client/runtime parity refactor and tighten the Playwright public API to handler-first.

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

- Updated dependencies
- Updated dependencies [1369fd1]
  - @ricsam/isolate-protocol@0.1.13

## 0.1.12

### Patch Changes

- remove baseUrl config option from playwright, that should be configured form the pw instance
- Updated dependencies
  - @ricsam/isolate-protocol@0.1.12

## 0.1.11

### Patch Changes

- add typescript support
- Updated dependencies
  - @ricsam/isolate-protocol@0.1.11

## 0.1.10

### Patch Changes

- fix page.evaluate

## 0.1.9

### Patch Changes

- Public release
- Updated dependencies
  - @ricsam/isolate-protocol@0.1.10

## 0.1.8

### Patch Changes

- new console.log handling
- Updated dependencies
  - @ricsam/isolate-protocol@0.1.9

## 0.1.7

### Patch Changes

- target node when building
- Updated dependencies
  - @ricsam/isolate-protocol@0.1.7

## 0.1.6

### Patch Changes

- various updates
- Updated dependencies
  - @ricsam/isolate-protocol@0.1.6

## 0.1.5

### Patch Changes

- fix bugs
- Updated dependencies
  - @ricsam/isolate-protocol@0.1.5

## 0.1.4

### Patch Changes

- new version
- Updated dependencies
  - @ricsam/isolate-protocol@0.1.4

## 0.1.3

### Patch Changes

- new API
- Updated dependencies
  - @ricsam/isolate-protocol@0.1.2

## 0.1.2

### Patch Changes

- new packages

## 0.1.1

### Patch Changes

- add playwright package
