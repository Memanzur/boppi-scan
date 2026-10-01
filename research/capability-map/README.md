# Capability map research

Experiment 2 from `docs/research/LEARNING_EXPERIMENTS_PLAN.md`. Does static inspection of a published npm package find more of its capabilities than the regex catalog in `src/cli/knownServers.js`, at equal or better precision?

Everything here is research tooling. It may use the network and child processes. Nothing under `src/` gains network code or a dependency. Node 18 or newer, no npm installs.

Read `RESULTS.md` for the numbers and the verdict. `benchmark.md` is generated.

## Reproduce

All commands run from this directory.

### 2.1 Corpus

```
node build-corpus.mjs
```

Searches the npm registry for MCP server packages, filters, ranks by last-month downloads, packs the top 200 with `npm pack`, extracts them under `corpus/packages/<name>/<version>/`, and writes `corpus/index.json` with name, version, registry integrity (sha512 from the registry), a sha256 content hash over the extracted tree, a hash of the file list, and the pack date. Took 8 minutes on the recorded run.

Filtering, in order, each decision recorded in `corpus/excluded.json`:

1. Search noise. A result stays only if its name, description, or keywords mention mcp or model context protocol.
2. Tooling. Names matching sdk, inspector, registry, framework, template, boilerplate, starter, types, or any `@modelcontextprotocol/*` package that is not `server-*`, plus a short denylist of proxies and SDKs, are dropped.
3. Server shape. The package must declare a `bin` or depend on an MCP SDK (`@modelcontextprotocol/sdk`, `fastmcp`, `mcp-framework`, and a few others).

The remaining packages are ranked by `api.npmjs.org` last-month downloads and the top 200 are packed. Download counts are what npm reports and nothing more; some entries in the top of the ranking look inflated.

`corpus/out-of-scope-python.json` lists corpus packages that ship Python files or whose JavaScript spawns `uvx`, `python`, or `pip`. PyPI packages themselves never enter an npm corpus; that gap is recorded in RESULTS.md.

To reproduce the exact snapshot without re-querying search:

```
node build-corpus.mjs --from-index
```

This re-packs every `name@version` in `corpus/index.json` and exits non-zero if any content hash differs. Tarballs, extracted trees, and `corpus/files.json` are gitignored.

### 2.2 Inspector

```
node inspector.test.mjs      # fixture per signal
node inspector.mjs           # whole corpus, writes inspector-output.json
node inspector.mjs <dir>     # one extracted package, prints the result
```

The signal table is `SIGNALS` in `inspector.mjs`. Each row names modules, the call members that upgrade an import hit to a call hit, and whether a bare import suffices. General-purpose modules (fs, child_process, http, vm, worker_threads) need a call site. Hits in `node_modules`, `.d.ts`, tests, examples, and docs are skipped and the skips are recorded per package.

### 2.3 Catalog baseline

```
node catalog-baseline.mjs    # writes catalog-baseline.json
```

### 2.4 Labels

```
node sample-labels.mjs       # writes labels-sample.json, seed 20261001
```

Labeling follows `LABELING.md`. The labels were produced by reading sources before the inspector ran on the corpus and without access to the inspector's signal table. `labels.json` is marked `reviewer: "claude", humanReviewed: false`.

```
node merge-labels.mjs part1.json part2.json ...   # writes labels.json, verifies each evidence line against the file
```

### 2.5 Benchmark

```
node benchmark.mjs           # writes benchmark.json and benchmark.md
```

### 2.6 Claims

```
node claims.test.mjs         # schema and lifecycle rules
node build-claims.mjs        # writes claims.json from inspector-output.json
```

### 2.7 and 2.8 Overlay in the scanner

```
node ../../test/verify-overlay.js
```

Or `npm test` from the repository root. The scanner reads a claims file only when `--overlay <file>` is passed:

```
node ../../bin/boppi.js scan --overlay claims.json --json out.json
```

Validated claims add an inferred permission (confidence 0.7, reason citing the claim id and evidence line). Experimental claims appear under `diagnostics.shadow` in the JSON export and change nothing else. The default run never reads an overlay.

## Files

- `build-corpus.mjs`, `corpus/index.json`, `corpus/excluded.json`, `corpus/out-of-scope-python.json`
- `inspector.mjs`, `inspector.test.mjs`, `inspector-output.json`
- `catalog-baseline.mjs`, `catalog-baseline.json`
- `sample-labels.mjs`, `labels-sample.json`, `LABELING.md`, `merge-labels.mjs`, `labels.json`
- `benchmark.mjs`, `benchmark.json`, `benchmark.md`
- `claims-schema.mjs`, `claims.test.mjs`, `build-claims.mjs`, `claims.json`
- `RESULTS.md`
