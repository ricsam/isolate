# @ricsam/isolate

## 0.1.27

### Patch Changes

- 766ec89: Republish the validated AbortSignal APIs for runtime evaluation, tests, and request handling.

## 0.1.26

### Patch Changes

- fix missing file error

## 0.1.25

### Patch Changes

- Hard-dispose app server runtimes before retrying after an underlying isolate disposal error.

## 0.1.24

### Patch Changes

- add persistent sessions + add cdp api

## 0.1.23

### Patch Changes

- add AbortController

## 0.1.22

### Patch Changes

- fix path traversal escape issue

## 0.1.21

### Patch Changes

- Recover app servers after daemon reconnects leave a runtime without a registered `serve()` handler.

## 0.1.20

### Patch Changes

- improve nested sandboxing

## 0.1.19

### Patch Changes

- Fix ECDH CryptoKey serialization in crypto bridge

## 0.1.18

### Patch Changes

- fix tdz issue with crypto

## 0.1.17

### Patch Changes

- expand crypto module

## 0.1.16

### Patch Changes

- fix lost proxy metadata

## 0.1.15

### Patch Changes

- fix reconnection

## 0.1.14

### Patch Changes

- sync-only event handlers

## 0.1.13

### Patch Changes

- improve test API

## 0.1.12

### Patch Changes

- add more APIs for namespaced runtimes

## 0.1.11

### Patch Changes

- enable nested isolate executions and improve the browser API

## 0.1.10

### Patch Changes

- make module loader resolve browser deps earlier

## 0.1.9

### Patch Changes

- fix some encoding issue

## 0.1.8

### Patch Changes

- add more logs

## 0.1.7

### Patch Changes

- add more logging and crash handling

## 0.1.6

### Patch Changes

- Expand node:async_hooks API
- Updated dependencies
  - @ricsam/isolated-vm@6.1.4

## 0.1.5

### Patch Changes

- update build script
- Updated dependencies
  - @ricsam/isolated-vm@6.1.3

## 0.1.4

### Patch Changes

- fix subpath imports

## 0.1.3

### Patch Changes

- fix the bundler (to support the remark stack)

## 0.1.2

### Patch Changes

- update module loading

## 0.1.1

### Patch Changes

- new repo structure
