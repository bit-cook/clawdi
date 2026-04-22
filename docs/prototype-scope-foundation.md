# Prototype: Scope Foundation

Demonstrates the new `Scope` model + environment-binding ACL from
`docs/superpowers/specs/2026-04-21-cloud-first-oss-redesign-design.md`.

**Scope:** single-user, multi-environment, multi-scope. Resources (skills in
this prototype) only visible to an env when the env is subscribed to a scope
the resource belongs to. Private skills (`scope_id IS NULL`) are visible to
any env the owner holds.

**Out of scope:** BasicAuthProvider (Clerk stays), invite/SMTP flow, session
RAG, Profile+Bootstrap, daemon, Dashboard UI changes.

---

## Prerequisites

- Docker + Docker Compose
- Python 3.12 + `pdm`
- Bun (for CLI)

## 1. Bring up infrastructure

```bash
docker compose up -d postgres
```

Wait for `clawdi_postgres` to be `(healthy)` — ~10 seconds.

## 2. Bring up backend

```bash
cd backend
pdm install --no-self
pdm migrate
pdm dev      # runs on :8000
```

Verify: `curl -s http://localhost:8000/health` → `{"status":"ok"}`.

## 3. Create a user + API key (bypass Clerk for demo)

The production flow requires Clerk. For prototype demo we bypass it with
direct SQL.

```bash
cd /path/to/clawdi-cloud

TOKEN=$(python3 -c "import secrets; print('clawdi_' + secrets.token_urlsafe(32))")
HASH=$(python3 -c "import hashlib, sys; print(hashlib.sha256(sys.argv[1].encode()).hexdigest())" "$TOKEN")
PREFIX="${TOKEN:0:16}"

docker compose exec -T postgres psql -U clawdi -d clawdi_cloud <<SQL
INSERT INTO users (id, clerk_id, email, name, created_at, updated_at)
VALUES (gen_random_uuid(), 'prototype-user-1', 'demo@clawdi.local', 'Demo', now(), now())
ON CONFLICT (clerk_id) DO NOTHING;
SQL

USER_ID=$(docker compose exec -T postgres psql -U clawdi -d clawdi_cloud -At -c \
  "SELECT id FROM users WHERE clerk_id='prototype-user-1';")

docker compose exec -T postgres psql -U clawdi -d clawdi_cloud <<SQL
INSERT INTO api_keys (id, user_id, key_hash, key_prefix, label)
VALUES (gen_random_uuid(), '$USER_ID', '$HASH', '$PREFIX', 'prototype');
SQL

export CLAWDI_TOKEN="$TOKEN"
echo "CLAWDI_TOKEN=$CLAWDI_TOKEN"
```

## 4. Run the ACL verification script

```bash
./scripts/verify-scope-acl.sh
```

Expected output ends with:

```
ALL TESTS PASSED
```

The script:
1. Creates `env_A` (claude_code) and `env_B` (codex)
2. Creates two scopes (`work-<ts>` and `personal-<ts>`)
3. Subscribes `env_A` to `work`, `env_B` to `personal`
4. Uploads a skill `python-style-<ts>` to the `work` scope
5. **TEST 1** — env_A (subscribed) sees the skill → PASS
6. **TEST 2** — env_B (not subscribed) does NOT see it → PASS
7. **TEST 3** — subscribe env_B to work → now it sees the skill → PASS

## 5. Try the CLI

```bash
# Point CLI at the dev backend + seed the prototype API key
mkdir -p ~/.clawdi
cat > ~/.clawdi/config.json <<EOF
{ "apiUrl": "http://localhost:8000" }
EOF
cat > ~/.clawdi/auth.json <<EOF
{ "apiKey": "$CLAWDI_TOKEN" }
EOF

# Seed a fake env record (normally `clawdi setup` would write this after
# agent registration; we're bypassing Clerk so we do it manually).
mkdir -p ~/.clawdi/environments
cat > ~/.clawdi/environments/claude_code.json <<EOF
{ "environmentId": "<paste env_A from verify script run>", "agentType": "claude_code" }
EOF

cd packages/cli
bun install

# Commands
bun run src/index.ts scope list
bun run src/index.ts scope create demo-scope
bun run src/index.ts scope subscribe <scope_id_from_list>
```

Or build + link for a real `clawdi` binary:

```bash
bun run build
ln -s "$(pwd)/dist/index.js" /usr/local/bin/clawdi
clawdi scope list
```

## What this prototype validates

| Behavior | Verified by |
|---|---|
| `scopes` / `scope_memberships` / `agent_environment_scopes` tables exist and FK correctly | Alembic migration applied |
| Creating a scope auto-adds creator as `owner` | Task 6 curl test |
| Owner-only member CRUD | `require_owner` path |
| Env CRUD of scope subscriptions requires env ownership + scope membership | Task 7 curl test |
| `X-Clawdi-Environment-Id` header binds requests to an env; wrong user → 403 | Task 8 negative cases |
| Skill list filters by `scope_id IS NULL OR scope_id IN subscribed_scope_ids` when env header present | verify-scope-acl.sh TEST 1+2 |
| Updating subscription is reflected immediately | verify-scope-acl.sh TEST 3 |
| Upload to scope requires `writer` or `owner` role | `_validate_scope_write` guard |
| Scope delete sets `skills.scope_id = NULL` (not cascade) | FK `ON DELETE SET NULL` |

## What this prototype intentionally does NOT include

- BasicAuthProvider (Clerk stays; dev bypass via direct SQL for demo)
- Invite flow / SMTP / cross-user sharing (single-user prototype)
- RAG session search (`session_chunks` table, `session_search` MCP tool)
- Agent Profile + Bootstrap (one-command onboarding)
- Daemon / WebSocket sync (only one-shot CLI)
- Audit events table
- Dashboard UI for scopes

See `docs/superpowers/specs/2026-04-21-cloud-first-oss-redesign-design.md`
for the full design and phased roadmap.
