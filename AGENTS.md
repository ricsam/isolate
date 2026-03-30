# AGENTS.md

## Project Status

This repository is a greenfield library. Assume there are no backwards-compatibility requirements unless the user explicitly asks for them.

## Change Guidelines

- Refactors may change APIs, data shapes, file layouts, and behavior when that improves the design.
- Update in-repo callers, tests, and docs in the same change instead of adding compatibility layers.
- Do not add deprecation shims, migration wrappers, or versioned fallbacks unless they are explicitly requested.

## Security guidelines for isolated-vm
Through carelessness or misuse of the `isolated-vm` it can be possible to leak sensitive data or grant undesired privileges to an isolate.

At a minimum you should take care not to leak any instances of isolated-vm objects (Reference, ExternalCopy, etc) to untrusted code. It is usually trivial for an attacker to use these instances as a springboard back into the nodejs isolate which will yield complete control over a process.
