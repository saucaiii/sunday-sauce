#!/usr/bin/env bash
# Claude Code PostToolUse (async): audit trail.
# Logs who did what to which target, tied to the current commit.
# Tool output is never logged, so secrets in output stay out.
# A successful call also clears that action's failure count (retries are "in a row").
root="${CLAUDE_PROJECT_DIR:-$(pwd)}"
mkdir -p "$root/.agent-control"
input="$(cat)"
sha="$(git -C "$root" rev-parse --short HEAD 2>/dev/null || echo none)"
branch="$(git -C "$root" rev-parse --abbrev-ref HEAD 2>/dev/null || echo none)"
jq -c --arg sha "$sha" --arg br "$branch" '{
  ts: (now | todate),
  agent: ("claude:" + (.agent_type // "main")),
  session: .session_id,
  event: "tool_use",
  tool: .tool_name,
  target: (.tool_input.command // .tool_input.file_path // .tool_input.pattern // .tool_input.url // null),
  branch: $br,
  commit: $sha
}' <<<"$input" >> "$root/.agent-control/audit.log" 2>/dev/null

counts="$root/.agent-control/failures.json"
if [[ -f "$counts" ]]; then
  key="$(jq -r '.tool_name + ":" + ((.tool_input.command // .tool_input.file_path // "") | tostring | .[0:120])' <<<"$input")"
  jq --arg k "$key" 'del(.[$k])' "$counts" > "$counts.tmp" 2>/dev/null && mv "$counts.tmp" "$counts"
fi
exit 0
