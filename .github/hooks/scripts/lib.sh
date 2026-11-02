#!/usr/bin/env bash
# Shared helpers for Copilot hook scripts.
# Copilot sends camelCase JSON on stdin: sessionId, timestamp, cwd, toolName, toolArgs.
# toolArgs can arrive as a JSON-encoded string, so normalize it to an object.

read_input() { HOOK_INPUT="$(cat)"; }

tool_name() { jq -r '.toolName // .tool_name // ""' <<<"$HOOK_INPUT"; }

tool_args() {
  jq -c '(.toolArgs // .tool_input // {}) | if type == "string" then (try fromjson catch {raw: .}) else . end' <<<"$HOOK_INPUT"
}

repo_root() { git rev-parse --show-toplevel 2>/dev/null || pwd; }

audit() {  # audit <event> <json-extra>
  local root; root="$(repo_root)"; mkdir -p "$root/.agent-control"
  local sha; sha="$(git -C "$root" rev-parse --short HEAD 2>/dev/null || echo none)"
  local x="${2:-}"; [[ -z "$x" ]] && x='{}'
  jq -nc --arg e "$1" --arg sha "$sha" --argjson x "$x" \
    '{ts:(now|todate), agent:"copilot", event:$e, commit:$sha} + $x' >> "$root/.agent-control/audit.log" 2>/dev/null || true
}
