#!/usr/bin/env bash
# Human approval of the agent's plan (GH-600 Domain 1: prevent action until the plan is
# checked and approved; Domain 6: explicit authorization for high-risk changes).
#
# Stores the plan's SHA-256 in .agent-control/approval. The policy only treats the plan as
# approved while .agent/plan.md still has that exact hash, so any later edit voids approval.
# Agents cannot run this script (policy blocks it) and it needs an interactive terminal.
#
# Usage: scripts/agent/approve-plan.sh            # review, then type "approve"
#        scripts/agent/approve-plan.sh --revoke   # withdraw approval
set -euo pipefail
root="$(git rev-parse --show-toplevel)"; cd "$root"
mkdir -p .agent-control

audit() {
  jq -nc --arg e "$1" --arg u "$(git config user.email || whoami)" --arg h "${2:-}" \
    '{ts:(now|todate), agent:"human", event:$e, by:$u, plan_sha256:$h}' >> .agent-control/audit.log
}

if [[ "${1:-}" == "--revoke" ]]; then
  rm -f .agent-control/approval; audit plan_revoked; echo "Approval revoked."; exit 0
fi

[[ -f .agent/plan.md ]] || { echo "No .agent/plan.md to approve." >&2; exit 1; }
[[ -t 0 ]] || { echo "Approval needs an interactive terminal. Run it yourself, not through an agent." >&2; exit 1; }

hash="$( { sha256sum .agent/plan.md 2>/dev/null || shasum -a 256 .agent/plan.md; } | awk '{print $1}')"
echo "----- .agent/plan.md -----"
cat .agent/plan.md
echo "--------------------------"
grep -qiE '^\**Risk\**:\**[[:space:]]*(high|critical)' .agent/plan.md && echo "This plan is HIGH/CRITICAL risk. Check scope, success criteria and rollback before approving."
read -r -p 'Type "approve" to approve this exact plan: ' answer
[[ "$answer" == "approve" ]] || { echo "Not approved."; exit 1; }

printf '%s\n# approved by %s at %s\n' "$hash" "$(git config user.email || whoami)" "$(date -u +%Y-%m-%dT%H:%MZ)" > .agent-control/approval
audit plan_approved "$hash"
echo "Approved. Any edit to .agent/plan.md voids this approval."
