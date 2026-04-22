#!/usr/bin/env bash
# verify-scope-acl.sh
# Demonstrates: single user, 2 envs, 2 scopes, skill only visible to subscribed env.
#
# Prereqs:
#   - docker compose up -d postgres
#   - backend running: cd backend && pdm dev
#   - CLAWDI_TOKEN env var is a valid API key for a user

set -euo pipefail

API="${API:-http://localhost:8000}"

if [[ -z "${CLAWDI_TOKEN:-}" ]]; then
	echo "Set CLAWDI_TOKEN to a valid API key (see docs/prototype-scope-foundation.md)"
	exit 1
fi

jqfield() {
	python3 -c "import sys, json; print(json.load(sys.stdin)[sys.argv[1]])" "$1"
}

# Unique suffix per run so repeated runs don't clash with prior state.
STAMP=$(date +%s)

echo "== Creating env_A (claude_code on laptop-A-$STAMP) =="
ENV_A=$(curl -sS -X POST "$API/api/environments" \
	-H "Authorization: Bearer $CLAWDI_TOKEN" \
	-H "Content-Type: application/json" \
	-d "{\"machine_id\":\"laptop-A-$STAMP\",\"machine_name\":\"Laptop A\",\"agent_type\":\"claude_code\",\"os\":\"darwin\"}" \
	| jqfield id)
echo "ENV_A=$ENV_A"

echo "== Creating env_B (codex on laptop-B-$STAMP) =="
ENV_B=$(curl -sS -X POST "$API/api/environments" \
	-H "Authorization: Bearer $CLAWDI_TOKEN" \
	-H "Content-Type: application/json" \
	-d "{\"machine_id\":\"laptop-B-$STAMP\",\"machine_name\":\"Laptop B\",\"agent_type\":\"codex\",\"os\":\"darwin\"}" \
	| jqfield id)
echo "ENV_B=$ENV_B"

echo "== Creating scope work-$STAMP =="
SCOPE_WORK=$(curl -sS -X POST "$API/api/scopes" \
	-H "Authorization: Bearer $CLAWDI_TOKEN" \
	-H "Content-Type: application/json" \
	-d "{\"name\":\"work-$STAMP\"}" | jqfield id)
echo "SCOPE_WORK=$SCOPE_WORK"

echo "== Creating scope personal-$STAMP =="
SCOPE_PERSONAL=$(curl -sS -X POST "$API/api/scopes" \
	-H "Authorization: Bearer $CLAWDI_TOKEN" \
	-H "Content-Type: application/json" \
	-d "{\"name\":\"personal-$STAMP\"}" | jqfield id)
echo "SCOPE_PERSONAL=$SCOPE_PERSONAL"

echo "== Subscribing env_A to work =="
curl -sS -X POST "$API/api/environments/$ENV_A/scopes/$SCOPE_WORK" \
	-H "Authorization: Bearer $CLAWDI_TOKEN"
echo

echo "== Subscribing env_B to personal =="
curl -sS -X POST "$API/api/environments/$ENV_B/scopes/$SCOPE_PERSONAL" \
	-H "Authorization: Bearer $CLAWDI_TOKEN"
echo

echo "== Uploading skill 'python-style-$STAMP' in scope work =="
TMP=$(mktemp -d)
cat > "$TMP/SKILL.md" <<MD
---
name: python-style-$STAMP
description: Sample Python style skill for prototype verification
---
# Python Style
Test skill body.
MD
tar -czf "$TMP/skill.tar.gz" -C "$TMP" SKILL.md

curl -sS -X POST "$API/api/skills/upload" \
	-H "Authorization: Bearer $CLAWDI_TOKEN" \
	-F "skill_key=python-style-$STAMP" \
	-F "scope_id=$SCOPE_WORK" \
	-F "file=@$TMP/skill.tar.gz"
echo

echo ""
echo "== TEST 1: env_A (subscribed to work) should SEE the skill =="
LIST_A=$(curl -sS "$API/api/skills" \
	-H "Authorization: Bearer $CLAWDI_TOKEN" \
	-H "X-Clawdi-Environment-Id: $ENV_A")
if echo "$LIST_A" | grep -q "python-style-$STAMP"; then
	echo "PASS"
else
	echo "FAIL: env_A should see python-style-$STAMP"
	echo "$LIST_A"
	exit 1
fi

echo ""
echo "== TEST 2: env_B (not subscribed to work) should NOT see the skill =="
LIST_B=$(curl -sS "$API/api/skills" \
	-H "Authorization: Bearer $CLAWDI_TOKEN" \
	-H "X-Clawdi-Environment-Id: $ENV_B")
if echo "$LIST_B" | grep -q "python-style-$STAMP"; then
	echo "FAIL: env_B should NOT see python-style-$STAMP"
	echo "$LIST_B"
	exit 1
else
	echo "PASS"
fi

echo ""
echo "== TEST 3: subscribing env_B to work now makes it visible =="
curl -sS -X POST "$API/api/environments/$ENV_B/scopes/$SCOPE_WORK" \
	-H "Authorization: Bearer $CLAWDI_TOKEN" > /dev/null
echo "  subscribed"

LIST_B2=$(curl -sS "$API/api/skills" \
	-H "Authorization: Bearer $CLAWDI_TOKEN" \
	-H "X-Clawdi-Environment-Id: $ENV_B")
if echo "$LIST_B2" | grep -q "python-style-$STAMP"; then
	echo "PASS"
else
	echo "FAIL: after subscribing, env_B should see python-style-$STAMP"
	echo "$LIST_B2"
	exit 1
fi

echo ""
echo "ALL TESTS PASSED"
