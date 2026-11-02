#!/usr/bin/env bash
# Claude Code PostToolUseFailure: bounded retries + escalation.
# Counts consecutive failures per (tool, command). A success clears the count (audit-log.sh).
# Rule from CLAUDE.md: retry at most 2 times, changing something each time.
#   failure 1, 2 -> classify root cause, change something, retry
#   failure 3    -> stop and escalate
# Read-only probes (grep, test, ls, diff, ...) exit non-zero as normal answers, so they are not counted.
input="$(cat)"
root="${CLAUDE_PROJECT_DIR:-$(pwd)}"
mkdir -p "$root/.agent-control"
counts="$root/.agent-control/failures.json"
[[ -f "$counts" ]] || echo '{}' > "$counts"
MAX_RETRIES=2

cmd="$(jq -r '.tool_input.command // ""' <<<"$input")"
if grep -qE '^\s*(grep|rg|egrep|test|\[|ls|find|which|command\s+-v|type|diff|cmp|git\s+(diff|grep|ls-files|rev-parse|show-ref|merge-base)\b)' <<<"$cmd"; then
  exit 0
fi

key="$(jq -r '.tool_name + ":" + ((.tool_input.command // .tool_input.file_path // "") | tostring | .[0:120])' <<<"$input")"
# Fingerprint of the working tree, to tell "retried after a change" from "retried unchanged".
# Covers commits, modified tracked files and new untracked files (gitignored runtime files excluded).
tree="$( { git -C "$root" rev-parse HEAD 2>/dev/null
           git -C "$root" ls-files -z -m -o --exclude-standard 2>/dev/null | (cd "$root" && xargs -0 cat 2>/dev/null)
         } | { shasum 2>/dev/null || sha1sum; } | cut -c1-12)"
prev_tree="$(jq -r --arg k "$key" '.[$k].tree // ""' "$counts")"
n="$(jq -r --arg k "$key" '(.[$k].n // 0) + 1' "$counts")"
jq --arg k "$key" --argjson n "$n" --arg t "$tree" '.[$k] = {n: $n, tree: $t}' "$counts" > "$counts.tmp" && mv "$counts.tmp" "$counts"

agent="claude:$(jq -r '.agent_type // "main"' <<<"$input")"
branch="$(git -C "$root" rev-parse --abbrev-ref HEAD 2>/dev/null || echo none)"
jq -nc --arg a "$agent" --arg k "$key" --argjson n "$n" --arg b "$branch" \
  '{ts:(now|todate), agent:$a, event:"tool_failure", action:$k, count:$n, branch:$b}' >> "$root/.agent-control/audit.log"

if (( n > MAX_RETRIES )); then
  cat >&2 <<EOF
ESCALATE: "$key" has failed $n times in a row. Stop retrying.
Write an escalation note in .agent/state.md with:
  1. What failed (command/check and error)
  2. Root cause category: reasoning error | tool misuse | context/environment issue
  3. What you tried
  4. Evidence (logs, run links)
  5. Suggested next step for the human
Then stop and report to the user.
EOF
  exit 2
fi
if [[ -n "$prev_tree" && "$prev_tree" == "$tree" ]]; then
  echo "Failure $n for \"$key\" and nothing changed since the last attempt. Retrying unchanged is not a retry. Classify the root cause in .agent/state.md and change something first." >&2
else
  echo "Failure $n of $((MAX_RETRIES + 1)) allowed for \"$key\". Classify the root cause in .agent/state.md and change something before retrying." >&2
fi
exit 2
