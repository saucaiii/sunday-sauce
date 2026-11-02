#!/usr/bin/env bash
# Copilot preToolUse adapter -> shared policy (.agent-policy/policy.sh).
# Copilot: a preToolUse command hook that exits non-zero denies the tool call.
# We also print a permissionDecision so the reason is visible.
# Fails closed: without jq or the policy, deny instead of letting the call through.
command -v jq >/dev/null 2>&1 || { echo '{"permissionDecision":"deny","permissionDecisionReason":"jq is required by the agent guardrails"}'; exit 2; }
here="$(cd "$(dirname "$0")" && pwd)"; source "$here/lib.sh"
read_input
name="$(tool_name | tr '[:upper:]' '[:lower:]')"
args="$(tool_args)"
root="$(repo_root)"; export AGENT_REPO_ROOT="$root"
policy="$root/.agent-policy/policy.sh"
[[ -x "$policy" ]] || { jq -nc '{permissionDecision:"deny", permissionDecisionReason:"agent policy missing or not executable"}'; exit 2; }

kind=""; target=""
case "$name" in
  bash|shell|execute|powershell)
    kind=shell; target="$(jq -r '.command // .raw // ""' <<<"$args")" ;;
  edit|write|create|str_replace|str_replace_editor|multiedit|notebookedit)
    kind=edit;  target="$(jq -r '.path // .file_path // .filePath // ""' <<<"$args")" ;;
  *) exit 0 ;;
esac
[[ -z "$target" ]] && exit 0

if reason="$("$policy" "$kind" "$target" copilot 2>&1 >/dev/null)"; then
  exit 0
fi
jq -nc --arg r "$reason" '{permissionDecision:"deny", permissionDecisionReason:$r}'
echo "$reason" >&2
exit 2
