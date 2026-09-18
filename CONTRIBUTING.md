# Contributing

- Node 18 or newer.
- Run the test suites with `npm test`; all five must pass.
- The files under `src/engine/` are shared byte-for-byte with the Boppi control plane. Any change there needs a test in `test/`, and the same change has to land upstream or the sync check will flag it.

## Honesty rules

These apply to code, output text, and docs alike:

- Every claim is evidence-backed.
- Exposure paths are POTENTIAL, never attack claims.
- Sample data is always labeled as sample.
- Never market "nobody else can see local agents/MCP".
