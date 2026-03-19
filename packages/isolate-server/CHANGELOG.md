# @ricsam/isolate-server

## 0.2.8

### Patch Changes

- Updated dependencies
  - @ricsam/isolate-client@0.1.25

## 0.2.7

### Patch Changes

- Updated dependencies
  - @ricsam/isolate-client@0.1.24

## 0.2.6

### Patch Changes

- Updated dependencies
  - @ricsam/isolate-client@0.1.23

## 0.2.5

### Patch Changes

- Updated dependencies
  - @ricsam/isolate-client@0.1.22

## 0.2.4

### Patch Changes

- Updated dependencies
  - @ricsam/isolate-client@0.1.21

## 0.2.3

### Patch Changes

- update version handling
- Updated dependencies
  - @ricsam/isolate-client@0.1.20

## 0.2.2

### Patch Changes

- fix dispatch hang
- Updated dependencies
  - @ricsam/isolate-client@0.1.19

## 0.2.1

### Patch Changes

- new release
- Updated dependencies
  - @ricsam/isolate-client@0.1.17

## 0.2.0

### Minor Changes

- Add a new `@ricsam/isolate-server` package that provides a reusable lifecycle abstraction for namespaced runtimes:

  - `IsolateServer` with serialized `start()`, `reload()`, and `close()`
  - entry-module startup via synthetic import
  - auto-starting `fetch.*` proxy methods after initial configuration
  - linker-conflict retry and benign dispose handling

  Also update `@ricsam/isolate-client` to support runtime-level WebSocket command registration:

  - add `RuntimeOptions.onWebSocketCommand`
  - auto-register the callback during `createRuntime()`
  - export `isBenignDisposeError` for upstream lifecycle managers

### Patch Changes

- new isolate-server package
- Updated dependencies
- Updated dependencies
- Updated dependencies [e17d18d]
  - @ricsam/isolate-client@0.1.16

## 0.1.0

### Minor Changes

- Initial release with `IsolateServer` lifecycle abstraction:
  - Serialized `start`, `reload`, `close` lifecycle operations
  - Namespaced runtime startup with entry-module evaluation
  - Auto-starting `fetch.*` proxy methods after initial configuration
  - Linker-conflict self-heal with one retry
