# GH-600 agent guardrail kit (v3)

Drop this into a repo so Claude Code and GitHub Copilot agents follow the GH-600 skills outline while you build. Every one of the 65 skills in the [official study guide](https://learn.microsoft.com/en-us/credentials/certifications/resources/study-guides/gh-600) (checked October 2026) is mapped to a file in [`exam-map.md`](exam-map.md).

GH-600 certifies people, not code, so no repo can be "certified compliant". This kit makes your day-to-day agent workflow practise every skill the exam measures, with the guardrails actually enforced.

**Three layers.** Instructions guide. Tool limits and gates enforce.

| Layer | What | Can an agent get around it? |
| --- | --- | --- |
| Guidance | `CLAUDE.md`, `.github/copilot-instructions.md`, agent prompts | Yes |
| Local enforcement | One policy (`.agent-policy/policy.sh`) called by Claude Code hooks and Copilot hooks; tool allowlists | Only by running without the hooks |
| Platform enforcement | Ruleset, required checks, CODEOWNERS, environments | No |

## What's in v3

| Area | Files |
| --- | --- |
| Shared policy | `.agent-policy/policy.sh` (one rule set for every agent, file edits and shell commands) |
| Human control | `.agent-control/` (scope, plan approval, audit log): agents read, never write. `scripts/agent/approve-plan.sh` binds approval to the plan's hash |
| Claude Code | `.claude/settings.json`, `.claude/hooks/` (guard, audit, failure/escalation, session context), `.claude/agents/`, `.mcp.json` |
| Copilot | `.github/hooks/guardrails.json` + scripts, `.github/agents/*.agent.md` (planner, implementer, reviewer, orchestrator), `copilot/mcp-config.json`, `.github/copilot-instructions.md` |
| CI checks | `ci.yml` (tests + CodeQL + evidence artifacts), `plan-gate.yml` (plan, scope, high-risk declaration), `agent-conflicts.yml` |
| Agent in CI | `agent-ci.yml`: Copilot CLI plans an issue with read-only tools, 2 retries, escalation, evidence |
| Deploys | `deploy.yml`: human-only, `production` environment approval, explicit SHA/tag, rollback by redeploy |
| Platform as code | `github/ruleset-main.json` (team), `github/ruleset-main.solo.json` (solo), `scripts/setup/apply-github-settings.sh` |
| Multi-agent | `scripts/agent/new-task.sh` (worktree isolation), `check-overlap.sh`, `orchestrator.agent.md` |
| Memory | `.agent/` files, `session-context.sh` stale checks, `close-task.sh` |
| Evaluation | `scripts/agent/eval-report.sh`, `scope-check.sh`, reviewer agents |
| Post-hoc analysis | `scripts/agent/audit-report.sh` |
| Lifecycle | `agent-lifecycle.md` |
| Responsible AI | `CLAUDE.md` section, PR template checklist |
| Self-test | `tests/guardrails.sh` (105 checks, runs on macOS bash 3.2) |

## Install

```bash
cp -r gh600-agent-kit-v3/. your-repo/
cd your-repo
chmod +x .agent-policy/*.sh .claude/hooks/*.sh .github/hooks/scripts/*.sh scripts/agent/*.sh scripts/setup/*.sh tests/*.sh
tests/guardrails.sh   # should end with Failed: 0
```

1. Needs `jq` and `git` (`brew install jq`).
2. Replace `@your-handle` in `.github/CODEOWNERS` and the agent `metadata.owner`.
3. Not a Node repo? Change the `npm` commands in `ci.yml`, `copilot-setup-steps.yml`, and `.claude/settings.json`.
4. Edit the path patterns at the top of `.agent-policy/policy.sh` to match your repo's high-risk areas.
5. Commit to the default branch. Copilot only reads hooks and agents from the default branch.
6. Platform settings: `scripts/setup/apply-github-settings.sh owner/repo --solo` (dry run), then add `--apply`. Use `--solo` if you are the only human: GitHub never lets a PR's author approve it, and agents open PRs under your login, so the team profile's required approval would block every merge. Use `--team` when someone else reviews, or when agents run under their own bot account.
7. Manual settings the script prints (Copilot MCP config, firewall, bot workflow approvals).

Secrets to create:
- `GITHUB_MCP_PAT` in your shell, for Claude Code's GitHub MCP server (fine-grained, read-only, this repo only).
- `COPILOT_MCP_GITHUB_PERSONAL_ACCESS_TOKEN` in the repo's `copilot` environment, for Copilot's MCP config.
- `COPILOT_CLI_TOKEN` as an Actions secret, for `agent-ci.yml` (fine-grained PAT with "Copilot Requests").

## Daily use

```bash
scripts/agent/new-task.sh fix-login src/auth/ tests/auth/   # isolated branch + worktree + scope
cd ../your-repo-agents/fix-login && claude                  # or assign the issue to Copilot
# agent plans -> you run scripts/agent/approve-plan.sh for high-risk -> agent implements
scripts/agent/eval-report.sh                                # signals before the PR
scripts/agent/audit-report.sh                               # what agents did, blocks, failures
scripts/agent/close-task.sh --remove-worktree               # archive + reset memory
```

## Tested

`tests/guardrails.sh` runs 105 checks against a throwaway repo: every policy rule through both adapters (Claude and Copilot input formats), guardrail tamper attempts by file and by shell, plan approval binding, scope, fail-closed behaviour, retries and escalation, audit logging, session context, scope check on bash 3.2, and JSON/shell syntax. All pass on macOS (bash 3.2). Workflow YAML parses; `actionlint` was not run.

**Not tested live:** a real Claude Code session, a real Copilot cloud agent run, and real GitHub API calls. Run them in your gh600-lab repo first.

## Things to verify against GitHub docs before relying on them

- **Copilot hook deny output:** the kit prints `permissionDecision: "deny"` and exits non-zero. GitHub's docs confirm non-zero exit denies. The exact name of the reason field wasn't visible in the docs I could read.
- **GitHub MCP tool names** in `copilot/mcp-config.json` and agent `tools` lists: the server's tool names change between versions. Check the current list and update the allowlist.
- **MCP registry and allowlist** (`copilot/managed-settings.example.json`): enterprise features. On a personal account, the `tools` allowlist in `mcp-config.json` is your control.

## Limits

- On a free personal account, rulesets, environment reviewers, and code scanning uploads only work on **public** repos (the API returns 403 "Upgrade to GitHub Pro or make this repository public"). Private repos need GitHub Pro or higher for the platform layer.
- Hooks run where the agent runs. A person or tool without them is stopped only by the GitHub layer. Turn that on first.
- `policy.sh` pattern-matches commands. It catches mistakes, not a determined attacker. The ruleset is the real wall.
- Plan approval is enforced locally (hash in `.agent-control/approval`, written only by `approve-plan.sh` from an interactive terminal). On GitHub, the human gate is PR review (team) or you pressing Merge (solo).
- In the solo profile GitHub cannot tell you from an agent using your login. Agents are stopped from merging by the local policy, not by GitHub. For a platform-level wall, give agents their own bot account and use `--team`.
- Action SHAs were pinned on 2026-10-27. Update them deliberately (e.g. with Dependabot), not by moving back to tags.
