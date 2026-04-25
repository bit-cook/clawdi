---
name: clawdi-setup
description: "Set up Clawdi Cloud CLI for the current user. Follow these steps exactly."
---

# Clawdi Cloud Setup

Help the user connect to Clawdi Cloud. Follow these steps in order.

## Step 1: Install CLI

```bash
bun add -g clawdi
```

If bun is not available, use npm:

```bash
npm install -g clawdi
```

## Step 2: Log in (two steps)

This is a two-step flow so the agent never blocks waiting for the user.

**Step 2a — start the authorization:**

```bash
clawdi auth login
```

The command exits immediately after printing a **verification URL** and a short **user code**. **Show both to the user in chat** and ask them to:

1. Open the URL.
2. Confirm the code matches.
3. Click approve.
4. **Reply "done" (or anything similar) here when finished** — you need that reply before moving to Step 2b.

The CLI tries to open their browser too, but in agent/sandboxed environments that usually no-ops silently — so they need the link.

**Step 2b — after the user confirms they approved:**

```bash
clawdi auth complete
```

This finishes the handshake (typically in a second or two) and writes credentials to `~/.clawdi/auth.json`. The pending authorization is valid for **10 minutes** from when `clawdi auth login` was run.

If `clawdi auth complete` exits with **"Still waiting for approval"** (exit code 2), the user hasn't approved yet — ask them to finish approving in the browser, then re-run `clawdi auth complete`. It's safe to re-run as many times as needed within the 10-minute window. If the window expires, start over from Step 2a.

Do not use `--manual` here: that flag requires an interactive password prompt (TTY) and will fail in an agent session.

## Step 3: Set up agent

```bash
clawdi setup
```

This will:
- Detect installed agents (Claude Code, Codex, Hermes, OpenClaw)
- Register the MCP server (gives you `memory_search`, `memory_add`, and connector tools)
- Install the Clawdi skill

## Step 4: Verify

```bash
clawdi doctor
```

Confirms auth, API reachability, agent installation, and MCP wiring. Resolve any failing check before continuing.

## Step 5: Sync sessions (optional)

```bash
clawdi push --modules sessions
```

This uploads your conversation history to the Clawdi Cloud dashboard.

## Done!

After setup, you have access to:
- **Memory tools**: `memory_search` and `memory_add` for cross-agent recall
- **Connector tools**: Gmail, GitHub, Notion, etc. (connect services in the dashboard)
- **Session sync**: Upload conversations to view in the dashboard
- **Vault**: Encrypted secrets injected via `clawdi run`

Tell the user setup is complete and they can visit the dashboard to see their data.
