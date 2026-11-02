#!/usr/bin/env bash
# Tag a release. Human-only (the policy blocks agents from running this).
# Refuses unless we are on the default branch, the tree is clean, local is up
# to date with origin, the version matches vX.Y.Z, and the tag does not exist.
# Creates an annotated tag locally and prints the push command. Never pushes.
#
# Usage: scripts/release.sh <version>   # e.g. scripts/release.sh v0.1.0
# Exit codes:
#   2 bad or missing version
#   3 not on the default branch
#   4 working tree dirty
#   5 local not up to date with origin
#   6 tag already exists
#
# macOS bash 3.2 compatible.
# Test hook: when GUARDRAIL_TEST=1 and RELEASE_SKIP_FETCH=1, skip the fetch and
# the up-to-date comparison (the test fixture has no remote). Both variables
# must be set together; either one alone has no effect in production use.
set -euo pipefail

version="${1:-}"
if [ -z "$version" ]; then
  echo "usage: scripts/release.sh <version>   (e.g. v0.1.0)" >&2
  echo "version must match: ^v[0-9]+\.[0-9]+\.[0-9]+\$" >&2
  exit 2
fi
if ! printf '%s' "$version" | grep -Eq '^v[0-9]+\.[0-9]+\.[0-9]+$'; then
  echo "bad version '$version'. Expected pattern: ^v[0-9]+\.[0-9]+\.[0-9]+\$ (e.g. v0.1.0)" >&2
  exit 2
fi

root="$(git rev-parse --show-toplevel)"
cd "$root"

default="$(git symbolic-ref -q --short refs/remotes/origin/HEAD 2>/dev/null || true)"
default="${default#origin/}"
if [ -z "$default" ]; then default="main"; fi

current="$(git rev-parse --abbrev-ref HEAD)"
if [ "$current" != "$default" ]; then
  echo "release.sh: must run on the default branch ('$default'), not '$current'." >&2
  exit 3
fi

if [ -n "$(git status --porcelain)" ]; then
  echo "release.sh: working tree is dirty. Commit or stash first." >&2
  exit 4
fi

if [ "${GUARDRAIL_TEST:-}" = "1" ] && [ "${RELEASE_SKIP_FETCH:-}" = "1" ]; then
  :
else
  if ! git fetch -q origin "$default" 2>/dev/null; then
    echo "release.sh: could not fetch origin/$default." >&2
    exit 5
  fi
  local_sha="$(git rev-parse HEAD)"
  remote_sha="$(git rev-parse "origin/$default" 2>/dev/null || echo "")"
  if [ -z "$remote_sha" ] || [ "$local_sha" != "$remote_sha" ]; then
    echo "release.sh: local '$default' is not up to date with origin/$default." >&2
    exit 5
  fi
fi

if git rev-parse -q --verify "refs/tags/$version" >/dev/null; then
  echo "release.sh: tag '$version' already exists." >&2
  exit 6
fi

git tag -a "$version" -m "Release $version"

echo
echo "Created annotated tag '$version' locally."
echo "Push it when you are ready:"
echo "  git push origin $version"
