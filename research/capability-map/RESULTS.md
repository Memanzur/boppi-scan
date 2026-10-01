# Experiment 2 results: does inspection beat the regex catalog?

Run on 2026-10-01 against a corpus of 200 npm packages. Everything below is reproducible from the commands in README.md. Numbers come from `benchmark.json`; the verdict applies the decision rule fixed in `LEARNING_EXPERIMENTS_PLAN.md` before any code ran.

## Corpus

200 packages, 0 pack failures, built in 8 minutes 14 seconds. 3,399 search results, 2,990 with an MCP marker, 400 shortlisted by search download count, 491 excluded by the recorded rules, the top 200 remaining by `api.npmjs.org` last-month downloads packed. Smallest download count in the corpus is 49,992 per month. The extracted trees total 2.4 GB; 78 of 200 packages ship at least one minified file; 29,216 files were skipped by the inspector's rules (node_modules, declarations, tests, examples, docs) with the skip reasons recorded per package.

The ranking is noisy. Several entries at the top of the download order are not servers at all (`claude-cup`, `agent-install`, `@copilotkit/aimock`). The server-shape filter (declares a `bin` or depends on an MCP SDK) does not separate servers from client libraries, frameworks, and CLIs that happen to depend on the SDK. In the labeled sample 13 of 50 are libraries, 2 are CLIs, 2 are content or mock packages, and 33 are servers. That matters for the result below.

## Headline numbers

47 of 50 labeled packages are scorable; 3 are unknown because the shipped code is minified beyond reading (`nx-mcp`, `task-master-ai`, `@sap-ux/fiori-mcp-server`). Rates are percentages, micro averaged over every (package, category) decision across the 22 categories that appear in labels or in either tool's output.

| tool | precision | recall | FP rate | FN rate | coverage (packages with at least one category) |
|---|---|---|---|---|---|
| catalog | 87.5 | 5.1 | 0.1 | 94.9 | 5 of 47 (10.6%) |
| inspector | 47.6 | 64.7 | 10.8 | 35.3 | 38 of 47 (80.9%) |

Over the full corpus the catalog matches 29 of 200 packages and the inspector emits at least one category for 168 of 200.

Per category, the inspector reaches 100% recall on read_files, write_files, delete_files, run_shell_commands and execute_code, 86% on call_external_api, 94% on access_environment_variables, 20% on access_credentials, and 0% on browser_automation. The catalog's only recall comes from name matches on `desktop-commander` (shell), `chrome-devtools-mcp` (browser), and seven "connector" names.

## Verdict under the decision rule

The rule: the inspector wins only if recall improves by at least 15 points at equal or better precision, and the hand review finds it wrong on at most 5 of 50 packages.

- Recall gain: +59.6 points. Passes.
- Precision: 47.6 against 87.5. Fails.
- Packages where the inspector emitted at least one false positive: 36 of 47. Fails.

**The inspector does not win. The capability map stays a hand-curated catalog.** The result is a failure of the pre-registered test, and it is documented as such.

## Why the inspector is wrong, from reading its 97 false positives

False positives by category: delete_files 22, read_files 18, write_files 18, execute_code 14, call_external_api 10, access_environment_variables 8, run_shell_commands 7. Reading the cited lines, they fall into five causes.

1. **The package is not a server.** 12 of the 36 packages with a false positive are libraries, CLIs, or content packages. The code the inspector found is real (`@clerk/mcp-tools` has a file-backed session store, `agent-install` writes config files, `eve` is an agent framework), but no agent gains those capabilities by configuring the package as a server. A static signal scan cannot tell this. Restricting to the 30 labeled servers raises inspector precision to 63.8 at the same recall, which is still below the catalog's 87.5, and 24 of the 30 servers still carry a false positive.

2. **Call matching is not tied to the imported binding.** The member regex matches any `exec(`, `remove(`, `unlink(` or `get(` in a file that imports the module. `regex.exec(val)` became run_shell_commands in `@hasna/files`. A `remove(_edit, _shift, ...)` method on a hash map became delete_files in `@foldkit/devtools-mcp`. The word `unlink (` inside a tool description string became delete_files in `@azure-devops/mcp`. This is the one cause that is purely an inspector defect and fixable: resolve the binding (`const fs = require('fs')`, `import * as fs from`, `(0, fs_1.rmSync)`) and only count calls through it.

3. **Dependencies bundled into the package's own dist.** ajv's `new Function` validator generator appears inside `@foldkit/devtools-mcp`, `@hasna/conversations`, `@cloudbase/cloudbase-mcp` and others and became execute_code. A `new Function("")` feature probe in `@mcp-ui/client` did the same. Vendored libavoid in `@drawio/mcp` too. These are not in `node_modules/`, so the skip rule does not catch them.

4. **The server's own housekeeping.** Reading a token cache (`@azure-devops/mcp`), an SSH config (`@bytebase/dbhub`), `/proc/1/cgroup` (`@letoribo/mcp-graphql-enhanced`), its own bundled HTML (`@n8n/mcp-apps`), or deleting its own temp file (`@drawio/mcp`, `@hasna/mementos`) are file operations that do not give the agent a file capability. The labeling recipe excludes these on purpose; the inspector has no notion of a tool path.

5. **Install and setup code shipped in the same tarball.** `dist/install.js` in `@foldkit/devtools-mcp` writes the user's MCP config; the setup CLI in `@productbrain/mcp` does the same. Same tarball, never on a request path.

Causes 2, 3 and 5 are addressable with more static analysis (binding resolution, a bundled-dependency allowlist, entry-point reachability from the `bin`). Causes 1 and 4 need something the tarball does not contain: whether a tool handler reaches the call. That is a reachability analysis from the MCP SDK's `server.tool(...)` or `setRequestHandler(...)` registrations, which is a real project and not a regex table.

## Why the inspector misses, from its 48 false negatives

33 of 48 misses are in categories the signal table never emits: create_or_modify_records (10), untrusted_external_content (10), access_customer_data (3), make_purchase (2), read_email, send_email, read_calendar, modify_calendar, read_source_code, modify_source_code, access_financial_data, access_production_system. These are vendor-API semantics. The labelers assigned them by reading what a tool does with the HubSpot, Microsoft Graph, Hostinger, Shopify or Azure DevOps API. A module import cannot carry that meaning. The catalog cannot either; it only ever says call_external_api.

The remaining 15 misses have concrete causes:

- **Bundled dependencies hide imports.** `chrome-devtools-mcp` inlines puppeteer into a 68,000-line `third_party/index.js`, so no `puppeteer-core` import exists to match. `claude-flow` drives a browser by spawning `npx agent-browser`.
- **The capability lives in a sibling package not in the tarball.** `@transcend-io/mcp` and `@transcend-io/mcp-server-assessment` call the API through `@transcend-io/mcp-server-base`. `@ericthered926/duckduckgo-mcp-server` fetches through `duck-duck-scrape`. The `dependencies` field names them, and a dependency-level catalog could cover the common ones.
- **Credential access through a CLI or an auth library.** The `@hasna/*` packages read the macOS Keychain by spawning `/usr/bin/security`; `@azure-devops/mcp` uses MSAL's OS broker. Neither is in the credential-store module list.
- **Bun bundles rewrite requires.** `__require("fs")` and `Bun.spawnSync` are not matched by the import or member regexes.

## Compositional knowledge

The claim under test: learned knowledge is only ever about components (package to capability), and the deterministic engine composes it into exposures.

Unit 2.8 holds. Two made-up package names the catalog does not match, an overlay with a validated read_files claim for one and a validated call_external_api claim for the other, and the scan produces an EP-A exposure path. The path's `evidence` array cites both claim ids (`overlay-claim:claim-ledger-read`, `overlay-claim:claim-relay-api`), every edge on the path is `evidenceClass: inferred`, an experimental claim in the same overlay stays in `diagnostics.shadow`, and the path id is identical across runs. `git diff 976b79a -- src/engine` is empty. The overlay touched `src/cli/overlay.js` (new), `src/cli/provider.js` (one permission builder and a parameter) and `src/cli/boppi.js` (argument parsing, matching, and the diagnostics block). The graph, path templates, risk rules and root-cause engine composed the two permissions the same way they compose catalog-inferred ones.

The mechanism is ordinary: a validated claim becomes a permission record with a distinct `source.id`, and the path engine already collects edge sources as path evidence. Nothing in the engine knows a claim exists. That is the separation the architecture asks for, and it costs no engine code.

What this does not show: that validated claims would be correct. The benchmark says a claim set built from this inspector alone would be wrong on most packages, and the lifecycle rules in `claims-schema.mjs` keep every one of the 717 claims at `experimental` until a second independent evidence kind exists. No claim in `claims.json` is validated, so the scanner would apply none of them today.

## Claims

717 claims from 168 packages, all `experimental` (one inspector evidence kind, no human approval, no shadow observations). Each carries the file, line and matched text for up to 20 evidence hits, the package name and version, the registry sha512, the content sha256 over the extracted tree, and the inspection timestamp. `spot-check-claims.mjs` re-verifies 20 of them against the extracted files: 20 of 20 match. Schema rules enforced by test: no evidence means invalid; inspector evidence without file, line, text and both hashes means invalid; a claim whose evidence is only `llm` cannot carry any status beyond candidate; deprecated returns to experimental, never to validated.

## Overlay distribution

Three options were to be evaluated.

**Bundled data file in the npm release.** The overlay ships inside the `boppi` package and is read only when `--overlay` names it (or a future `--overlay default`). Pros: no fetch ever, the file is signed by the same npm provenance as the code, the user can read it in `node_modules`. Cons: knowledge updates ride the scanner's release cadence, and a scanner version pins a claim set that will drift from the packages it describes.

**Separate npm package (`boppi-knowledge`).** Versioned independently, installed by the user, located by `require.resolve`. Pros: knowledge updates without a scanner release, same provenance story as the scanner, still no runtime fetch. Cons: two packages to keep compatible (`engineVersionMin` already exists for this), and an optional peer dependency is a weak contract.

**Signed JSON fetched by `boppi update-knowledge`.** An explicit command fetches a signed overlay to a local cache; the scan reads the cache. Pros: freshest knowledge, revocation possible. Cons: this adds network code and a signature verifier to the scanner, which the plan forbids for the default run and which widens the attack surface the threat model lists first. A signed file still needs key distribution, and the scanner has no dependencies to lean on for it.

**Recommendation: the separate npm package, with the bundled file as the fallback until the first claim is validated.** The scanner stays free of network code and a verifier, the overlay keeps npm's existing provenance and integrity, and knowledge can move faster than the engine. Today there is nothing to distribute: zero validated claims. When there are, the first release should bundle them (option one) because an empty `boppi-knowledge` package is not worth a second install step, and the split happens when the overlay changes more often than the scanner does.

## Everything weak or unverified

- **Labels are not human reviewed.** `labels.json` is marked `reviewer: claude, humanReviewed: false`. Each of the 136 evidence lines was verified mechanically against the file on disk, but the judgment of whether a line sits on a tool path is the labelers'. The labelers flagged their own borderline calls in `notes` (a fixed `open <url>` on an OAuth path as run_shell_commands in two packages, access_credentials via a Keychain hand-off in the `@hasna/*` packages, chrome-devtools' `evaluate_script` as execute_code).
- **Labels were produced by five parallel agents** from one recipe. Consistency between them was not measured. A single reviewer would likely shift a handful of labels, most plausibly on access_environment_variables and untrusted_external_content.
- **The access_environment_variables definition** follows the plan (reads of `process.env` names containing key, token, secret, password) and is near-universal among servers. It inflates both tools' agreement on something that does not describe an agent capability so much as a server's configuration. The category should probably be dropped from the capability map or redefined.
- **Secondary breakdowns are post hoc.** The servers-only and call-strength-only tables were added after the primary numbers were seen and must not be read as a passing result under any rule.
- **Python is skipped.** No PyPI package can enter an npm search corpus. `corpus/out-of-scope-python.json` lists 39 corpus packages that mention `uvx`, `python` or `pip` in their JavaScript or ship `.py` files; that heuristic over-matches (it flags `desktop-commander` for a string) and is a pointer, not a classification. The Python half of the MCP ecosystem is unmeasured.
- **Minified and bundled code.** 78 of 200 packages ship minified files. The inspector scans them anyway, which produces both the bundled-dependency false positives above and the inlined-puppeteer miss. Three labeled packages were unreadable by a human and are excluded from scoring; the inspector emitted categories for all three.
- **Download ranking is npm's number.** Some counts in the top 20 look inflated and at least four top-ranked packages are not servers. The corpus is "what npm says people download", not "what people configure as MCP servers".
- **The server-shape filter is weak.** 17 of the 50 sampled packages are not servers. A better filter would check for an SDK server-construction call or a `bin` that starts a stdio transport.
- **Catalog precision rests on 8 predictions.** 7 true positives and 1 false positive over 47 packages. The catalog's 87.5 is a small-sample number; a different seed could move it by 10 points either way.
- **The corpus snapshot depends on npm staying immutable.** `--from-index` re-packs by exact version and checks content hashes; if a version is unpublished the snapshot cannot be rebuilt. The tarballs are not in git (632 MB).
- **Claims key on name plus exact version.** The overlay matcher skips a claim when the config pins a different major version, and ignores the version when the config does not pin one, which is the common case. A claim about `pkg@1.0.0` will be applied to whatever `npx -y pkg` resolves to today.
- **No shadow observations exist.** The validated tier requires 10 observations across 3 collectors or human approval plus inspector agreement. Neither has happened, so the overlay path has only been exercised with hand-written validated claims in the test fixture.

## What would change the verdict

The pre-registered rule failed on precision, not recall. The next iteration, if any, is a different inspector rather than a tuned regex table: resolve import bindings before counting calls, skip code unreachable from the `bin` entry, treat known bundled validators and polyfills as noise, consult `dependencies` for the well-known SDK and scraping libraries, and above all find the `server.tool(...)` registrations and trace from the handler. Then relabel a fresh seeded sample of 50 that nobody tuned against, and run the same rule. Until then the catalog stands, and the 717 experimental claims are a work list for human review, not knowledge.
