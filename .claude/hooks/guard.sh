#!/usr/bin/env bash
# Claude Code PreToolUse adapter -> shared policy.
# Claude Code: exit 2 blocks the tool call and shows stderr to Claude.
# Fails closed: if jq or the policy is missing, block instead of letting the call through.
command -v jq >/dev/null 2>&1 || { echo "BLOCKED: jq is required by the agent guardrails (brew install jq)." >&2; exit 2; }
input="$(cat)"
tool="$(jq -r '.tool_name // ""' <<<"$input")"
agent="claude:$(jq -r '.agent_type // "main"' <<<"$input")"
policy="${CLAUDE_PROJECT_DIR:-.}/.agent-policy/policy.sh"
export AGENT_REPO_ROOT="${CLAUDE_PROJECT_DIR:-$(pwd)}"
[[ -x "$policy" ]] || { echo "BLOCKED: $policy is missing or not executable." >&2; exit 2; }

case "$tool" in
  Bash)
    exec "$policy" shell "$(jq -r '.tool_input.command // ""' <<<"$input")" "$agent" ;;
  Edit|Write|MultiEdit|NotebookEdit)
    exec "$policy" edit "$(jq -r '.tool_input.file_path // .tool_input.notebook_path // ""' <<<"$input")" "$agent" ;;
esac
exit 0
