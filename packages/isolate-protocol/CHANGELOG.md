# @ricsam/isolate-protocol

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

## 0.1.12

### Patch Changes

- remove baseUrl config option from playwright, that should be configured form the pw instance

## 0.1.11

### Patch Changes

- add typescript support

## 0.1.10

### Patch Changes

- Public release

## 0.1.9

### Patch Changes

- new console.log handling

## 0.1.8

### Patch Changes

- fix streaming issue

## 0.1.7

### Patch Changes

- target node when building

## 0.1.6

### Patch Changes

- various updates

## 0.1.5

### Patch Changes

- fix bugs

## 0.1.4

### Patch Changes

- new version

## 0.1.3

### Patch Changes

- add eval timeout and async iterator for custom functions

## 0.1.2

### Patch Changes

- new API

## 0.1.1

### Patch Changes

- new packages
