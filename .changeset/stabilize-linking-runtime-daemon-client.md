---
"@ricsam/isolate-runtime": patch
"@ricsam/isolate-daemon": patch
"@ricsam/isolate-client": patch
---

Stabilize module linking and runtime lifecycle behavior across runtime, daemon, and client:

- Runtime: remove recursive module instantiation from resolver, dedupe in-flight module compilation by content hash, clear partial resolver cache entries on failure, and serialize `eval()` per runtime.
- Daemon: track poisoned namespaced runtimes and hard-delete them on dispose/connection close instead of returning them to the namespace pool.
- Client: treat stale runtime dispose failures (`not owned`, `not found`, disconnected) as idempotent success.

Also adds regression coverage for concurrent eval/linking behavior, poisoned namespace reuse, and stale dispose after reconnect.
