---
name: beads
description: "Manage the beads issue tracker (bd CLI) from BB threads and the shell."
---

# Beads

Beads (https://beads.gascity.com) is a dependency-aware issue tracker for AI
agents, stored in a Dolt database under `.beads/` in the repo. IDs are
collision-resistant hashes (`epic bd-a3f8` → `task bd-a3f8.1`), so multiple
agents/branches never clash. The `bd` CLI manages it.

## From agent threads

Call the `beads` tool with `bd` arguments. It runs in the thread's
environment checkout:

- `beads({ args: ["prime"] })` — AI-optimized workflow context; run this
  first in a session to get the protocol
- `beads({ args: ["list"] })` / `["show", "bd-a1b2"]` / `["ready"]`
- `beads({ args: ["create", "Summary", "-t", "task", "-p", "bd-a3f8"] })`
- `beads({ args: ["status", "bd-a1b2", "in_progress"] })` before starting,
  `["close", "bd-a1b2"]` when done

Many commands accept `--json` when you need to parse the result.

## From the shell

- `bb beads -- list` — run any `bd` command
- `bb beads check` — verify the `bd` binary is reachable
- `bb plugin config beads` — set the `bd` binary path if it is not on PATH
  (setting "Path to the `bd` beads CLI", default `bd`)

## Setup

`bd` must be installed on the BB host machine. In a repo without beads yet,
run `beads({ args: ["init", "--skip-agents", "--non-interactive"] })` once
(plain `init` also installs Claude/Codex/Cursor editor integrations).
