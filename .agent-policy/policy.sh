#!/usr/bin/env bash
# Shared agent policy. One rule set, enforced for every agent tool.
#   Claude Code -> .claude/hooks/guard.sh            -> this file
#   Copilot     -> .github/hooks/scripts/pre-tool.sh -> this file
#   Hooks       -> .claude/hooks/session-context.sh  -> this file (plan-status)
#
# Usage: policy.sh <kind> <target> [agent-name]
#   kind:   shell | edit | plan-status
#   target: the shell command, or the file path being edited
# Exit 0 = allow. Exit 2 = deny, reason on stderr.
#
# Two folders, two owners:
#   .agent/          agent working memory (state, decisions, plan drafts). Agents may write.
#   .agent-control/  human-owned control and evidence (scope, plan approval, audit log,
#                    failure counts). Agents may read, never write. Hooks write the logs.
#
# GH-600 skills: tool permissions, branch-based scope, scope to repo paths,
# environment constraints, least privilege, block policy violations,
# controlled paths for irreversible changes, traceability.

set -uo pipefail

kind="${1:-}"; target="${2:-}"; agent="${3:-unknown}"
root="${AGENT_REPO_ROOT:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
cd "$root" 2>/dev/null || true

# ---- Policy configuration (edit these for your repo) ----
DEFAULT_BRANCHES_RE='^(main|master)$'
# Plan-first: editing needs a human-approved plan. Anything that changes what agents can do is here.
HIGH_RISK_RE='^(\.github/(workflows|agents|hooks)/|\.github/CODEOWNERS|CODEOWNERS|\.claude/agents/|\.mcp\.json|scripts/|github/|copilot/|infra/|deploy/|src/auth/)'
# Never writable by an agent, by any tool. Matches repo-relative and absolute paths
# (so ~/.claude/settings.json is covered too).
FORBIDDEN_RE='(^|/)(\.env($|\.)|secrets/)|\.(pem|key|p12)$|(^|/)\.claude/(settings(\.local)?\.json|hooks/)|^\.agent-policy/|^\.agent-control/'
# Guardrail paths a shell command must not write to (same list, shell form).
PROTECTED_SHELL_RE='\.claude/(settings|hooks)|\.agent-policy|\.agent-control|\.github/hooks'
# Shell verbs that write, move, delete, or change permissions.
SHELL_WRITE_RE='(>|\btee\b|\bsed\b.*-i|\bperl\b.*-i|\brm\b|\bmv\b|\bcp\b|\bln\b|\bchmod\b|\btruncate\b|\bdd\b|\binstall\b|\bgit[[:space:]]+(checkout|restore|rm|mv)\b|\bpython3?\b|\bnode\b|\bruby\b)'
# Paths any agent may always write (its own working memory).
ALWAYS_WRITABLE_RE='^\.agent/'
# Human-only scripts. Agents cannot run them.
HUMAN_ONLY_SCRIPTS_RE='scripts/(agent/(approve-plan|close-task)|setup/apply-github-settings)\.sh'

branch="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")"

log_block() {
  mkdir -p .agent-control
  jq -nc --arg a "$agent" --arg k "$kind" --arg t "$target" --arg r "$1" --arg b "$branch" \
    '{ts:(now|todate), agent:$a, event:"blocked", kind:$k, target:$t, reason:$r, branch:$b}' \
    >> .agent-control/audit.log 2>/dev/null || true
}
deny() { log_block "$1"; echo "BLOCKED by agent policy: $1" >&2; exit 2; }

on_default=false; [[ "$branch" =~ $DEFAULT_BRANCHES_RE ]] && on_default=true

sha256() { { sha256sum "$1" 2>/dev/null || shasum -a 256 "$1" 2>/dev/null; } | awk '{print $1}'; }

# Approved = a human ran scripts/agent/approve-plan.sh, which stores the plan's hash in
# .agent-control/approval. Any later edit to the plan changes the hash and voids approval.
plan_approved() {
  [[ -f .agent/plan.md && -f .agent-control/approval ]] || return 1
  [[ "$(head -1 .agent-control/approval)" == "$(sha256 .agent/plan.md)" ]]
}

case "$kind" in
  plan-status)
    if [[ ! -f .agent/plan.md ]]; then echo "none"
    elif plan_approved; then echo "approved"
    elif [[ -f .agent-control/approval ]]; then echo "changed-since-approval"
    else echo "not-approved"; fi
    exit 0
    ;;
  shell)
    c="$target"
    grep -qE 'git\s+push\b.*(\s--force(\s|$|-with-lease)|\s-f(\s|$))' <<<"$c" && deny "force push. Use git revert instead of rewriting history."
    grep -qE '\s--no-verify\b' <<<"$c" && deny "--no-verify skips safety checks."
    grep -qE 'gh\s+pr\s+merge\b' <<<"$c" && deny "agents propose, humans merge."
    grep -qE 'gh\s+pr\s+review\b.*--approve' <<<"$c" && deny "an agent cannot approve its own PR."
    grep -qE 'gh\s+(workflow\s+run|api\s.*dispatches)' <<<"$c" && grep -qiE 'deploy' <<<"$c" && deny "deploys are critical risk. Prepare the change; a human runs the deploy."
    grep -qE 'gh\s+(secret|variable)\s+set\b' <<<"$c" && deny "secrets and repo settings are critical risk."
    grep -qE 'gh\s+api\b.*(-X|--method)\s*(PUT|PATCH|DELETE)\b.*repos/[^/]+/[^/]+/(rulesets|environments|branches|actions/permissions)' <<<"$c" && deny "repo settings are critical risk. A human applies them."
    grep -qE '(curl|wget)[^|]*\|\s*(ba|z)?sh\b' <<<"$c" && deny "piping a download into a shell."
    # Push to the default branch: a bare 'main' token or a refspec ending in ':main'. Not 'agent/fix-main-bug'.
    grep -qE 'git\s+push\b.*(\s|:)(refs/heads/)?(main|master)(\s|$)' <<<"$c" && deny "never push to the default branch. Push an agent branch and open a PR."
    grep -qE 'git\s+reset\s+--hard' <<<"$c" && deny "git reset --hard can destroy work. Use git revert."
    grep -qE 'git\s+(rebase|filter-branch|filter-repo)\b' <<<"$c" && deny "history rewrites are not allowed for agents."
    if $on_default && grep -qE 'git\s+(commit|push|merge)\b' <<<"$c"; then
      deny "on '$branch'. Create a branch first: git switch -c agent/<task>"
    fi
    grep -qE '(cat|less|more|head|tail|printenv|env|base64|xxd|source|\.)\s.*(\.env|secrets/|\.pem|\.key)' <<<"$c" && deny "reading secrets."
    grep -qE "$HUMAN_ONLY_SCRIPTS_RE" <<<"$c" && deny "that script is human-only (approval, task close, repo settings)."
    grep -qE 'disableAllHooks' <<<"$c" && deny "turning hooks off is not allowed."
    if grep -qE "$PROTECTED_SHELL_RE" <<<"$c" && grep -qE "$SHELL_WRITE_RE" <<<"$c"; then
      deny "this command would change a guardrail file (.claude settings/hooks, .agent-policy, .agent-control, .github/hooks)."
    fi
    exit 0
    ;;
  edit)
    rel="${target#"$root"/}"; rel="${rel#./}"
    [[ "$rel" =~ $FORBIDDEN_RE ]] && deny "'$rel' is a secret or a guardrail file."
    [[ "$rel" =~ $ALWAYS_WRITABLE_RE ]] && exit 0
    $on_default && deny "on '$branch'. Create a branch before editing: git switch -c agent/<task>"
    if [[ -f .agent-control/scope.txt ]]; then
      ok=false
      while IFS= read -r p || [[ -n "$p" ]]; do
        p="${p%%#*}"; p="$(xargs <<<"$p")"; [[ -z "$p" ]] && continue
        [[ "$rel" == "$p"* ]] && ok=true && break
      done < .agent-control/scope.txt
      $ok || deny "'$rel' is outside this task's scope (.agent-control/scope.txt). Update the plan and ask the human to widen scope."
    fi
    if [[ "$rel" =~ $HIGH_RISK_RE ]] && ! plan_approved; then
      deny "'$rel' is high risk (plan-first). Save the plan to .agent/plan.md and ask the human to run scripts/agent/approve-plan.sh."
    fi
    exit 0
    ;;
  *) exit 0 ;;
esac
