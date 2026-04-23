# @clawdi-cloud/cli

iCloud for AI Agents. One CLI to sync sessions, skills, memory, and vault secrets across Claude Code, Codex, OpenClaw, and Hermes — with an MCP server on the other end of the pipe.

## Requirements

- **Bun ≥ 1.1** (required; the Hermes adapter uses `bun:sqlite`)
- At least one supported agent installed on the machine (detected automatically)

## Install

Clawdi CLI runs on Bun — it uses `bun:sqlite` for the Hermes adapter and
won't work under plain Node.js. If you don't have Bun yet, grab it from
[bun.sh](https://bun.sh) first.

```bash
bun add -g @clawdi-cloud/cli
```

Installing with `npm i -g @clawdi-cloud/cli` will fail to run on machines
without Bun on `$PATH` — the shipped `bin/clawdi.mjs` uses a
`#!/usr/bin/env bun` shebang. Use Bun to install globally.

## Commands

| Command | What it does |
| --- | --- |
| `clawdi auth login` / `logout` | Authenticate with the Clawdi Cloud backend |
| `clawdi status [--json]` | Show auth + sync state |
| `clawdi config list/get/set/unset` | Manage `~/.clawdi/config.json` |
| `clawdi setup [--agent <type>] [-y]` | Detect installed agents, register this machine, install built-in skill, wire up MCP |
| `clawdi push [--modules --since --project --all --agent --dry-run]` | Upload sessions / skills to the cloud |
| `clawdi pull [--modules --agent --dry-run]` | Download cloud skills to registered agents |
| `clawdi skill list [--json]` | List synced skills |
| `clawdi skill add <path> [-y]` | Upload a skill directory or single `.md` file (prompted preview) |
| `clawdi skill install <repo> [-a --agent] [-l --list] [-y]` | Install a GitHub skill into cloud and one or more agents |
| `clawdi skill rm <key>` | Remove a cloud skill |
| `clawdi skill init [name]` | Scaffold a new `SKILL.md` template |
| `clawdi memory list [--json --limit --category --since]` | List memories |
| `clawdi memory search <query> [--json --limit --category --since]` | Search memories by text |
| `clawdi memory add <content>` / `rm <id>` | Add or delete a memory |
| `clawdi vault set <key>` / `list [--json]` / `import <file>` | Manage secrets |
| `clawdi run -- <cmd>` | Run a command with vault secrets injected into env |
| `clawdi doctor [--json]` | Diagnose auth, agent paths, vault, MCP connectivity |
| `clawdi update [--json]` | Check for a newer CLI version |
| `clawdi mcp` | Start MCP server (stdio transport, for agents) |

Run any command with `--help` to see its flags and real examples.

## Environment variables

| Variable | Purpose |
| --- | --- |
| `CLAWDI_API_URL` | Override the backend endpoint (defaults to `http://localhost:8000`) |
| `CLAWDI_DEBUG` | Print stack traces on errors |
| `CLAWDI_NO_UPDATE_CHECK` | Suppress the non-blocking update check |
| `CLAUDE_CONFIG_DIR` | Custom home for the Claude Code adapter (instead of `~/.claude`) |
| `CODEX_HOME` | Custom home for the Codex adapter (instead of `~/.codex`) |
| `HERMES_HOME` | Custom home for the Hermes adapter (instead of `~/.hermes`) |
| `OPENCLAW_STATE_DIR` | Custom OpenClaw state directory |
| `OPENCLAW_AGENT_ID` | Target a specific OpenClaw agent (default `main`) |
| `CI`, `GITHUB_ACTIONS`, `GITLAB_CI`, `CIRCLECI`, `TRAVIS`, `BUILDKITE`, `JENKINS_URL`, `TEAMCITY_VERSION` | Detected as CI; interactive prompts are disabled |

## Local state

Everything clawdi writes lives under `~/.clawdi/`:

```
~/.clawdi/
├── config.json        user config (apiUrl)
├── auth.json          API key (mode 0600)
├── sync.json          per-module last-synced timestamps
├── environments/      one file per registered agent
└── update.json        cached npm registry lookup
```

Corrupted `sync.json` is tolerated with a warning, not a crash.

## Troubleshooting

```bash
clawdi doctor         # a single-shot diagnostic
```

It verifies auth, API reachability, each known agent's install path, vault resolution, and MCP connector config — with actionable hints on every failing check.

## Development

```bash
bun install
bun run packages/cli/src/index.ts --help    # run from source
bun run --cwd packages/cli typecheck         # tsc
bun run --cwd packages/cli test              # bun test
bun run --cwd packages/cli build             # produce dist/
```

