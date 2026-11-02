#!/usr/bin/env bash
# Post-hoc analysis of agent behavior from .agent-control/audit.log.
# Shows activity per agent, what was blocked and why, repeated failures,
# and sessions with errors. Works across Claude Code and Copilot entries.
# GH-600 Domain 5: post-hoc analysis; Domain 6: accountability.
#
# Usage: scripts/agent/audit-report.sh [audit.log]
set -uo pipefail
log="${1:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)/.agent-control/audit.log}"
[[ -s "$log" ]] || { echo "No audit entries in $log"; exit 0; }

echo "# Agent audit report"
echo "Entries: $(wc -l < "$log")  |  From: $(jq -rs 'map(.ts)|min' "$log")  To: $(jq -rs 'map(.ts)|max' "$log")"
echo
echo "## Activity by agent and event"
jq -rs 'group_by(.agent) | .[] | "- \(.[0].agent): " + (group_by(.event) | map("\(.[0].event)=\(length)") | join(", "))' "$log"
echo
echo "## Blocked actions (policy working)"
jq -rs '[.[] | select(.event=="blocked")] | if length==0 then "- none" else .[] | "- \(.ts) \(.agent): \(.reason)" end' "$log"
echo
echo "## Repeated failures (escalation candidates)"
jq -rs '[.[] | select(.event=="tool_failure")] | group_by(.action) | map({a:.[0].action, n:length}) | map(select(.n>=2)) | if length==0 then "- none" else .[] | "- \(.n)x \(.a)" end' "$log"
echo
echo "## Errors"
jq -rs '[.[] | select(.event=="error")] | if length==0 then "- none" else .[] | "- \(.ts) \(.agent): \(.error)" end' "$log"
echo
echo "## Commits touched"
jq -rs '[.[] | .commit // empty] | unique | join(", ")' "$log"
