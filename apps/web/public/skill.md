---
name: clawdi-setup
description: "Set up Clawdi Cloud CLI for the current user. Follow these steps exactly — onboarding is not done until this user's local sessions are visible in the dashboard."
---

# Clawdi Cloud Setup

Help the user connect to Clawdi Cloud. The end state of onboarding is the user's local agent sessions appearing in the Clawdi Cloud dashboard. **Do not skip Step 4. Do not declare onboarding complete before sessions have been uploaded** (or the user has explicitly chosen to skip Step 4).

## Step 1: Install CLI

```bash
bun add -g clawdi
```

If bun is not available:

```bash
npm install -g clawdi
```

## Step 2: Log in (two phases)

This is a two-phase flow so the agent never blocks waiting on the user.

**Phase 2a — start authorization:**

```bash
clawdi auth login
```

The command prints a **verification URL** and a short **user code**, then exits. Show both to the user in chat and ask them to:

1. Open the URL.
2. Confirm the code matches.
3. Click approve.
4. Reply "done" here when finished — wait for that reply before Phase 2b.

**Phase 2b — after the user replies:**

```bash
clawdi auth complete
```

If this exits with **"Still waiting for approval"** (exit code 2), the user hasn't approved yet — ask them to finish in the browser, then re-run `clawdi auth complete`. The 10-minute window starts at Phase 2a; if it expires, restart from Phase 2a.

Do **not** pass `--manual` — it requires a TTY and will fail in agent sessions.

## Step 3: Register agents on this machine

```bash
clawdi setup
```

This auto-detects every installed agent (Claude Code, Codex, Hermes, OpenClaw), registers each with the cloud, installs the MCP server, and drops the bundled `clawdi` skill into each agent's home. In non-interactive contexts (you), it picks all detected agents automatically. **Do not pass `--agent`** — register everything that's installed so Step 4 can sync from all of them.

## Step 4: Upload sessions to the dashboard (REQUIRED)

This is the step that gives the user something to see in the dashboard. Do not mark setup complete before this finishes.

**Ask the user once, exactly one question:**

> Want me to upload your existing agent sessions to the Clawdi Cloud dashboard?
>
> **(a) Upload everything** from every agent on this machine — recommended, takes a minute or two.
>
> **(b) Show me a summary first** — I'll show how many sessions are where, and you can pick a constraint (skip a sensitive project, only upload one agent, etc.).
>
> **skip** — don't upload now (you can run `clawdi push` later).
>
> Reply "a", "b", or "skip".

Wait for the reply. Branch on it:

### Branch (a) — upload everything

Run:

```bash
clawdi push --modules sessions --all-agents --all --yes
```

Flags:
- `--all-agents` — iterate every registered agent (Claude Code, Codex, Hermes, OpenClaw — whichever are registered).
- `--all` — disable the cwd project filter; scan every project's sessions. **Critical**: without this, the CLI would only scan the directory you're invoked from, which is rarely where the user's history lives.
- `--yes` — skip the interactive confirmation (you have already confirmed with the user).

Note the "Pushed N session(s)" total from the output — you'll cite it in Step 5.

If it prints "0 sessions to upload", that's not necessarily an error — the user may have just installed the agent. Tell them so, then continue to Step 5.

### Branch (b) — summary, then targeted push

First run:

```bash
clawdi sessions list --all-agents --all --json
```

**Do not paste the raw JSON or list every session back to the user.** Most users have dozens of sessions; a flat list is noise and asking them to pick by id is more friction than just "upload all". Instead, parse the JSON yourself, group by `agent` then by `project`, count, and render a compact summary like:

```
Claude Code: 47 sessions
  ~/work/clawdi-cloud       23
  ~/work/client-acme        12
  ~/personal/blog            8
  ~/scratch                  4

Codex: 12 sessions
  ~/work/clawdi-cloud        7
  ~/work/client-acme         5

59 sessions total. Upload everything (recommended), or restrict by agent / project / time?
```

In your message, **explicitly recommend "upload everything"** — most "show me first" users don't actually need to exclude anything; they just wanted the transparency. Only branch when they name a real constraint (sensitive project, agent they don't use, recency window).

Translate the user's reply by **dimension** (never by id):

| user said | command |
|---|---|
| "all", "go", "ok", "looks good" | `clawdi push --modules sessions --all-agents --all --yes` |
| "only Claude Code" | `clawdi push --modules sessions --agent claude_code --all --yes` |
| "only ~/work/foo" | `clawdi push --modules sessions --all-agents --project ~/work/foo --yes` |
| "exclude ~/scratch" | `clawdi push --modules sessions --all-agents --all --exclude-project ~/scratch --yes` |
| "exclude ~/scratch and ~/work/acme" | `clawdi push --modules sessions --all-agents --all --exclude-project ~/scratch --exclude-project ~/work/acme --yes` |
| "last week only" | `clawdi push --modules sessions --all-agents --all --since <ISO date 7d ago> --yes` |

Resolve `~` to an absolute path before passing to the CLI. Note the "Pushed N session(s)" total from the output — you'll cite it in Step 5.

### Branch — "skip"

Tell the user: *"Skipped. Run `clawdi push --modules sessions --all-agents --all` whenever you want to sync."* Continue to Step 5.

## Step 5: Confirm

```bash
clawdi doctor
```

All checks should be green. Then tell the user:

> Open the Clawdi Cloud dashboard — you should see N sessions across {registered agents} synced from this machine.

Where **N** is the total from Step 4's "Pushed N session(s)" line and **{registered agents}** is the list from Step 3.

If Step 4 was the skip branch, just say all setup checks passed and remind them how to push later.

## Done

After setup the user has:
- **Memory tools** (`memory_search`, `memory_add`) for cross-agent recall
- **Connector tools** (Gmail, GitHub, Notion, etc.) — they connect services in the dashboard
- **Session sync** — uploaded today; future sessions sync via `clawdi push`
- **Vault** — encrypted secrets injected via `clawdi run`

## Troubleshooting

**Step 4 says "0 sessions" but the user has history**
Re-run with an explicit cutoff:

```bash
clawdi push --modules sessions --all-agents --all --since 2020-01-01 --yes
```

This bypasses the per-agent incremental cursor in `~/.clawdi/state.json`.

**Older CLI doesn't recognize `--all-agents`**
Loop manually over each registered agent — Step 3's output told you which were registered:

```bash
clawdi push --modules sessions --agent claude_code --all --yes
clawdi push --modules sessions --agent codex --all --yes
# etc.
```

**Older CLI doesn't recognize `--exclude-project`**
Drop that flag and tell the user: *"Your CLI is too old to skip a specific project. Either upgrade (`bun add -g clawdi` again), upload everything, or upload only one project at a time with `--project <path>`."*

**Older CLI doesn't have `clawdi sessions list`**
For Branch (b), fall back to `clawdi push --modules sessions --all-agents --all --dry-run` — it prints scan totals per agent (without per-project breakdown). Less rich, but enough to tell the user "Claude Code: N sessions, Codex: M sessions" before they confirm.

**`clawdi auth complete` keeps saying "Still waiting for approval"**
The user hasn't clicked approve in the browser yet. Re-running is safe within the 10-minute window. If the window expired, restart from Phase 2a.
