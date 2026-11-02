#!/usr/bin/env bash
# Detect agent conflicts: overlapping file changes across open agent PRs.
# Usage: check-overlap.sh <my-files.txt> <others.json>
#   others.json = [{"number":12,"headRefName":"agent/x","files":["src/a.js"]}, ...]
# Exit 1 if any file in this PR is also changed by another open agent PR.
# GH-600 Domain 5: detect overlapping code changes and duplicated effort.
set -uo pipefail
mine="${1:?my files list}"; others="${2:?others json}"

overlap="$(jq -r --rawfile m "$mine" '
  ($m | split("\n") | map(select(length>0))) as $mf
  | .[] | . as $pr
  | ($pr.files // []) | map(select(. as $f | $mf | index($f))) as $hits
  | select($hits | length > 0)
  | "PR #\($pr.number) (\($pr.headRefName)) also changes: \($hits | join(", "))"
' "$others")"

if [[ -n "$overlap" ]]; then
  echo "Agent conflict detected:"; echo "$overlap"
  echo "Resolve by sequencing these PRs or splitting file ownership."
  exit 1
fi
echo "No overlapping files with other open agent PRs."
