#!/usr/bin/env bash
# Start an isolated agent task: own branch + own worktree + declared file scope.
# Refuses if the scope overlaps a task already running in another worktree.
# GH-600 Domain 5: agent isolation for parallel execution, conflict prevention.
#
# Usage: scripts/agent/new-task.sh <task-name> <scope-prefix> [scope-prefix...]
#   e.g. scripts/agent/new-task.sh fix-login src/auth/ tests/auth/
set -euo pipefail

task="${1:?task name required}"; shift
(( $# > 0 )) || { echo "Give at least one scope prefix (e.g. src/feature/)" >&2; exit 1; }
[[ "$task" =~ ^[a-z0-9][a-z0-9._-]*$ ]] || { echo "Task name: lowercase letters, digits, . _ - only" >&2; exit 1; }

root="$(git rev-parse --show-toplevel)"
repo="$(basename "$root")"
wt_base="${AGENT_WORKTREE_BASE:-$(dirname "$root")/${repo}-agents}"
wt="$wt_base/$task"
branch="agent/$task"

overlaps() { [[ "$1" == "$2"* || "$2" == "$1"* ]]; }

conflict=0
while read -r other; do
  [[ "$other" == "$root" || ! -f "$other/.agent-control/scope.txt" ]] && continue
  while read -r theirs; do
    theirs="${theirs%%#*}"; theirs="$(xargs <<<"$theirs")"; [[ -z "$theirs" ]] && continue
    for mine in "$@"; do
      if overlaps "$mine" "$theirs"; then
        echo "CONFLICT: '$mine' overlaps '$theirs' owned by the task in $other" >&2; conflict=1
      fi
    done
  done < "$other/.agent-control/scope.txt"
done < <(git worktree list --porcelain | awk '/^worktree /{print $2}')
(( conflict )) && { echo "Run these tasks in sequence, or narrow the scopes." >&2; exit 3; }

mkdir -p "$wt_base"
git worktree add -q -b "$branch" "$wt"
mkdir -p "$wt/.agent" "$wt/.agent-control"
printf '%s\n' "$@" > "$wt/.agent-control/scope.txt"
cat > "$wt/.agent/state.md" <<EOF
# Working memory (short-term). Keep under 60 lines.
Branch: $branch
Task: $task
Status: planning
Started: $(date -u +%Y-%m-%dT%H:%MZ)

## Progress
- Created isolated worktree. Scope: $*

## Handoffs
- (agent -> agent: input, output, result)
EOF
echo "Task '$task' ready."
echo "  worktree: $wt"
echo "  branch:   $branch"
echo "  scope:    $*"
echo "Open your agent in that folder: cd \"$wt\""
