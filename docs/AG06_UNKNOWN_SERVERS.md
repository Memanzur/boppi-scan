# AG-06: unknown and new tool handling

Roadmap row AG-06 (MASTER_FEATURE_INVENTORY.md). Decision context: D-15
(discover keeps refusing package-fetching launchers) and D-16.

## What

When a scan cannot recognize a server, Boppi now says what the configuration
itself shows about how that server starts. Each unrecognized record in
`recognition` gains an `analysis` object, built by `src/cli/launchAnalysis.js`:

- `via`: the launch form, such as `npx`, `bunx`, `pnpm dlx`, `pipx run`,
  `uv tool run`, `docker run`, a runtime script (`node script`), a runtime
  module or inline code, a program path, or a bare command name.
- `program` (local launches only): `form` (script, program, module, inline
  code), `location` (installed package folder, system folder, Downloads,
  temporary folder, hidden tool folder in home, home, elsewhere, relative, or
  looked up on PATH), `exists` (one `stat`, or `null` when Boppi cannot know
  the path), and `manifest`: the `name` and `version` from the nearest
  `package.json` for a Node script, when both pass a strict allow-list.
- `credentialEnvNames`: environment variable names that look like
  credentials. Names only; values are never read into the record.
- `basis: 'configured'`: every fact is read from the config or from local file
  metadata. Nothing is run, fetched, resolved on PATH, or contacted.

Terminal, HTML, SARIF and the interactive view print one sentence of these
facts under each unrecognized server, labeled as read from the config and
not run. The JSON export carries the `analysis` object.

The package launchers `bunx`, `pnpx`, `pnpm dlx`, `npm exec`, `yarn dlx`,
`bun x`, `pipx run` and `uv tool run` are now read as package launches, so
their pin state is graded. Before, they were reported as local programs with
no pin.

## Why

An unrecognized server used to show only "not in the catalog, no name rule
matched...". That tells the user Boppi failed, not what they are looking at.
The facts above are the questions a careful user asks next: does this fetch
new code on every launch, is the program sitting in Downloads or a temp
folder, does the file still exist, which package is it, and which secrets
does it get. All of them can be answered without executing anything, so they
stay inside D-15.

## Honesty rules applied

- Nothing here adds a capability, a permission, a graph edge, or an exposure
  path. The record stays `recognized: false`, so it still appears in the
  UNRECOGNIZED section, the coverage sentence, SARIF, and the
  `requireKnownCapabilities` policy. Grades do not change.
- The sentence says these facts do not tell what the server can do.
- The package.json `name`/`version` is reported as "package.json says", not
  as an identity. It is never matched against the catalog.
- No raw path leaves the scan: location is an enum, existence a boolean, the
  manifest fields pass an allow-list plus `isSecretShaped`, and env names go
  through the scanner's `sanitizeEnv`. Push is unchanged; it still sends only
  `recognized`, `pin` and `launcher`.

## Rejected or deferred

- **User label file.** Capability labels already exist: an overlay claim with
  human evidence adds a capability for a package launch. Extending overlays to
  local programs (`subjectKind: 'command'` is validated but never matched)
  would let a user claim reach on a server that today contributes none, which
  changes grades. That is a founder decision. A free-text note file was
  rejected: it gives the user a memo but gives Boppi no insight, and it is a
  new leak surface for push and exports.
- **Catalog matching through the new launchers.** `bunx @modelcontextprotocol/server-filesystem`
  stays unrecognized even though `npx` of the same package is in the catalog.
  Matching it would add catalog capabilities, so grades would change. Decision.
- **Registry metadata.** Needs the network. Out of scope for the scanner.
- **Reading the script source.** Static inspection was measured in research
  (Exp 2) and failed its precision rule.
- **Push fields.** The analysis enums would be additive on the ingest
  contract, but the control plane must accept them first. Deferred.
- **Broad directory args and remote transport.** Either one already makes a
  server recognized and graded, so an unrecognized server never has them.
