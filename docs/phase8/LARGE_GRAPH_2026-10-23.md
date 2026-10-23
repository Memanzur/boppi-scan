# Large-graph traversal budget (Phase 8)

Measured 2026-10-23T03:21:57.816Z on Apple M1 (8 cores, arm64, Node v25.8.0). Reference command: `node scripts/large-graph-bench.js` with its defaults; synthetic inventory only.

## Budget

The exposure path engine bounds every search and now records when a bound was reached (`exposurePathEngine.analyze(graph).traversal`):

| Cap | Value | Scope | When reached |
| --- | --- | --- | --- |
| depth | 6 edges | per chain from an agent | `truncated[]` gains `{ cap: 'depth', agentId }`; longer chains were not examined |
| visited | 2000 edges followed to new nodes | per agent | `{ cap: 'visited', agentId }`; nodes beyond it were not examined |
| paths | 200 paths | per scan | `{ cap: 'paths', agentId }` for every agent that was not searched, plus one row with no agent when the cap fell inside an agent |

`traversal.complete` is true only when `truncated` is empty. `findPaths(graph)` is unchanged and returns `analyze(graph).paths`. A truncated search is still deterministic; a path it did not find is not evidence of absence, and the caller must show the truncation.

## Reference graph

| | |
| --- | --- |
| configuration | 22 agents, 15 MCP servers each with 20 capabilities, 10 permissions per agent, 0 tool nodes |
| nodes | 1153 |
| edges | 6002 |
| graph build | 47.2 ms |
| analyze p50 | 5.7 ms |
| analyze p95 | 7.5 ms (50 runs after 2 warm-ups) |
| analyze max | 8.5 ms |
| paths | 127 |
| complete | true |

The roadmap target is p95 under two seconds on a stated reference machine; this machine is about two hundred times under it. `test/verify-traversal-budget.js` fails if the reference graph drops below 1,000 nodes or 5,000 edges, is not complete, or exceeds the two-second p95; it also drives each cap on purpose (an agent with more edges than the visited cap, more satisfiable agents than the path cap, a chain longer than the depth cap) and checks the record names the cap, the limit, and the agent.

## Not measured

A real configuration with this many servers has not been scanned; the synthetic graph shares derived capability nodes per agent, which is how real graphs look, but its label distribution is uniform. Memory was not measured. The scan command's own time (reading files, building the inventory, rendering) is outside this number.

Raw report:

```json
{
  "at": "2026-10-23T03:21:57.816Z",
  "machine": {
    "cpu": "Apple M1",
    "cores": 8,
    "arch": "arm64",
    "platform": "darwin",
    "node": "v25.8.0"
  },
  "config": {
    "agents": 22,
    "servers": 15,
    "caps": 20,
    "perms": 10,
    "tools": 0,
    "runs": 50
  },
  "graph": {
    "nodes": 1153,
    "edges": 6002,
    "buildMs": 47.2
  },
  "analyzeMs": {
    "p50": 5.7,
    "p95": 7.5,
    "max": 8.5
  },
  "paths": 127,
  "traversal": {
    "budget": {
      "maxDepth": 6,
      "maxVisitedPerAgent": 2000,
      "maxPaths": 200
    },
    "agents": 22,
    "agentsSearched": 22,
    "truncated": [],
    "complete": true
  }
}
```
