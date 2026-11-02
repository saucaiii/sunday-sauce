# Agent lifecycle: add, update, retire

GH-600 Domain 5: manage agents in multi-agent workflows without disrupting active work and while keeping auditability.

Agent definitions live in version control: `.github/agents/*.agent.md` (Copilot) and `.claude/agents/*.md` (Claude Code). Copilot versions an agent profile by the Git commit SHA of its file, so every change is traceable to a commit and a reviewed PR.

Each Copilot profile carries `metadata` with `owner`, `version`, `status`, and `risk`.

## Add an agent

1. Open a PR that adds the profile. This is **high risk** (CODEOWNERS routes it for review).
2. Start with the smallest tool list. Read-only unless the job requires edits.
3. Set `disable-model-invocation: true` for agents that should only run when a person picks them.
4. Define its handoff artifact (what it outputs, where) and add it to the Multi-agent table in `CLAUDE.md`.
5. Pilot: run it on one low-risk task, check `scripts/agent/audit-report.sh` for blocks and failures, then mark `status: active`.

## Update or replace an agent without disrupting active work

1. Bump `version` in metadata. Explain the change in the PR (tools added/removed, prompt changes).
2. Tool list changes are high risk. Widening tools needs a reason in the plan.
3. Running tasks keep the version they started with: they are on branches cut before the change. New tasks pick up the new version after merge.
4. To replace: add the new agent first (`status: active`), switch the orchestrator and docs to it, then retire the old one. Never delete first.

## Retire an agent

1. Set `status: retired`, `user-invocable: false`, and `disable-model-invocation: true`. The file stays, so past audit entries still resolve to a definition.
2. Remove it from the orchestrator and the Multi-agent table.
3. After all PRs that used it are closed, you may delete the file. Git history keeps the record.
4. Record the retirement in `.agent/decisions.md`.

## Health signals (check weekly)

- `scripts/agent/audit-report.sh`: blocks per agent, repeated failures, errors.
- Stalled agents: a task branch with no commits or state updates for 2+ days.
- Degraded behavior: rising block counts or repeated failures for one agent means tune its instructions or tools, or retire it.
