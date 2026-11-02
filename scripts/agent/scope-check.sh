#!/usr/bin/env bash
# Compare changed files to the plan's declared scope.
# Input: PR_BODY env (or a plan file as $1), changed file list on stdin.
# Exit 1 if any file is outside scope. Quantitative evaluation signal.
# GH-600 Domain 4: evaluation signals aligned with intent; Domain 2: scope.
set -uo pipefail

if [[ -n "${1:-}" && -f "$1" ]]; then body="$(cat "$1")"; else body="${PR_BODY:-}"; fi
scope_line="$(printf '%s\n' "$body" | grep -iE '\**Scope[^:]*:\**' | head -1 | sed -E 's/.*:\**[[:space:]]*//')"
[[ -z "$scope_line" ]] && { echo "No scope declared in the plan."; exit 1; }

# Prefixes: split on commas/spaces, strip backticks. (while-read, not mapfile: macOS ships bash 3.2)
prefixes=()
while IFS= read -r p; do [[ -n "$p" ]] && prefixes+=("$p"); done < <(tr ',' ' ' <<<"$scope_line" | tr -s ' ' '\n' | tr -d '`')
prefixes+=(".agent/")

out=()
while IFS= read -r f; do
  [[ -z "$f" ]] && continue
  ok=false
  for p in "${prefixes[@]}"; do [[ "$f" == "$p"* ]] && ok=true && break; done
  $ok || out+=("$f")
done

echo "Declared scope: ${prefixes[*]}"
if (( ${#out[@]} )); then
  echo "Files outside scope:"; printf '  - %s\n' "${out[@]}"
  exit 1
fi
echo "All changed files are inside scope."
