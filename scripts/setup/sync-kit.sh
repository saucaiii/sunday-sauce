#!/usr/bin/env bash
# Sync guardrail and agent files from a gh600-agent-kit checkout into this
# project repo. Human-only (the policy blocks agents from running this).
#
# Opens a chore/sync-kit-<date> branch and copies ONLY the allowlist below.
# Never touches README.md, CODEOWNERS, .agent/, .agent-control/, or source.
# Prints a diff summary and leaves staging and committing to you.
#
# Usage: scripts/setup/sync-kit.sh <path-to-kit>
# Exit codes:
#   2 missing or wrong number of arguments
#   3 kit path does not look like gh600-agent-kit
#   4 current repo working tree is dirty
#   5 not inside a git repository
#
# macOS bash 3.2 compatible.
set -euo pipefail

if [ "$#" -ne 1 ]; then
  echo "usage: scripts/setup/sync-kit.sh <path-to-kit>" >&2
  exit 2
fi

kit_arg="$1"
if [ ! -d "$kit_arg" ]; then
  echo "sync-kit.sh: '$kit_arg' is not a directory." >&2
  exit 3
fi
kit="$(cd "$kit_arg" && pwd)"

# Verify the source looks like gh600-agent-kit.
missing=0
for marker in ".agent-policy/policy.sh" "CLAUDE.md" "scripts/agent/new-task.sh"; do
  if [ ! -e "$kit/$marker" ]; then
    echo "sync-kit.sh: missing '$marker' in '$kit'; this does not look like gh600-agent-kit." >&2
    missing=1
  fi
done
if [ "$missing" -ne 0 ]; then
  exit 3
fi

# Project repo root.
if ! project="$(git rev-parse --show-toplevel 2>/dev/null)"; then
  echo "sync-kit.sh: run this from inside a git repository (not a kit checkout)." >&2
  exit 5
fi
cd "$project"

if [ "$project" = "$kit" ]; then
  echo "sync-kit.sh: refusing to sync a repo into itself (project path equals kit path)." >&2
  exit 3
fi

if [ -n "$(git status --porcelain)" ]; then
  echo "sync-kit.sh: working tree is dirty. Commit or stash first." >&2
  exit 4
fi

# Open or switch to today's sync branch.
branch="chore/sync-kit-$(date -u +%Y%m%d)"
if git show-ref --verify --quiet "refs/heads/$branch"; then
  git switch -q "$branch"
else
  git switch -q -c "$branch"
fi

# Allowlist. Directories end with '/'. Everything else is a single file.
dirs="
.agent-policy/
.claude/
.github/agents/
.github/hooks/
.github/workflows/
scripts/agent/
scripts/setup/
github/
copilot/
"

files="
.github/pull_request_template.md
docs/kit.md
docs/exam-map.md
docs/agent-lifecycle.md
tests/guardrails.sh
"

use_rsync=0
if command -v rsync >/dev/null 2>&1; then
  use_rsync=1
fi

copy_dir() {
  src="$1"; dest="$2"
  if [ ! -d "$src" ]; then
    echo "  skip (missing in kit): $dest"
    return
  fi
  mkdir -p "$dest"
  if [ "$use_rsync" -eq 1 ]; then
    rsync -a --delete "$src/" "$dest/"
  else
    rm -rf "$dest"
    mkdir -p "$(dirname "$dest")"
    cp -R "$src" "$dest"
  fi
  echo "  dir : $dest"
}

copy_file() {
  src="$1"; dest="$2"
  if [ ! -f "$src" ]; then
    echo "  skip (missing in kit): $dest"
    return
  fi
  mkdir -p "$(dirname "$dest")"
  cp "$src" "$dest"
  echo "  file: $dest"
}

echo "Syncing from: $kit"
echo "Into project: $project"
echo "On branch:    $branch"
echo

echo "Copying directories:"
echo "$dirs" | while IFS= read -r d; do
  [ -z "$d" ] && continue
  d="${d%/}"
  copy_dir "$kit/$d" "$project/$d"
done

echo "Copying files:"
echo "$files" | while IFS= read -r f; do
  [ -z "$f" ] && continue
  copy_file "$kit/$f" "$project/$f"
done

echo
echo "Diff summary (git status --porcelain, grouped by top-level path):"
summary="$(git status --porcelain | awk '{
  code=$1
  path=$2
  n=split(path, parts, "/")
  top=parts[1]
  if (code=="??") a[top]++
  else if (code ~ /D/) d[top]++
  else m[top]++
}
END {
  for (k in a) print k": "a[k]" added"
  for (k in m) print k": "m[k]" modified"
  for (k in d) print k": "d[k]" removed"
}')"
if [ -z "$summary" ]; then
  echo "  (no changes)"
else
  echo "$summary" | sed 's/^/  /'
fi

echo
echo "Next steps:"
echo "  1. Review the diff: git diff"
echo "  2. Stage and commit on $branch:"
echo "       git add -A"
echo "       git commit -m 'chore: sync gh600-agent-kit'"
echo "  3. Open a PR into your default branch."
echo
echo "This script never touches README.md, CODEOWNERS, .agent/, .agent-control/, or source."
