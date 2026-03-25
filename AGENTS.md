# AGENTS.md

## Project Status

This repository is a greenfield library. Assume there are no backwards-compatibility requirements unless the user explicitly asks for them.

## Change Guidelines

- Refactors may change APIs, data shapes, file layouts, and behavior when that improves the design.
- Update in-repo callers, tests, and docs in the same change instead of adding compatibility layers.
- Do not add deprecation shims, migration wrappers, or versioned fallbacks unless they are explicitly requested.
