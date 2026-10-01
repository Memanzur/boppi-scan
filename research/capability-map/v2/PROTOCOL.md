# Inspector V2 protocol

Written and committed before any V2 code exists and before any held-out label is produced. This file is the pre-registration. Changing the rule after seeing a result is not allowed; if the rule changes, V2 is void and the change is recorded here with a date.

## Question

Can deterministic static inspection give high-precision positive capability evidence for npm MCP packages while improving coverage over the regex catalog? Precision first. UNKNOWN is a valid answer. NOT OBSERVED never means safe.

## What V1 is and stays

Everything outside `v2/` is V1 and is frozen: `inspector.mjs`, `labels.json`, `benchmark.md`, `benchmark.json`, `claims.json`, `RESULTS.md`. V2 does not edit them. V2 reads V1's output only to produce the "correctly rejected" and "still wrong" comparisons on the development set.

## Split

`split.json`, created by a seeded script before V2 work started.

- Development set: the 50 packages V1 labeled. They are contaminated, because the V1 false-positive analysis that motivated V2 was done on them. V2 is implemented and tuned only against these.
- Held-out set: 40 packages drawn by seeded shuffle from the other 150, after removing any package that shares an npm scope with a development package or shares a name stem (name with `mcp`, `server`, and separators removed). No held-out package may be looked at by the implementer until V2 is frozen.
- Freeze: V2 is frozen by a commit tagged `inspector-v2-frozen`. The held-out evaluation runs exactly once against that commit. Any later V2 change is V2.1 and gets its own held-out draw.

## Labels

Held-out labels are produced by labelers who never run the inspector and never see its output, following `LABELING.md` from V1: one evidence line per positive category, `serverShape` per package, `unknown` allowed. Labelers are Claude agents. That weakness remains, so every held-out label ships with a review artifact (`v2/heldout-review.html`): per package, per label, the cited file and line with ten lines of surrounding source, a verdict column, and a place to record the reviewer's name. The reported numbers are "against labels pending human verification" until a human fills that in. Melody's verdicts, when recorded, override the labels and the benchmark is re-run against the corrected file; both numbers are kept.

## Three-state output

For every (package, category) V2 emits exactly one of:

- CONFIRMED: a call site resolved through a binding to a supported API (or an explicitly supported source), inside a file reachable from the package entrypoint, not inside a bundled dependency region, not classified internal housekeeping.
- NOT_OBSERVED: analysis completed with full coverage of reachable files and no such call site exists. This is not a safety claim.
- UNKNOWN: analysis could not be trusted. Causes are recorded per package: minified file on the reachable path, bundler-wrapped region, dynamic `require`/`import()` with a non-literal argument, native addon, code downloaded or spawned at runtime (`npx`, `uvx`, `curl`), unresolved entrypoint, unresolved import inside the package, Bun or other non-standard require rewriting.

A package with any UNKNOWN cause reports UNKNOWN for every category the cause could affect. Partial coverage is not NOT_OBSERVED.

## V2 scope, nothing else

1. Binding resolution. A method name counts only when its receiver resolves to an import or require of a supported module (`fs`, `fs/promises`, `node:fs`, `child_process`, `vm`, `http`, `https`, `net`, `worker_threads`, and the supported third-party modules in V1's signal table), including CommonJS-transpiled shapes (`fs_1.rmSync`, `(0, child_process_1.spawn)`), namespace imports, destructured bindings, and re-exports within the package. Global `fetch(`, `eval(`, `new Function(` count only as the bare global, never as a member.
2. Bundled dependency filtering. Regions produced by esbuild, webpack, rollup, tsup, or ncc inside the package's own files are detected by their wrapper shapes and banners and are not attributed to the package. A file that is entirely a bundle is UNKNOWN for the categories its content could affect, not NOT_OBSERVED. The detection rules and their limits are documented in `v2/RESULTS.md`.
3. Entrypoint reachability. Entry files are `bin` targets, `main`, `module`, and `exports` from `package.json`. Reachability follows static `require` and `import` with literal specifiers within the package. Files not reached are ignored. A non-literal specifier marks the importing file's package UNKNOWN. Packages without a resolvable entrypoint are UNKNOWN.
4. Server-only benchmark. Labelers assign `serverShape` independently of the inspector. Both the full scorable set and the confirmed-server subset are reported. No difficult server is removed from the subset to help the number.
5. Housekeeping distinction. A filesystem call whose target is a string literal or an expression rooted in `__dirname`, `import.meta`, `os.tmpdir()`, `os.homedir()` joined with the package's own name, or `process.cwd()` joined with a literal, is marked `scope: internal` and is not a CONFIRMED claim. A target that is a function parameter, a request argument, or anything else is `scope: external`. How many signals this touched and every misclassification it caused are reported. If the rule proves brittle on the development set it is dropped and that is reported.

Not built in V2: tool-handler reachability, interprocedural data flow, CodeQL, dynamic or sandboxed execution, any model, control-plane persistence, signed overlays, automatic claim promotion, customer data.

## Metrics

Computed by `v2/benchmark.mjs` against the held-out labels, once, from the frozen commit:

- precision and recall per category; micro precision and recall
- false positives and false negatives, each with a root-cause class
- UNKNOWN rate: packages with at least one UNKNOWN, and (package, category) cells UNKNOWN
- packages with actionable evidence (at least one CONFIRMED)
- coverage for the catalog, V1, and V2
- all of the above for all scorable packages and for the confirmed-server subset
- independent spot check: 20 CONFIRMED claims from the held-out run, chosen by seed, each verified against the artifact on disk, with "obviously invalid critical claim" meaning a run_shell_commands, execute_code, access_credentials, delete_files, or write_files claim whose cited line does not do that

Scoring a cell: CONFIRMED against a positive label is a true positive; CONFIRMED against a negative label is a false positive; NOT_OBSERVED against a positive label is a false negative; UNKNOWN is excluded from precision and recall and counted in the UNKNOWN rate. Recall is also reported with UNKNOWN counted as a miss, so UNKNOWN cannot hide misses.

## Decision rule, fixed now

V2 survives only if all six hold on the held-out set:

1. Micro precision on confirmed-server packages is at least 90 percent.
2. Micro recall improves by at least 15 percentage points over the regex catalog on the same packages, with UNKNOWN counted as a miss.
3. Zero obviously invalid critical capability claims in the 20-claim spot check.
4. Every CONFIRMED claim cites package, version, content hash, file, line, and matched text.
5. `src/` of the scanner gains no dependency and no network code (V2 lives under `research/`; nothing in `src/` changes).
6. UNKNOWN is emitted for every unanalyzable condition listed above rather than NOT_OBSERVED.

If precision fails, stop. No V3. Report which of tool-handler reachability, interprocedural data flow, dynamic analysis, sandbox execution, or vendor API semantics the remaining false positives and negatives would need, with an engineering estimate for each.

## Process order

1. Commit this file and `split.json`.
2. Labelers produce held-out labels and the review artifact without inspector access.
3. Implementer builds V2 against the development set only.
4. Freeze commit, tagged.
5. The held-out benchmark is run by someone other than the implementer, once.
6. Report.
