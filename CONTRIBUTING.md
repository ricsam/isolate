# Contributing

## Public API Design Rules

When adding or evolving public APIs in this repository, follow these rules:

1. **One public core contract per feature**
   - Expose one stable options shape for a feature.
   - Avoid parallel public modes that represent the same capability.

2. **Convenience belongs in helpers**
   - Put ergonomic shortcuts in helper constructors/functions.
   - Keep runtime/client options focused on transport-agnostic behavior.

3. **Avoid mutually-exclusive mode fields**
   - Do not put competing mode selectors in one options object (for example, `page` vs `handler`).
   - Prefer a single field in core options, with helpers adapting host-specific inputs.

4. **Keep contracts expandable**
   - Add optional fields when extending behavior.
   - Avoid introducing unions that force callers into divergent code paths.

## Current Legacy Candidates (documented, not yet removed)

- `eval(code, filenameOrOptions)` overload:
  - Preferred API is `eval(code, { filename })`.
- `testEnvironment: boolean | object`:
  - Keep for compatibility for now; revisit in a future cleanup.
