# bb-plugin-beads

A [BB](https://getbb.app) plugin that integrates
[beads](https://beads.gascity.com) — the dependency-aware, Dolt-backed issue
tracker for AI coding agents (`bd` CLI) — into BB threads.

## What it adds

- **`beads` agent tool** — runs any `bd` command in the thread's environment
  checkout through the plugin's full-trust `bb.host` worker, so beads works
  on the machine the checkout lives on.
- **`bb beads` CLI** — `bb beads -- <bd-args...>` passthrough and
  `bb beads check` to verify the `bd` binary is reachable.
- **`beads` skill** — standing instructions injected into agent threads.

## Setup

1. Install the `bd` CLI on the BB host machine:
   `brew tap steveyegge/beads && brew install bd`
   (alternatives: install script or `go install` — see
   [Installation](https://beads.gascity.com/getting-started/installation)).
2. `bb plugin install .` from this directory.
3. `bb beads check` — should print `bd <version>`.
4. If `bd` is not on PATH, set its path with `bb plugin config beads`.

In a repo without beads yet, run `bb beads -- init --skip-agents
--non-interactive` (or ask the agent: `beads({ args: ["init", "--skip-agents",
"--non-interactive"] })`). Plain `bd init` also installs editor integrations
(Claude/Codex/Cursor) in the repo and user config.

## Structure

- `server.ts` — backend entry: agent tool, CLI command, settings.
- `host.ts` — `bb.host` worker that spawns `bd` (bounded output, timeouts).
- `skills/beads/SKILL.md` — agent instructions.

## Development

```
npx tsc --noEmit   # typecheck
bb plugin build    # build server + host bundles
bb plugin reload beads
```
