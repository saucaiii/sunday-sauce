#!/usr/bin/env bash
# Build an evaluation report for the current agent branch.
# Signals: tests (quantitative), scope match (quantitative), blocked actions and
# tool failures from the audit log (behavioral), plus a checklist for the
# qualitative intent check a human or the reviewer agent fills in.
# GH-600 Domain 4.
#
# Usage: scripts/agent/eval-report.sh [base-branch]   (default: main)
set -uo pipefail
root="$(git rev-parse --show-toplevel)"; cd "$root"
base="${1:-main}"
out=".agent/eval.md"; mkdir -p .agent
sha="$(git rev-parse --short HEAD)"; branch="$(git rev-parse --abbrev-ref HEAD)"

changed="$(git diff --name-only "$base"...HEAD 2>/dev/null || git diff --name-only "$base")"

# Scope signal
if [[ -f .agent/plan.md ]]; then
  scope_out="$(printf '%s\n' "$changed" | scripts/agent/scope-check.sh .agent/plan.md 2>&1)"; scope_rc=$?
else
  scope_out="No .agent/plan.md, scope not checked."; scope_rc=1
fi

# Test signal
test_cmd="${TEST_CMD:-}"
[[ -z "$test_cmd" && -f package.json ]] && test_cmd="npm test --silent"
if [[ -n "$test_cmd" ]]; then
  test_out="$(bash -c "$test_cmd" 2>&1 | tail -15)"; test_rc=${PIPESTATUS[0]}
else
  test_out="No TEST_CMD set and no package.json."; test_rc=1
fi

# Behavioral signals from the audit log (this branch only)
blocked=0; failures=0
if [[ -f .agent-control/audit.log ]]; then
  blocked="$(jq -s --arg b "$branch" '[.[] | select(.event=="blocked" and .branch==$b)] | length' .agent-control/audit.log 2>/dev/null || echo 0)"
  failures="$(jq -s --arg b "$branch" '[.[] | select(.event=="tool_failure" and .branch==$b)] | length' .agent-control/audit.log 2>/dev/null || echo 0)"
fi

verdict="pass"; (( scope_rc != 0 || test_rc != 0 )) && verdict="fail"

{
  echo "# Evaluation: $branch @ $sha"
  echo
  echo "| Signal | Type | Result |"
  echo "| --- | --- | --- |"
  echo "| Tests | quantitative | $([[ $test_rc == 0 ]] && echo pass || echo fail) |"
  echo "| Scope match | quantitative | $([[ $scope_rc == 0 ]] && echo pass || echo fail) |"
  echo "| Files changed | quantitative | $(printf '%s\n' "$changed" | grep -c . ) |"
  echo "| Policy blocks | behavioral | $blocked |"
  echo "| Tool failures | behavioral | $failures |"
  echo "| Intent met | qualitative | _reviewer fills in_ |"
  echo
  echo "**Automated verdict:** $verdict (intent still needs a human or reviewer check)"
  echo
  echo "## Scope"; echo '```'; echo "$scope_out"; echo '```'
  echo "## Tests (last lines)"; echo '```'; echo "$test_out"; echo '```'
  echo "## If it failed, classify the root cause"
  echo "- reasoning error: wrong approach or misread the task -> revise instructions or plan"
  echo "- tool misuse: wrong tool, wrong args, missing permission -> refine tool access"
  echo "- context/environment issue: stale state, missing deps, network -> fix memory or setup steps"
} > "$out"
cat "$out"
[[ "$verdict" == "pass" ]]
