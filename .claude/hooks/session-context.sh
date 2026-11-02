#!/usr/bin/env bash
# Claude Code SessionStart: load durable state so the agent resumes without
# repeating steps or contradicting past decisions. Detects stale context.
# Plain stdout from SessionStart is added to Claude's context.
# GH-600 Domain 3: resume work, detect drift, prevent stale/conflicting context.
root="${CLAUDE_PROJECT_DIR:-$(pwd)}"
cd "$root" 2>/dev/null || exit 0
STALE_DAYS="${AGENT_STATE_STALE_DAYS:-7}"
today="$(date +%Y-%m-%d)"

branch="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo unknown)"
echo "Current branch: $branch"

if [[ -f .agent/state.md ]]; then
  state_branch="$(grep -iE '^branch:' .agent/state.md | head -1 | sed -E 's/^[Bb]ranch:[[:space:]]*//')"
  if [[ -n "$state_branch" && "$state_branch" != "none" && "$state_branch" != "$branch" ]]; then
    echo "WARNING (stale context): state.md is for branch '$state_branch' but you are on '$branch'. Do not trust it. Confirm with the user or rebuild state from git log."
  fi
  age_days=$(( ( $(date +%s) - $(stat -c %Y .agent/state.md 2>/dev/null || stat -f %m .agent/state.md) ) / 86400 ))
  if (( age_days > STALE_DAYS )); then
    echo "WARNING (stale context): state.md is $age_days days old (limit $STALE_DAYS). Re-verify it against the code before relying on it."
  fi
  lines=$(wc -l < .agent/state.md)
  (( lines > 60 )) && echo "NOTE: state.md is $lines lines (limit 60). Prune finished items."
  echo "--- .agent/state.md (short-term memory) ---"
  head -60 .agent/state.md
fi

if [[ -f .agent/decisions.md ]]; then
  # Decisions may carry 'review-by YYYY-MM-DD'. Expired ones must be re-confirmed, not followed blindly.
  expired="$(grep -oE '^- .*review-by [0-9]{4}-[0-9]{2}-[0-9]{2}.*' .agent/decisions.md | while read -r l; do
      d="$(grep -oE 'review-by [0-9-]+' <<<"$l" | awk '{print $2}')"; [[ "$d" < "$today" ]] && echo "$l"; done)"
  [[ -n "$expired" ]] && { echo "EXPIRED decisions (re-confirm with the user before relying on them):"; echo "$expired"; }
  echo "--- recent decisions (long-term memory) ---"
  grep -E '^- ' .agent/decisions.md | tail -15
fi

case "$(AGENT_REPO_ROOT="$root" .agent-policy/policy.sh plan-status 2>/dev/null)" in
  approved) echo "Plan status: APPROVED by a human (approval is tied to the plan's current content)" ;;
  changed-since-approval) echo "Plan status: CHANGED SINCE APPROVAL. High-risk edits are blocked until the human re-approves (scripts/agent/approve-plan.sh)." ;;
  not-approved) echo "Plan status: NOT APPROVED. High-risk edits are blocked until the human runs scripts/agent/approve-plan.sh." ;;
esac

if [[ -f .agent-control/scope.txt ]]; then
  echo "--- allowed edit scope (human-owned, .agent-control/scope.txt) ---"; grep -vE '^\s*(#|$)' .agent-control/scope.txt
fi

# Other agents working in parallel (worktrees) and their scopes, so this agent avoids their files.
git worktree list --porcelain 2>/dev/null | awk '/^worktree /{print $2}' | while read -r wt; do
  [[ "$wt" == "$root" ]] && continue
  [[ -f "$wt/.agent-control/scope.txt" ]] || continue
  echo "Parallel agent in $wt owns: $(grep -vE '^\s*(#|$)' "$wt/.agent-control/scope.txt" | tr '\n' ' ')"
done
exit 0
