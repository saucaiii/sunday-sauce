#!/usr/bin/env bash
# Copilot errorOccurred: capture the failure for escalation and post-hoc analysis.
here="$(cd "$(dirname "$0")" && pwd)"; source "$here/lib.sh"
read_input
audit error "$(jq -c '{error: (.error // .message // . | tostring | .[0:500])}' <<<"$HOOK_INPUT")"
root="$(repo_root)"
{
  echo ""
  echo "## Escalation needed ($(date -u +%Y-%m-%dT%H:%MZ), copilot)"
  echo "- What failed: $(jq -r '(.error // .message // "see audit.log") | tostring | .[0:300]' <<<"$HOOK_INPUT")"
  echo "- Root cause: (classify: reasoning error | tool misuse | context/environment issue)"
  echo "- Evidence: .agent-control/audit.log, workflow run logs"
} >> "$root/.agent/state.md"
exit 0
