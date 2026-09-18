# Contributing

- Node 18 or newer.
- Run the test suites with `npm test`; all five must pass.
- The files under `src/engine/` are shared byte-for-byte with the Boppi control plane. Any change there needs a test in `test/`, and the same change has to land upstream or the sync check will flag it.

## Honesty rules

These apply to code, output text, and docs alike:

- Every claim in the report carries the evidence it came from. An inferred capability says what it was inferred from.
- Exposure paths are potential. The scanner sees configuration, not behavior, and the wording must never imply an attack happened.
- Sample or fixture data is always labeled as such.
- Do not claim this tool is the only one that can see something. Other tools discover local agents and MCP servers too.
