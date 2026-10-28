---
"@ricsam/isolate": minor
---

Serve disk-backed files without buffering them in the isolate. `getFile()` returns lazy, disk-backed files when file bindings provide `stat()` and the new `readFileStream()`. Returning such a file, or a slice of it, in a `Response` streams the bytes from the host that owns the disk, without copying them into the isolate or through the daemon. The new sandbox `serveFile()` helper handles HEAD and single byte ranges (206/416). `createFileBindings()` now also rejects symlink escapes and swaps, reports a snapshot `version`, and makes reads fail with `NotReadableError` when a file changes after it was opened.
