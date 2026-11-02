#!/usr/bin/env bash
# Copilot postToolUse: audit trail of every tool call (no tool output logged).
here="$(cd "$(dirname "$0")" && pwd)"; source "$here/lib.sh"
read_input
args="$(tool_args)"
audit tool_use "$(jq -nc --arg t "$(tool_name)" --argjson a "$args" \
  '{tool:$t, target:($a.command // $a.path // $a.file_path // null)}')"
exit 0
