---
name: clawdi
description: "Clawdi Cloud integration — cross-agent memory and connected service tools. Use memory tools proactively and connector tools when the user needs external services."
---

# Clawdi Cloud

You have access to Clawdi Cloud tools via the `clawdi` MCP server. Use them proactively.

## Memory

Two tools for cross-agent memory:

- `memory_search` — Search long-term memory by natural-language query.
- `memory_add` — Save a durable memory for cross-agent recall. Categories: `fact` (technical facts, API details, config values), `preference` (user preferences, coding style, workflow choices), `pattern` (recurring patterns, pitfalls, team conventions), `decision` (architecture decisions and their reasoning), `context` (project context, deadlines, ongoing work).

### When to search

**At the start of any task that touches the user's work, codebase, or personal context, call `memory_search` FIRST before asking them anything you might already know.** Queries are cheap; missed context is expensive.

Concrete triggers — search when any of these happen:
- User mentions a name, repo, service, project, or tool by its proper noun
- User says "as I mentioned", "like last time", "you know", "the X we set up"
- User asks about their own preferences ("what's my X", "how do I usually X")
- User asks about a past issue, bug, decision, or investigation
- Starting work on a subsystem where prior decisions may exist
- User greets you in a new session and mentions anything specific to them or their project

Do NOT search for:
- Generic programming questions with no user-specific hook ("how does useEffect work")
- Purely factual queries the code can answer directly

When unsure, err on the side of searching — 0 results costs nothing.

### When to save

- After fixing a non-obvious bug (save root cause + fix)
- After making an architecture decision (save reasoning)
- After discovering a useful pattern or workaround
- When the user explicitly says "remember this" / "save this"
- After learning a user preference you'd otherwise have to re-ask ("I prefer rg", "I always use pnpm")

Write memories as standalone sentences with full context — include names, not pronouns. A future session will read this without knowing today's conversation.

Do NOT save trivial facts that are obvious from the code itself, or generic programming knowledge.

## Connectors

Connected service tools (Gmail, GitHub, Notion, etc.) are dynamically registered from the user's Clawdi Cloud dashboard. They appear as individual tools like `gmail_fetch_emails`, `github_list_issues`, etc.

- These tools are already authenticated — no OAuth needed at runtime
- If a tool call fails with "No connected account", tell the user to connect the service in the Clawdi Cloud dashboard
- File downloads from connectors return signed URLs — download them with `curl` or `fetch` before processing
- Confirm with the user before side-effecting operations (sending email, creating issues, etc.)
