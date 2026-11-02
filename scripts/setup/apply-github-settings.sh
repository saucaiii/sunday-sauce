#!/usr/bin/env bash
# Apply the platform guardrails with the GitHub CLI.
# Dry run by default. Add --apply to make changes.
#
#   scripts/setup/apply-github-settings.sh owner/repo --solo           # show what would happen
#   scripts/setup/apply-github-settings.sh owner/repo --solo --apply   # do it
#
# Pick one profile:
#   --solo  You are the only human. GitHub never lets a PR author approve their own PR, and
#           agents open PRs with your login, so required approvals would lock you out.
#           Solo keeps: PR required, all checks required, no force push/deletion.
#           The human gate is the plan approval + you pressing Merge (agents cannot merge).
#   --team  Another person reviews. Adds 1 approval, code owner review, last-push approval.
#           Also the right choice if agents use their own bot identity (then you approve their PRs).
#
# Needs: gh auth login (admin on the repo), jq.
# Creates: main ruleset, production environment with you as required reviewer,
# read-only default GITHUB_TOKEN, secret scanning + push protection (where available).
set -euo pipefail
repo=""; apply=false; profile=""
for a in "$@"; do
  case "$a" in
    --apply) apply=true ;;
    --solo) profile=solo ;;
    --team) profile=team ;;
    *) repo="$a" ;;
  esac
done
[[ -n "$repo" && -n "$profile" ]] || { echo "Usage: $0 owner/repo --solo|--team [--apply]" >&2; exit 1; }
here="$(cd "$(dirname "$0")" && pwd)"; root="$(cd "$here/../.." && pwd)"
ruleset="$root/github/ruleset-main.json"; [[ "$profile" == solo ]] && ruleset="$root/github/ruleset-main.solo.json"

run() {
  echo "+ $*"
  if $apply; then "$@"; fi
}

me_id="$(gh api user --jq .id)"
me="$(gh api user --jq .login)"
echo "Repo: $repo   Required reviewer for production: $me   Mode: $($apply && echo APPLY || echo DRY-RUN)"
echo

echo "# 1. Ruleset on the default branch ($profile profile: PR required, required checks, no force push)"
run gh api -X POST "repos/$repo/rulesets" --input "$ruleset"

echo "# 2. production environment: required reviewer + only protected branches can deploy"
env_body="$(jq -nc --argjson id "$me_id" '{
  wait_timer: 0,
  prevent_self_review: false,
  reviewers: [{type: "User", id: $id}],
  deployment_branch_policy: {protected_branches: true, custom_branch_policies: false}
}')"
echo "  body: $env_body"
if $apply; then echo "$env_body" | gh api -X PUT "repos/$repo/environments/production" --input -; fi

echo "# 3. Default GITHUB_TOKEN is read-only; Actions cannot approve PRs"
run gh api -X PUT "repos/$repo/actions/permissions/workflow" \
  -f default_workflow_permissions=read -F can_approve_pull_request_reviews=false

echo "# 4. Secret scanning + push protection"
run gh api -X PATCH "repos/$repo" --input - <<'EOF' 2>/dev/null || echo "  (skipped: may need GitHub Advanced Security / public repo)"
{"security_and_analysis":{"secret_scanning":{"status":"enabled"},"secret_scanning_push_protection":{"status":"enabled"}}}
EOF

echo
echo "Manual steps (no stable API, do these in the UI):"
echo "  - Settings > Copilot > Cloud agent > MCP: paste copilot/mcp-config.json; add secret COPILOT_MCP_GITHUB_PERSONAL_ACCESS_TOKEN in the 'copilot' environment"
echo "  - Settings > Copilot > Cloud agent: review the firewall allowlist"
echo "  - Settings > Actions > General: require approval for workflow runs from bots and outside collaborators"
echo "  - Settings > Code security: enable CodeQL default setup or keep ci.yml's codeql job"
$apply || echo; $apply || echo "Dry run only. Re-run with --apply to make these changes."
