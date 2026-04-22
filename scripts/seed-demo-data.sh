#!/usr/bin/env bash
# seed-demo-data.sh — populate backend with realistic demo content.
#
# Scenario: a full-stack developer who works across three contexts:
#   - Personal (auto-created) — their own habits and tools
#   - work-engineering        — shared with the team at their day job
#   - client-acme             — consulting work for a specific client
#   - oss-clawdi              — open-source contribution scope
#
# And three connected agents representing common patterns:
#   - laptop-home  (Claude Code)  — weekend / OSS / personal
#   - work-laptop  (Claude Code)  — day-job machine
#   - travel-mbp   (Codex)        — travel / light work away from desk
#
# This seeds scopes, memberships, skills (with multi-scope M:N), memories
# across categories, and vault items with actual keys. Re-runnable: it
# cleans the demo-owned scopes first (identified by their names) before
# creating.
#
# Prereqs:
#   - docker compose up -d postgres
#   - backend running on :8000
#   - CLAWDI_TOKEN env var

set -euo pipefail

API="${API:-http://localhost:8000}"

if [[ -z "${CLAWDI_TOKEN:-}" ]]; then
	echo "Set CLAWDI_TOKEN to a valid API key"
	exit 1
fi

AUTH_HEADER="Authorization: Bearer $CLAWDI_TOKEN"

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

jq_id() { python3 -c "import sys, json; print(json.load(sys.stdin)['id'])"; }

scope_id_by_name() {
	local name="$1"
	curl -sS "$API/api/scopes" -H "$AUTH_HEADER" \
		| python3 -c "import sys,json; n=sys.argv[1]; xs=[s['id'] for s in json.load(sys.stdin) if s['name']==n]; print(xs[0] if xs else '')" \
		"$name" || true
}

personal_scope_id() {
	curl -sS "$API/api/scopes" -H "$AUTH_HEADER" \
		| python3 -c "import sys,json; xs=[s['id'] for s in json.load(sys.stdin) if s.get('is_personal')]; print(xs[0] if xs else '')"
}

delete_scope_if_exists() {
	local name="$1"
	local id
	id=$(scope_id_by_name "$name")
	if [[ -n "$id" ]]; then
		curl -sS -o /dev/null -X DELETE "$API/api/scopes/$id" -H "$AUTH_HEADER" || true
		echo "  cleaned old: $name"
	fi
}

create_scope() {
	local name="$1"
	curl -sS -X POST "$API/api/scopes" \
		-H "$AUTH_HEADER" -H "Content-Type: application/json" \
		-d "{\"name\":\"$name\"}" | jq_id
}

upload_skill() {
	# upload_skill <skill_key> <scope_id_or_private> <frontmatter_description> <body>
	local key="$1" scope="$2" desc="$3" body="$4"
	local tmp dir
	tmp=$(mktemp -d)
	dir="$tmp/$key"
	mkdir -p "$dir"
	cat > "$dir/SKILL.md" <<EOF
---
name: $key
description: "$desc"
---
$body
EOF
	local tar="$tmp/$key.tar.gz"
	tar -czf "$tar" -C "$tmp" "$key"

	local scope_arg=""
	if [[ "$scope" != "private" ]]; then
		scope_arg="-F scope_id=$scope"
	fi
	curl -sS -X POST "$API/api/skills/upload" \
		-H "$AUTH_HEADER" \
		-F "skill_key=$key" \
		$scope_arg \
		-F "file=@$tar" > /dev/null
	echo "  skill $key (primary scope: $([ "$scope" = "private" ] && echo 'private' || echo 'set'))"
}

attach_skill_to_scopes() {
	# attach_skill_to_scopes <skill_key> <scope_id_1> [scope_id_2 ...]
	local key="$1"; shift
	local scopes_json
	scopes_json=$(python3 -c "import json,sys; print(json.dumps(sys.argv[1:]))" "$@")
	curl -sS -X PUT "$API/api/skills/$key/scopes" \
		-H "$AUTH_HEADER" -H "Content-Type: application/json" \
		-d "{\"scope_ids\": $scopes_json}" > /dev/null
}

create_memory() {
	# create_memory <category> <scope_id_or_private> <content>
	local cat="$1" scope="$2" content="$3"
	local scope_field='"private"'
	if [[ "$scope" != "private" ]]; then scope_field="\"$scope\""; fi
	curl -sS -X POST "$API/api/memories" \
		-H "$AUTH_HEADER" -H "Content-Type: application/json" \
		-d "{\"content\":\"$content\",\"category\":\"$cat\",\"scope_id\":$scope_field}" > /dev/null
	echo "  [$cat] $(echo "$content" | head -c 55)..."
}

create_vault() {
	# create_vault <slug> <name> <scope_id_or_private>
	local slug="$1" name="$2" scope="$3"
	local scope_field='"private"'
	if [[ "$scope" != "private" ]]; then scope_field="\"$scope\""; fi
	curl -sS -X POST "$API/api/vault" \
		-H "$AUTH_HEADER" -H "Content-Type: application/json" \
		-d "{\"slug\":\"$slug\",\"name\":\"$name\",\"scope_id\":$scope_field}" > /dev/null
	echo "  vault $slug"
}

add_vault_items() {
	# add_vault_items <slug> <json_fields>
	local slug="$1" fields="$2"
	curl -sS -X PUT "$API/api/vault/$slug/items" \
		-H "$AUTH_HEADER" -H "Content-Type: application/json" \
		-d "{\"section\":\"\",\"fields\":$fields}" > /dev/null
}

register_env() {
	# register_env <machine_id> <machine_name> <agent_type> <os>
	curl -sS -X POST "$API/api/environments" \
		-H "$AUTH_HEADER" -H "Content-Type: application/json" \
		-d "{\"machine_id\":\"$1\",\"machine_name\":\"$2\",\"agent_type\":\"$3\",\"os\":\"$4\"}" | jq_id
}

subscribe_env() {
	curl -sS -o /dev/null -X POST "$API/api/environments/$1/scopes/$2" -H "$AUTH_HEADER" || true
}

set_default_write() {
	curl -sS -o /dev/null -X PATCH "$API/api/environments/$1/default-write-scope" \
		-H "$AUTH_HEADER" -H "Content-Type: application/json" \
		-d "{\"scope_id\":\"$2\"}"
}

# ---------------------------------------------------------------------------
# Scopes
# ---------------------------------------------------------------------------

echo "== cleaning previous demo scopes =="
delete_scope_if_exists "work-engineering"
delete_scope_if_exists "client-acme"
delete_scope_if_exists "oss-clawdi"

echo
echo "== using auto-created Personal scope =="
PERSONAL=$(personal_scope_id)
if [[ -z "$PERSONAL" ]]; then
	echo "Personal scope not auto-created yet. Hit any API endpoint first so lazy-init runs."
	exit 1
fi
echo "  Personal = $PERSONAL"

echo
echo "== creating new scopes =="
WORK=$(create_scope "work-engineering")
echo "  work-engineering = $WORK"
ACME=$(create_scope "client-acme")
echo "  client-acme = $ACME"
OSS=$(create_scope "oss-clawdi")
echo "  oss-clawdi = $OSS"

# ---------------------------------------------------------------------------
# Environments
# ---------------------------------------------------------------------------

echo
echo "== registering envs =="
LAPTOP_HOME=$(register_env "demo-laptop-home" "Home Laptop" "claude_code" "darwin")
echo "  laptop-home (Claude Code) = $LAPTOP_HOME"
WORK_LAPTOP=$(register_env "demo-work-laptop" "Work Laptop" "claude_code" "darwin")
echo "  work-laptop (Claude Code) = $WORK_LAPTOP"
TRAVEL_MBP=$(register_env "demo-travel-mbp" "Travel MBP" "codex" "darwin")
echo "  travel-mbp (Codex) = $TRAVEL_MBP"

echo
echo "== configuring subscriptions =="
# laptop-home: personal + oss (weekend / OSS work)
subscribe_env "$LAPTOP_HOME" "$OSS"
# work-laptop: personal (auto) + work + acme (the everything machine)
subscribe_env "$WORK_LAPTOP" "$WORK"
subscribe_env "$WORK_LAPTOP" "$ACME"
# travel-mbp: personal + work (away from desk)
subscribe_env "$TRAVEL_MBP" "$WORK"

# Default write scopes — the "save new items to..." preference per agent
set_default_write "$LAPTOP_HOME" "$PERSONAL"   # already default but makes it explicit
set_default_write "$WORK_LAPTOP" "$WORK"       # day-job writes go to work by default
set_default_write "$TRAVEL_MBP" "$WORK"

echo "  laptop-home  → Personal (default), oss-clawdi"
echo "  work-laptop  → work-engineering (default), Personal, client-acme"
echo "  travel-mbp   → work-engineering (default), Personal"

# ---------------------------------------------------------------------------
# Skills — with real content and M:N examples
# ---------------------------------------------------------------------------

echo
echo "== uploading skills =="

upload_skill "python-style-guide" "$WORK" \
	"Team's Python coding standards for any backend work" "
# Python Style Guide (engineering team)

## Formatting
- **Black** with line length 100; no other formatters
- **Ruff** for lint (E, F, I, UP) — config in \`pyproject.toml\`
- Import order: stdlib → third-party → first-party (enforced by ruff)

## Type hints
- \`ClassName | None\` over \`Optional[ClassName]\`
- No \`typing.Any\` unless we can't avoid it (add a comment explaining why)
- Pydantic v2 models for all API request/response bodies

## Async
- \`async def\` by default in the backend; sync only for CPU-bound work in worker
- Never mix sync DB calls inside async handlers
"

upload_skill "git-commit-format" "$WORK" \
	"Conventional commits used across work and OSS" "
# Commit message format

\`\`\`
<type>(<scope>): <subject>

<body>

<footer>
\`\`\`

## Types
- \`feat\` — new user-facing feature
- \`fix\` — bug fix
- \`refactor\` — restructuring without behavior change
- \`docs\` — documentation only
- \`chore\` — tooling, deps, config
- \`test\` — test additions

## Rules
- Subject ≤ 72 chars, imperative mood (\"add X\" not \"added X\")
- Body explains *why*, not *what*
- Footer: \`Closes #123\` or \`BREAKING CHANGE: ...\`
"

upload_skill "react-component-template" "$WORK" \
	"How new React components should be structured in work frontend" "
# React Component Template

## File structure
\`src/components/<ComponentName>/\`
  - \`index.tsx\` — component
  - \`styles.module.css\` (or Tailwind inline)
  - \`<ComponentName>.test.tsx\`

## Defaults
- Named export, no default export
- Props interface co-located at top of file
- \`use client\` directive only when necessary (hooks, event handlers)
- Prefer composition over prop drilling; use context for truly global state
"

upload_skill "oauth-debugging-checklist" "$OSS" \
	"Step-by-step OAuth 2.0 debugging — when token flows break" "
# OAuth 2.0 Debugging Checklist

When the token flow breaks, go in this order:

1. **Clock skew** — server and client within 60s of each other?
2. **Redirect URI** — exact match including trailing slash and scheme (http vs https)?
3. **Scopes** — requested scopes supported by the provider? granted by user?
4. **PKCE** — if using PKCE, verifier/challenge hashes match? code_verifier stored securely?
5. **Refresh** — refresh token hasn't exceeded rotation limit? grant type \`refresh_token\`?
6. **Token audience** — \`aud\` claim on the JWT matches what the resource server expects?
7. **CORS** — browser requests need OAuth endpoints to allow your origin

## Tools
- \`jwt.io\` for quick inspection
- \`openssl s_client\` to verify TLS on the issuer
- \`curl -v\` with \`-k\` off (don't skip cert verification while debugging)
"

upload_skill "acme-api-quirks" "$ACME" \
	"Known edge cases with ACME Corp's public API" "
# ACME API quirks

- **Rate limit:** 100 req/min burst, 60/min sustained. 429 response, retry after \`Retry-After\` header.
- **Dates:** ACME uses ISO 8601 but with Unix epoch in one endpoint (\`/v2/orders?since=<epoch>\`).
  Don't pass ISO there; it silently returns empty.
- **Auth:** \`Authorization: Bearer\` for most, but \`/v2/webhooks\` requires \`X-Acme-Signature\` HMAC.
- **Idempotency:** POST creates dup records if retried without \`Idempotency-Key\` header.
- **Webhooks:** retries on 5xx for up to 48h; no retry on 4xx — fix your handler ASAP.
"

upload_skill "personal-shell-setup" "$PERSONAL" \
	"My personal terminal tooling — not for the team" "
# My shell / terminal setup

- **Shell:** zsh with starship prompt
- **Multiplexer:** tmux, prefix \`C-a\`, vertical split default
- **Editor:** Neovim with LazyVim preset
- **History:** zsh-autosuggestions + fzf-tab
- **Aliases I use:**
  - \`g\` = git
  - \`gs\` = git status
  - \`gca!\` = git commit --amend --no-edit
  - \`k\` = kubectl
"

upload_skill "secrets-handling-rules" "$PERSONAL" \
	"How I handle secrets across projects" "
# Secrets — rules I follow

1. **Never in code.** Use \`clawdi vault set KEY\` → \`clawdi run -- <cmd>\`.
2. **Never in \`.env\` committed to git.** If a project uses \`.env\`, it's in \`.gitignore\`
   and there's an \`.env.example\` with placeholder values.
3. **Short-lived tokens preferred.** For AWS, use SSO + role assumption, not static keys.
4. **Rotate on a schedule.** Personal tokens (GitHub, DO) every 6 months.
5. **When leaving a client project:** rotate every credential I touched, not just my own.
"

upload_skill "code-review-checklist" "$OSS" \
	"What I look for when reviewing OSS PRs" "
# PR review checklist (OSS)

## Always check
- Does the PR description explain *why* (not just what)?
- Tests added/updated for the change?
- Public API changes call out in CHANGELOG?
- Breaking changes flagged?

## Code smell quick scan
- Silent exception swallowing (\`except: pass\`)
- Hardcoded paths, URLs, timeouts
- TODO comments without a linked issue
- Dead code left from refactoring

## Performance gotchas
- N+1 queries in new endpoint code
- O(n²) where n can grow unbounded
- Missing database index for new query pattern
"

# Multi-scope (M:N) attachments — the showcase
echo
echo "== attaching skills to additional scopes (M:N) =="
attach_skill_to_scopes "git-commit-format" "$WORK" "$OSS"
echo "  git-commit-format → work-engineering + oss-clawdi"
attach_skill_to_scopes "oauth-debugging-checklist" "$OSS" "$PERSONAL"
echo "  oauth-debugging-checklist → oss-clawdi + Personal"
attach_skill_to_scopes "secrets-handling-rules" "$PERSONAL" "$WORK"
echo "  secrets-handling-rules → Personal + work-engineering"

# ---------------------------------------------------------------------------
# Memories
# ---------------------------------------------------------------------------

echo
echo "== creating memories =="

# Personal habits & preferences
create_memory "preference" "$PERSONAL" "I prefer Black over Ruff for Python auto-format — deterministic wins over opinionated"
create_memory "preference" "$PERSONAL" "When debugging a new service, first check Grafana for the last 24h of latency spikes before reading code"
create_memory "pattern" "$PERSONAL" "On Fridays I batch-update dependencies across all my repos; saves context switching the rest of the week"
create_memory "fact" "$PERSONAL" "My home IP changes weekly (residential); SSH keys auth only, password disabled"

# Work engineering team
create_memory "decision" "$WORK" "Team chose Postgres 16 + pgvector over Supabase — we need custom extensions and direct SQL access"
create_memory "pattern" "$WORK" "CI deploys to staging on every merge to main. Prod is manual promotion via a button in Dashboard"
create_memory "fact" "$WORK" "Internal wiki: wiki.example.com (Okta SSO). Runbooks repo: github.com/acmeinc/runbooks"
create_memory "preference" "$WORK" "Engineering team prefers PRs under 400 LOC; split anything larger before review"
create_memory "pattern" "$WORK" "Every Monday 10am standup: blocked → yesterday → today. No other status meetings"

# Client ACME
create_memory "fact" "$ACME" "ACME API base: https://api.acme-corp.com/v2. Staging: staging-api.acme-corp.com. Rate limit 100/min"
create_memory "decision" "$ACME" "Chose Redis + cron for ACME webhook retries over SQS — cost-driven (dedicated Redis was \$9/mo vs SQS at scale)"
create_memory "context" "$ACME" "ACME migration kickoff week of 2026-05-05. Stakeholder review every Thursday 2pm PT with Jane and David"

# OSS contributions
create_memory "pattern" "$OSS" "For clawdi-cloud PRs: rebase on origin/main before push; squash related commits; Co-Authored-By for AI-assisted work"
create_memory "fact" "$OSS" "clawdi-cloud RFCs go under /docs/superpowers/specs. Implementation plans under /docs/superpowers/plans"

# ---------------------------------------------------------------------------
# Vaults + items (with actual values)
# ---------------------------------------------------------------------------

echo
echo "== creating vaults + items =="

create_vault "work-secrets" "Work Engineering Secrets" "$WORK"
add_vault_items "work-secrets" '{
  "OPENAI_API_KEY": "sk-proj-demo-work-openai-NOT-A-REAL-KEY",
  "ANTHROPIC_API_KEY": "sk-ant-api-demo-work-NOT-A-REAL-KEY",
  "DATABASE_URL": "postgresql://prod_ro:demo-pw@db.internal.example.com:5432/main",
  "SENTRY_DSN": "https://demo-key@o1234.ingest.sentry.io/5678"
}'
echo "  work-secrets: 4 keys"

create_vault "personal-tools" "Personal API Keys" "$PERSONAL"
add_vault_items "personal-tools" '{
  "GITHUB_TOKEN": "ghp_demo-personal-pat-NOT-A-REAL-TOKEN",
  "DIGITALOCEAN_TOKEN": "dop_v1_demo-do-pat-NOT-A-REAL-TOKEN",
  "NPM_TOKEN": "npm_demo-publish-token-NOT-A-REAL-TOKEN"
}'
echo "  personal-tools: 3 keys"

create_vault "acme-sandbox" "ACME Sandbox Credentials" "$ACME"
add_vault_items "acme-sandbox" '{
  "ACME_API_KEY": "acme-sandbox-demo-NOT-A-REAL-KEY",
  "ACME_WEBHOOK_SECRET": "whsec-acme-demo-NOT-A-REAL-SECRET"
}'
echo "  acme-sandbox: 2 keys"

create_vault "oss-tools" "OSS Project Tooling" "$OSS"
add_vault_items "oss-tools" '{
  "RELEASE_PAT": "ghp_oss-release-automation-NOT-A-REAL-TOKEN",
  "DOCS_DEPLOY_KEY": "demo-vercel-deploy-hook-NOT-A-REAL-KEY"
}'
echo "  oss-tools: 2 keys"

# ---------------------------------------------------------------------------
# Done
# ---------------------------------------------------------------------------

echo
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Demo seeded. Open http://localhost:3000 to explore."
echo
echo "Notable bits:"
echo "  • 4 scopes (Personal + 3 shared)"
echo "  • 8 skills, 3 of which live in multiple scopes (M:N showcase):"
echo "    - git-commit-format      in work-engineering + oss-clawdi"
echo "    - oauth-debugging        in oss-clawdi + Personal"
echo "    - secrets-handling-rules in Personal + work-engineering"
echo "  • 14 memories across 5 categories, spread across scopes"
echo "  • 4 vaults with 11 total keys (demo values; not real secrets)"
echo "  • 3 agents with varied subscriptions:"
echo "    - laptop-home  → Personal + oss-clawdi"
echo "    - work-laptop  → Personal + work-engineering + client-acme"
echo "    - travel-mbp   → Personal + work-engineering"
echo "  • default_write_scope varies by agent (home → Personal, work → work)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
