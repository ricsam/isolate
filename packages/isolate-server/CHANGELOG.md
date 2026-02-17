# @ricsam/isolate-server

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
