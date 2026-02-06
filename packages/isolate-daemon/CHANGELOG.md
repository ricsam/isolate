# @ricsam/isolate-daemon

## 0.1.15

### Patch Changes

- new isolate-server package
- e17d18d: Stabilize module linking and runtime lifecycle behavior across runtime, daemon, and client:

  - Runtime: remove recursive module instantiation from resolver, dedupe in-flight module compilation by content hash, clear partial resolver cache entries on failure, and serialize `eval()` per runtime.
  - Daemon: track poisoned namespaced runtimes and hard-delete them on dispose/connection close instead of returning them to the namespace pool.
  - Client: treat stale runtime dispose failures (`not owned`, `not found`, disconnected) as idempotent success.

  Also adds regression coverage for concurrent eval/linking behavior, poisoned namespace reuse, and stale dispose after reconnect.

- Updated dependencies
- Updated dependencies [e17d18d]
  - @ricsam/isolate-playwright@0.1.14
  - @ricsam/isolate-fs@0.1.13
  - @ricsam/isolate-protocol@0.1.14
  - @ricsam/isolate-runtime@0.1.16
  - @ricsam/isolate-test-environment@0.1.13
  - @ricsam/isolate-transform@0.1.3

## 0.1.14

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
  - @ricsam/isolate-fs@0.1.12
  - @ricsam/isolate-protocol@0.1.13
  - @ricsam/isolate-playwright@0.1.13
  - @ricsam/isolate-runtime@0.1.15
  - @ricsam/isolate-test-environment@0.1.12
  - @ricsam/isolate-transform@0.1.2

## 0.1.13

### Patch Changes

- remove baseUrl config option from playwright, that should be configured form the pw instance
- Updated dependencies
  - @ricsam/isolate-protocol@0.1.12
  - @ricsam/isolate-playwright@0.1.12
  - @ricsam/isolate-runtime@0.1.14

## 0.1.12

### Patch Changes

- add typescript support
- Updated dependencies
  - @ricsam/isolate-protocol@0.1.11
  - @ricsam/isolate-runtime@0.1.13
  - @ricsam/isolate-fs@0.1.11
  - @ricsam/isolate-playwright@0.1.11
  - @ricsam/isolate-test-environment@0.1.11
  - @ricsam/isolate-transform@0.1.1

## 0.1.11

### Patch Changes

- Public release
- Updated dependencies
  - @ricsam/isolate-fs@0.1.10
  - @ricsam/isolate-protocol@0.1.10
  - @ricsam/isolate-playwright@0.1.9
  - @ricsam/isolate-runtime@0.1.12
  - @ricsam/isolate-test-environment@0.1.10

## 0.1.10

### Patch Changes

- new console.log handling
- Updated dependencies
  - @ricsam/isolate-protocol@0.1.9
  - @ricsam/isolate-playwright@0.1.8
  - @ricsam/isolate-runtime@0.1.11

## 0.1.9

### Patch Changes

- fix streaming issue
- Updated dependencies
  - @ricsam/isolate-protocol@0.1.8

## 0.1.8

### Patch Changes

- target node when building
- Updated dependencies
  - @ricsam/isolate-fs@0.1.9
  - @ricsam/isolate-protocol@0.1.7
  - @ricsam/isolate-playwright@0.1.7
  - @ricsam/isolate-runtime@0.1.10
  - @ricsam/isolate-test-environment@0.1.9

## 0.1.7

### Patch Changes

- fix daemon cli export

## 0.1.6

### Patch Changes

- various updates
- Updated dependencies
  - @ricsam/isolate-fs@0.1.8
  - @ricsam/isolate-protocol@0.1.6
  - @ricsam/isolate-playwright@0.1.6
  - @ricsam/isolate-runtime@0.1.9
  - @ricsam/isolate-test-environment@0.1.8

## 0.1.5

### Patch Changes

- fix bugs
- Updated dependencies
  - @ricsam/isolate-protocol@0.1.5
  - @ricsam/isolate-playwright@0.1.5
  - @ricsam/isolate-fs@0.1.7
  - @ricsam/isolate-runtime@0.1.8
  - @ricsam/isolate-test-environment@0.1.7

## 0.1.4

### Patch Changes

- new version
- Updated dependencies
  - @ricsam/isolate-fs@0.1.6
  - @ricsam/isolate-protocol@0.1.4
  - @ricsam/isolate-playwright@0.1.4
  - @ricsam/isolate-runtime@0.1.7
  - @ricsam/isolate-test-environment@0.1.6

## 0.1.3

### Patch Changes

- add eval timeout and async iterator for custom functions
- Updated dependencies
  - @ricsam/isolate-protocol@0.1.3
  - @ricsam/isolate-runtime@0.1.6

## 0.1.2

### Patch Changes

- new API
- Updated dependencies
  - @ricsam/isolate-protocol@0.1.2
  - @ricsam/isolate-test-environment@0.1.5
  - @ricsam/isolate-playwright@0.1.3
  - @ricsam/isolate-runtime@0.1.5
  - @ricsam/isolate-fs@0.1.5

## 0.1.1

### Patch Changes

- new packages
- Updated dependencies
  - @ricsam/isolate-fs@0.1.4
  - @ricsam/isolate-protocol@0.1.1
  - @ricsam/isolate-playwright@0.1.2
  - @ricsam/isolate-runtime@0.1.4
  - @ricsam/isolate-test-environment@0.1.4
