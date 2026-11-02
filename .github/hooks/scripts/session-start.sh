#!/usr/bin/env bash
# Copilot sessionStart: record the session start for traceability.
# Context loading for Copilot comes from .github/copilot-instructions.md,
# which tells the agent to read .agent/ files first.
here="$(cd "$(dirname "$0")" && pwd)"; source "$here/lib.sh"
read_input
audit session_start "$(jq -c '{session: (.sessionId // .session_id // null)}' <<<"$HOOK_INPUT")"
exit 0
