# Labeling recipe for the 50 ground-truth packages

Labels record what an agent gains by having this package configured as an MCP server. They are produced by reading the package source, with one evidence line per label. They are produced before the inspector runs on these packages and without looking at any inspector output.

## Rules

1. Read only the extracted package under `corpus/packages/<name>/<version>/`. Prefer `src/` over `dist/` or `build/` when both exist, but cite the file you actually read. Skip `node_modules/` inside the tarball, test files, and `.d.ts` files.
2. Do not open `inspector.mjs`, `inspector-output.json`, `catalog-baseline.*`, `claims*`, `benchmark*`, or `src/cli/knownServers.js`. Do not run any script in `research/capability-map/`. Searching the package tree with grep is fine.
3. A capability counts when a tool handler, resource handler, or the server's request path performs the action, or when the package's own code hands the action to a dependency. It does not count for build scripts, tests, examples, or the server reading its own config or package.json at startup.
4. Be conservative. If you cannot point at a line, leave the category out and say why in `notes`.
5. Mark `unknown: true` when the shipped code is minified or bundled beyond reading, when no JavaScript or TypeScript source is present, or when the package is a wrapper that downloads or spawns something you cannot read. Add a note.
6. A package that is a client library, SDK, framework, or UI component rather than a server gets `serverShape` set accordingly and usually an empty category list. That is a valid label, not unknown.
7. Evidence is exact: `file` relative to the package root, `line` 1-based, `text` copied verbatim (trim whitespace, at most 200 characters).

## Categories and what each means here

- `read_files`: a tool reads files or lists directories on the host that the caller names or a configured root.
- `write_files`: a tool creates or modifies files on the host.
- `delete_files`: a tool deletes files or directories on the host.
- `run_shell_commands`: the request path spawns host processes (child_process, execa, and the like), including spawning a CLI such as git with controlled arguments.
- `execute_code`: the request path evaluates code supplied at runtime (eval, new Function, vm, a sandbox service, a code interpreter).
- `call_external_api`: the request path makes outbound network calls (HTTP clients, vendor SDKs, database drivers, websockets).
- `browser_automation`: the package drives a browser (puppeteer, playwright, CDP, selenium).
- `access_credentials`: the package reads a credential store or secrets manager (keytar, OS keychain, vault, cloud secret managers, password managers).
- `access_environment_variables`: the package reads `process.env` entries whose names contain key, token, secret, password, credential, or auth.
- `send_email`: a tool sends email.
- `send_external_message`: a tool posts messages to chat or messaging services (Slack, Discord, Teams, SMS).
- `untrusted_external_content`: a tool returns content an outside party controls (web pages, search results, scraped documents, inbound email, tickets written by the public).
- `read_email`, `read_calendar`, `modify_calendar`, `read_source_code`, `modify_source_code`, `access_customer_data`, `access_financial_data`, `access_production_system`, `create_or_modify_records`, `make_purchase`: use when the server's tools clearly do this through a vendor API, with the line that shows it.

## Output

One JSON file with this shape:

```
{
  "packages": [
    {
      "name": "<name>", "version": "<version>",
      "serverShape": "server" | "library" | "cli" | "wrapper" | "other",
      "unknown": false,
      "categories": [
        { "category": "run_shell_commands", "evidence": { "file": "dist/index.js", "line": 42, "text": "execSync(command)" }, "note": "optional" }
      ],
      "notes": "anything a reviewer should know"
    }
  ]
}
```
