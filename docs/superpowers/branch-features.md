# Branch `feat/oss-scope-foundation` — Feature Inventory

**Stats:** 22 commits · 62 files · +9 713 / −244 lines · 7 Alembic migrations

Organized by feature area, not commit order. Every item here is working and
end-to-end verified; things explicitly left for V2 are called out.

---

## 1. Design artifacts

| File | Purpose |
|---|---|
| `docs/superpowers/specs/2026-04-21-cloud-first-oss-redesign-design.md` | Spec: clawdi-cloud OSS direction, scope model, session RAG, auth provider, agent-image migration, phased deprecation of old clawdi |
| `docs/superpowers/plans/2026-04-21-scope-foundation-prototype.md` | Implementation plan for the initial 16-task prototype slice |
| `docs/prototype-scope-foundation.md` | How-to-run README for the prototype |

---

## 2. Scope model — core concept

**Scope** = a container that groups resources (skills / memories / vault items)
plus agents that subscribe to see them. Cross-user sharing happens here.

### Entities

| Table | Purpose |
|---|---|
| `scopes` | id, owner_user_id, name, visibility, **is_personal** |
| `scope_memberships` | scope_id × user_id × role (`owner` / `writer` / `reader`) |
| `agent_environment_scopes` | M:N — env subscribes to scopes |
| `skill_scopes` | M:N — skill belongs to multiple scopes |
| `memory_scopes` | M:N — memory belongs to multiple scopes |
| `scope_invitations` | token_hash, role, expires_at, accepted_at, revoked_at, **invitee_email** |
| `users.default_scope_id` | FK → user's Personal scope |
| `agent_environments.default_write_scope_id` | per-agent default write target |

### Personal scope (auto-created)

- Built on first authenticated request (lazy init in `get_auth` middleware)
- `is_personal=true` flag; cannot delete; renamable
- New `AgentEnvironment` auto-subscribes + sets `default_write_scope_id = Personal`
- Zero-config UX: new user → first `clawdi setup` → all writes & reads flow
  through Personal, all of their agents see each other's content

### Resource visibility

- **Private (0 scopes):** only creator can see
- **Scoped (1+ scopes):** any user who is member of any of those scopes can see
- **Env filter:** when `X-Clawdi-Environment-Id` header is present, further
  narrow to scopes that env subscribes to

### Permissions (centralized in `app/services/permissions.py`)

| Action | Rule |
|---|---|
| View object | Any membership in its scopes OR creator if private |
| Edit / delete object | Any writer+ role in its scopes OR creator if private |
| Add object to scope X | Writer+ in scope X (target-specific) |
| Remove object from scope X | Writer+ in scope X (target-specific) |
| Change env's `default_write` | Env owner (user); auto-subscribes if not already |
| Unsubscribe env from scope | Reject if scope is env's `default_write_scope_id` |
| Delete scope | Owner-only; blocked on Personal |
| Leave scope | Blocked if last owner or default_write references it |
| Change member role | Owner-only; blocked on demoting last owner |

### Hard invariant (enforced in backend)

```
env.default_write_scope_id IS NULL
  OR env.default_write_scope_id ∈ env.subscribed_scope_ids
```

---

## 3. Sharing & invitations

### Four-path orthogonal matrix

|  | Human (browser) | AI agent (CLI prompt) |
|---|---|---|
| **Anonymous token** | `/join/<token>` page | paste prompt → `clawdi accept <token>` |
| **Email-bound** | email-bound `/join/<token>` | same prompt, bound |

### `ShareScopeDialog` (popover-style modal)

Triggered by `Share` button in scope detail header. Contains:
- Email + role + Invite button (registered user → add directly; new email → bound invite link)
- People with access (member list with inline role ▾: owner/writer/reader/remove)
- Pending invitations (with Revoke)
- General access: Generate shareable link (anonymous)
- Output toggle per generated artifact: **For a human** (URL) vs **For their AI agent** (prompt)

### Backend endpoints

| Endpoint | Purpose |
|---|---|
| `POST /api/scopes/{id}/invitations` | Create invite (optional `invitee_email` to bind) |
| `GET /api/scopes/{id}/invitations` | List (owner-only) |
| `DELETE /api/scopes/{id}/invitations/{id}` | Revoke (owner-only) |
| `GET /api/invitations/{token}` | Preview (shows `can_accept`, `reason`, whether email-bound) |
| `POST /api/invitations/{token}/accept` | Accept — validates email binding + writes membership |
| `GET /api/auth/users/search?email=…` | Exact-email lookup for direct-add flow |

### Post-accept onboarding

- `/scopes/[id]/onboard` — scope content preview (skill/memory counts + samples)
  + agent selection checkboxes + Skip option

### CLI path

- `clawdi invite accept <token_or_url>` (+ `clawdi accept` alias)
- Preview → accept → hint next step (`clawdi agent scope add …`)
- Agent prompt tells the invitee's AI agent to `clawdi accept <token>`, referencing `/skill.md` for install

---

## 4. Agents

### `AgentEnvironment` — one per (machine × agent_type)

- Extends existing model with `default_write_scope_id`
- `POST /api/environments/{id}/heartbeat` — 60s throttled last_seen bump
- `GET /api/environments` returns `subscribed_scope_ids` + `default_write_scope_id`
- `DELETE /api/environments/{id}` — unregister (cascade drops subscriptions)
- `PATCH /api/environments/{id}/default-write-scope` — change default (auto-subscribes if needed)
- `POST /api/environments/{id}/scopes/{scope_id}` — subscribe
- `DELETE /api/environments/{id}/scopes/{scope_id}` — unsubscribe (409 if it's default_write)

### `/agents` Dashboard page

- Card per agent: agent type badge, machine name, version, OS, last_seen (with Stale badge after 30d)
- "Default location for new items" dropdown per env (Private or any scope)
- "In scopes" chips — click to subscribe/unsubscribe (bidirectional with Scope page)
- Row actions ⋯ → Unregister agent

---

## 5. Skills (M:N)

### Backend routes (`/api/skills`)

| Endpoint | Purpose |
|---|---|
| `GET /api/skills` | List visible (own-private + scoped-via-membership + env filter) |
| `GET /api/skills/{key}` | Single skill (visibility-checked) |
| `POST /api/skills/upload` | Tar.gz upload, single scope at creation |
| `POST /api/skills/install` | Install from GitHub with optional scope |
| `GET /api/skills/{key}/download` | Download tar (visibility-checked) |
| `DELETE /api/skills/{key}` | Delete (edit permission check) |
| `PUT /api/skills/{key}/scopes` | Replace scope set (add/remove writer check each side) |
| `POST /api/skills/{key}/scopes/{scope_id}` | Add single scope |
| `DELETE /api/skills/{key}/scopes/{scope_id}` | Remove single scope |

### UI

- Skill row shows: name, version, **ScopeChips** (up to 2 + `+N`), file count, description
- Row actions ⋯ → **Manage scopes…** (opens `ManageScopesSheet` with checkboxes) · Delete skill
- Scope filter bar (pill for ≤5 scopes, dropdown above)

---

## 6. Memories (M:N)

Same pattern as skills:

- `PUT /api/memories/{id}/scopes` + bulk visibility + env filter
- Hybrid search (FTS + pgvector) goes through existing provider, post-filter by visibility
- Memory creation: `scope_id` on POST (accepts `"private"` literal or UUID)
- Row actions ⋯ → Manage scopes… · Delete
- Add-memory form defaults dropdown to **"Personal (default)"**

### Intentionally **not** done

- Inline content editing (`PATCH /api/memories/{id}`): memories are additive
  facts; editing blurs their role vs. skills/documents.

---

## 7. Vault (single-scope, not M:N)

Vault is kept single-scope deliberately (cross-user secret sharing has stricter audit/MFA needs; deferred to V2).

- `POST /api/vault` accepts `scope_id`
- `PATCH /api/vault/{slug}/scope` — reassign to another scope or private
- Row actions ⋯ → "Move to &lt;scope&gt;" quick items · "Move to Private" · Delete
- Banner on Vault page: "Values never shown in web — use `clawdi vault set` / `clawdi run`"

---

## 8. Auth

### AuthContext carries (when `X-Clawdi-Environment-Id` header present)

- `user`, `api_key`
- `environment_id`
- `subscribed_scope_ids`
- `default_write_scope_id`

Backend validates `env.user_id == token.user_id` → 403 otherwise.

Lazy `ensure_personal_scope(user)` creates Personal + pins `default_scope_id` on first request.

### Token types

| Token | User | Entry |
|---|---|---|
| **Clerk JWT** | Web | Existing Clerk flow; `users.clerk_id` |
| **API key** | CLI | `clawdi_…` prefix; SHA-256 hash in DB |
| **Invitation token** | Invitee | `clawdi_inv_…` single-use, 48h expiry, token_hash stored |

---

## 9. CLI

### New commands

```
clawdi scope create <name>
clawdi scope list
clawdi scope members <scope>
clawdi scope subscribe <scope> [--agent type]
clawdi scope unsubscribe <scope> [--agent type]

clawdi agent scope add <agent> <scope>
clawdi agent scope remove <agent> <scope>
clawdi agent scope default <agent> <scope|private>

clawdi invite accept <token_or_url>
clawdi accept <token_or_url>                  # alias
```

### Existing commands enhanced

- `clawdi skill add <path> --scope <name|uuid>` — attaches to a scope
- `clawdi skill list --agent <type>` — filter by specific env's subscriptions
- `clawdi memory add` / `vault set` respect env's `default_write_scope_id`

### CLI internals

- `packages/cli/src/lib/env-state.ts` — read `~/.clawdi/environments/<agent>.json`
- ApiClient auto-attaches `X-Clawdi-Environment-Id` header from local state

---

## 10. Dashboard UX

### Navigation

- New sidebar entries: **Scopes** (FolderKanban) · **Agents** (Cpu)
- Position between Overview and Sessions

### Global

- sonner toasts for all mutations (success / error with server detail)
- `ApiError` class parses FastAPI error detail for clean toasts
- Clerk middleware excludes `.md` / `.txt` — `/skill.md` publicly accessible
- OnboardingCard judgement uses `environments_count == 0` (not session count)

### Pages

| Page | Core features |
|---|---|
| `/` Overview | OnboardingCard (Send-to-Agent / Manual Setup), module cards, streak, activity, recent sessions |
| `/scopes` | List with N items · M agents per row, Personal ⭐ pinned, inline create |
| `/scopes/[id]` | Inline rename, delete safeguards, leave button, members summary, resources by section with empty states, agent include/exclude toggles, **Share button → ShareScopeDialog** |
| `/scopes/[id]/onboard` | Post-accept flow: content preview + agent subscription checklist |
| `/agents` | Per-agent default-write dropdown, subscription chips, Stale badge, unregister menu |
| `/memories` | Search, category filter, scope filter, multi-scope chips, add form defaults to Personal |
| `/skills` | Install from GitHub with scope, scope filter, multi-scope chips, marketplace |
| `/vault` | Per-vault move-scope menu, banner, scope filter |
| `/join/[token]` | Invitation preview (scope name, role, expiry, email binding, can-accept reason) + Accept |

### Reusable components

| Component | Role |
|---|---|
| `ScopeChips` | Inline display (≤ 2 + `+N`), opens ManageScopesSheet |
| `ManageScopesSheet` | Checkbox editor (PUT replaces scope set) |
| `ScopeFilterBar` | Pills for small sets, dropdown for >5 |
| `RowActions` | Dropdown menu on row (`⋯`) — Manage scopes / Delete / custom |
| `ShareScopeDialog` | Notion-style popup for all sharing flows |

---

## 11. Infrastructure

- `docker-compose.yml` — PG 16 + pgvector + pg_trgm on port 5433
- `apps/web/.env.example` — was missing; now committed
- `.env.example` root — Postgres config defaults
- `scripts/seed-demo-data.sh` — 3 scopes × 3 envs × 5 skills × 8 memories × 3 vaults
- `scripts/verify-scope-acl.sh` — E2E ACL verification (3 tests)

---

## 12. Test coverage

- End-to-end bash script: `scripts/verify-scope-acl.sh` → 3/3 pass
- Manual curl verifications in commit trail for each phase:
  - `docker-compose up` infra
  - Scope CRUD + membership + env subscription
  - Env binding middleware (403/400/200 paths)
  - Default write + auto-subscribe + 409 guard
  - Personal protection + rename
  - M:N skill upload / attach multiple / replace
  - Invitation create / preview / accept / email-bound rejection
  - Vault scope PATCH
  - Agent unregister
  - Member role PATCH (last-owner-demote → 400)

No formal pytest suite — prototype pragmatism. Adding pytest when graduating from prototype is a separate task.

---

## 13. Explicitly deferred to V2

| Feature | Reason |
|---|---|
| Inline memory content edit | Memories are additive facts; delete+re-add is clearer |
| CLI anonymous / device-code auth | Complex; `clawdi login` works |
| SMTP email delivery | Copy-link UX works; SMTP adds ops burden |
| Activity feed / change notifications | Needs event system |
| Skill edit-conflict revision guard | LWW is fine for single-team use |
| Cross-user Vault sharing | Secret distribution needs MFA + per-use audit |
| Nested scopes | Single level handles team + team-in-team simulation |
| Workspace-level entity | Enterprise feature — SaaS layer concern, not OSS |
| RAG session_search | In spec; next phase after this branch |
| `clawdi daemon` long-running sync | In spec; next phase |
| BasicAuthProvider (replace Clerk) | In spec; next phase after auth rework is prioritized |

---

## 14. Migrations (applied in order)

```
c8cf4bec747e  initial_schema                              (pre-branch)
1b50ac3f7b87  add memories table                          (pre-branch)
9f74c827cec3  add skill source_repo                       (pre-branch)
a3d1f2e4b567  add skill file_count                        (pre-branch)
6a6bb7b46a4f  add memory search indexes (pg_trgm+tsvector)(pre-branch)
7ac3349475ec  add memory embedding (pgvector)             (pre-branch)
e81a04e870b4  widen memory embedding to 768 dim           (pre-branch)
─── this branch ────────────────────────────────────────
db14af31fb6f  add scopes, scope_memberships, agent_environment_scopes
2988624e6be5  add skills.scope_id                         (later dropped by e5cb…)
affdc1ac78ec  add scope_id to memories and vaults         (partial drop by e5cb…)
b1c152248aa6  add personal scope flag and default_write_scope
78eeade62ac3  add scope_invitations
e5cb994425a4  skill_scopes and memory_scopes m2m          ← drops legacy scope_id columns
d236d6dedde8  add invitee_email to scope_invitations
```

Data migration safe on this branch: each migration backfills before dropping
legacy columns (see `e5cb994425a4` for the M:N transition).

---

## 15. File layout summary

### New backend files

```
backend/app/models/scope.py                 Scope, ScopeMembership
backend/app/models/env_scope.py             AgentEnvironmentScope
backend/app/models/skill_scope.py           SkillScope
backend/app/models/memory_scope.py          MemoryScope
backend/app/models/scope_invitation.py      ScopeInvitation
backend/app/schemas/scope.py                ScopeCreate/Out/MemberAdd/MemberOut/Update
backend/app/routes/scopes.py                CRUD + membership + rename + delete + leave + role change
backend/app/routes/environment_scopes.py    env subscription CRUD + default-write PATCH
backend/app/routes/scope_invitations.py     invitation CRUD + preview + accept
backend/app/services/permissions.py         Centralized ACL helpers
backend/alembic/versions/*.py               7 migrations
```

### New frontend files

```
apps/web/src/app/(dashboard)/scopes/page.tsx
apps/web/src/app/(dashboard)/scopes/[id]/page.tsx
apps/web/src/app/(dashboard)/scopes/[id]/onboard/page.tsx
apps/web/src/app/(dashboard)/agents/page.tsx
apps/web/src/app/(dashboard)/join/[token]/page.tsx
apps/web/src/components/share-scope-dialog.tsx
apps/web/src/components/scope-chips.tsx
apps/web/src/components/manage-scopes-sheet.tsx
apps/web/src/components/scope-filter-bar.tsx
apps/web/src/components/row-actions.tsx
apps/web/public/skill.md                    (was ignored by middleware — now served)
apps/web/.env.example                       (was missing)
```

### New CLI files

```
packages/cli/src/lib/env-state.ts
packages/cli/src/commands/scope.ts
packages/cli/src/commands/invite.ts
```

### Infrastructure

```
docker-compose.yml
.env.example
scripts/seed-demo-data.sh
scripts/verify-scope-acl.sh
```

---

## 16. Shipping checklist (if merging to main)

- [x] All typechecks pass (backend via pdm; web via tsc)
- [x] E2E verify script all green
- [x] Migrations in sequence with backfill
- [x] Docs: spec + plan + prototype README + this branch summary
- [ ] OpenAPI client regen (if downstream consumers use typed client)
- [ ] CHANGELOG entry for user-facing scope + share features
- [ ] Upgrade notes: existing DBs get Personal scope auto-created on first auth after deploy

---

## 17. Thanks

Co-designed across multiple Codex review rounds. Every major design decision
— Scope naming, M:N vs single ownership, Personal protection, invitation
semantics, share dialog layout, agent-prompt path — went through at least
one Codex critique before implementation.
