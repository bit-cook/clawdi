# Exploration — Scope-based ACL foundation

**Status:** Exploratory. Not merging to production. Kept as a single squashed
commit for reference.

**Original branch:** `feat/oss-scope-foundation` (pre-squash: 25 commits, 67
files, +13K lines, 7 Alembic migrations)

**Companion docs:**
- [Spec](../superpowers/specs/2026-04-21-cloud-first-oss-redesign-design.md) — cloud-first OSS redesign with scope + RAG session search
- [Plan](../superpowers/plans/2026-04-21-scope-foundation-prototype.md) — 16-task implementation plan
- [Feature inventory](../superpowers/branch-features.md) — what was actually built, working and verified
- [Prototype README](../prototype-scope-foundation.md) — how to run it locally

---

## 1. What we set out to answer

Could we replace the old clawdi "each user is their own island" model with a
lightweight, composable **Scope** primitive that:

1. Zero-config for solo users (auto-created Personal scope, agents auto-subscribe)
2. Teams shared work without spinning up full "workspaces"
3. Agents opt in to scopes, not the other way around
4. Cross-user sharing (invite link / email) without inviting the whole user
5. Same model handles skills, memories, vault, sessions uniformly

We built an end-to-end prototype (backend + web + CLI) to pressure-test it.

---

## 2. What we validated (worked)

### 2.1 Scope model itself feels right
- **Name choice:** "Scope" lands much lighter than "Workspace". Users don't
  expect a scope to be a full team home — it's more like a Slack channel or a
  Notion group. This framing held up across every UX conversation.
- **M:N everywhere:** a single skill/memory living in multiple scopes (via
  `skill_scopes` / `memory_scopes`) matches how people actually work. The
  git-commit-format skill belongs to both work-engineering and oss-clawdi;
  secrets-handling is in Personal and work. Users weren't confused.
- **3-tier roles** (owner / writer / reader) covered every scenario we ran
  into — no need for finer granularity yet.
- **Personal scope with `is_personal` flag** solves the "where do my solo
  notes go" question. Auto-creation on first auth + auto-subscribing new
  agents means zero-config JUST works.

### 2.2 Agent ↔ scope wiring
- **`X-Clawdi-Environment-Id` header** as the scope-filter signal is clean —
  the CLI knows which env it's running as, the backend reads subscribed scopes
  off that env. No per-call scope selection needed.
- **`default_write_scope_id` per env** handles the "where does my work-laptop
  save new items" preference. Paired with subscriptions, it's the right shape:
  a writer target is a subset-of-one of the read set, and auto-subscribe on
  default-change closes the "write somewhere you can't read" trap.

### 2.3 Sharing taxonomy (2×2)
The explicit matrix — `{anonymous, email} × {human-URL, agent-prompt}` —
mapped cleanly to four concrete paths in the Share dialog:
- Anonymous + human URL: classic shareable link
- Anonymous + agent prompt: paste-into-AI copy that uses `clawdi accept`
- Email + human URL: invite email (SMTP stub only)
- Email + agent prompt: addressed to a specific AI on their behalf

The insight was that the agent-prompt path must go through `clawdi CLI`, not
raw curl — so the CLI picked up an anonymous mode that can redeem a token
without a pre-existing API key.

### 2.4 The zero-config first-run story
New user → Clerk login → first `clawdi setup --agent claude_code` → their
laptop is subscribed to Personal, their skills/memories land in Personal, their
second machine tomorrow automatically sees everything. No configuration, no
explaining "what's a scope". This is the win.

---

## 3. What we learned / what didn't work

### 3.1 No background sync kills the "cloud-first" feel
Everything sync-related is **explicit command invocation**:
- `clawdi sync` — sessions (upload-only) + skills (bidirectional)
- `clawdi memories add` / `clawdi vault set` — per-command, not batched
- Only "automatic" piece is the 60s-throttled heartbeat, which just refreshes
  `last_seen_at`

So the user experience is "remember to run `clawdi sync`". That's not
cloud-first — that's rsync with a sidecar UI. Without a daemon or file
watcher, the model's strengths (multi-agent, multi-device) are hidden behind
friction.

**Unblocks:** a real `clawdi daemon` with either file watchers or periodic
polling + a push channel (SSE / WebSocket) from the backend for scope-side
changes.

### 3.2 Memories and Vault aren't in the sync command
They're full CRUD over the API, no batch sync path. So "all my memories
appear on my new laptop" requires the agent to re-query them individually,
or the user to trust the dashboard as the source of truth. Not wrong, but
inconsistent with how sessions and skills work.

### 3.3 Session sync is upload-only (RAG deferred)
We designed session retrieval as a RAG problem (`session_chunks` +
embedding search + MCP `session_search` tool) rather than full
compact+resume. None of that is built. The sessions are stored but not
queryable across agents. The promised "clawdi recall" story is in the spec,
not in code.

### 3.4 Conflict model is "dedup + LWW"
- Sessions: dedup by `(user_id, local_session_id)` natural key — fine
- Skills: `version: int` increments on upload, no merge — fine for now
- Memories / Vault: last-write-wins on text fields, no version column —
  if two agents edit the same memory concurrently, one silently loses

For a prototype this is acceptable. For production, memories need at
least an `updated_at` precondition.

### 3.5 Sync state is a single timestamp
`~/.clawdi/sync.json.lastSyncedAt` is all there is. No per-skill etag, no
per-scope checksum, so every `sync down` is a full list. Fine for dozens
of skills, would need refinement at hundreds.

### 3.6 Clerk is a soft dependency
Self-hosters inherit a third-party auth requirement. The design called for
a pluggable `AuthProvider` interface with a `BasicAuthProvider` alternative,
but we only implemented the Clerk path.

---

## 4. Open questions blocking production

| Question | Why it matters |
|---|---|
| How should the daemon discover and publish changes? | The whole value prop hinges on "my other laptop already has it" |
| Is SSE push enough, or do we need a reconnecting WebSocket? | Answers whether scope changes (new member, role change) propagate live |
| Per-scope sync or global sync? | Users with large shared scopes may not want every change streamed |
| What's the billing story for the SaaS side? | Scopes are free conceptually; storage and bandwidth are not |
| Does session RAG work on real session sizes without a re-embedder running on upload? | Performance cliff risk |
| How do we migrate existing clawdi users without breaking their local state? | Data migration path unclear |

---

## 5. Recommendations for next attempt

1. **Start with the daemon.** Don't rebuild the ACL — that part works. Build
   `clawdi daemon` first, prove the watch+push loop, then re-plug the ACL
   model on top of it. The ACL without the daemon feels like scaffolding
   without a building.
2. **Keep the Personal scope as the hero.** 90% of users will live in
   Personal. Design accordingly — multi-scope features are secondary.
3. **Ship memories+vault in the bulk sync path.** Current per-command CRUD
   doesn't generalize.
4. **Before production, decide on the conflict model for memories.** Either
   accept LWW explicitly (and document it), or add `updated_at` precondition
   + 409 on conflict.
5. **Abstract Clerk before OSS launch.** BasicAuthProvider is a small task
   but a big signal for self-hosters.
6. **Session RAG is its own project.** Scope it separately from the sync work
   — the concerns don't overlap except at the `session_id` FK.

---

## 6. What's in this commit

A single squashed commit preserving the complete working state: backend
models + routes + migrations + service layer, web dashboard with full scope
UX + share dialog + agent management, CLI with scope/invite subcommands +
env-bound API client, docker-compose for local Postgres+pgvector, the
realistic seed script, end-to-end verification script, and all design and
plan documents.

No code paths are removed. If the next iteration decides to build on this,
it's all here.
