# Agent rules for this repo

Single source of truth for every agent here (Claude Code reads this file; Copilot is pointed to it by `.github/copilot-instructions.md`).
Built from the GitHub Certified: Agentic AI Developer (GH-600) skills outline.

**Core principle: agents propose, humans and policy accept.**
This file is guidance. Enforcement lives in `.agent-policy/policy.sh` (called by both Claude Code and Copilot hooks), tool allowlists, and GitHub rulesets.

## Workflow for every task

1. **Load state.** Read `.agent/state.md` and `.agent/decisions.md`. Do not repeat finished steps or contradict a decision. Re-confirm decisions past their `review-by` date.
2. **Classify risk** with the table below.
3. **Plan.** Use the read-only `planner` subagent. Save to `.agent/plan.md` with: Risk, Goal, Scope, Steps, Success criteria, Risks + mitigations, Rollback / escalation.
4. **Gate.** High or critical: stop and ask the human to run `scripts/agent/approve-plan.sh`. It records the plan's hash in `.agent-control/approval`; the policy blocks high-risk edits until then, and any later edit to the plan voids the approval.
5. **Isolate.** Work on `agent/<task>`. For parallel work the human runs `scripts/agent/new-task.sh <task> <scope...>`, which gives each task its own branch, worktree, and scope.
6. **Implement** only inside `.agent-control/scope.txt` (human-owned; you cannot edit it). Need more: stop, update the plan, ask the human.
7. **Validate.** Run tests, then `scripts/agent/eval-report.sh`, then the `reviewer` subagent.
8. **Record.** Progress and handoffs in `.agent/state.md`. Decisions in `.agent/decisions.md`.
9. **Propose.** Push the branch, open a **draft** PR with the template filled in, including Evidence. Never merge, never approve.
10. **Close.** The human runs `scripts/agent/close-task.sh`, which archives and resets short-term memory.

## Branches and commits

Everyday repo hygiene, applied to humans and agents alike. The guardrails elsewhere in this file still enforce agent-specific rules on top of this.

- **Branch prefixes.**
  - Humans use `feature/`, `fix/`, `chore/`, `docs/` (one topic per branch).
  - Agents stay on `agent/<task>` (see step 5 above). Claude Code may also use `claude/*` and Copilot may also use `copilot/*`; those prefixes keep agent origin visible per the Transparency bullet in Responsible AI.
  - `main` is the integration branch. Nothing is committed directly to `main`.
- **Short-lived.** One feature per branch. Open a PR as soon as there is something to review, merge when it is green, and delete the branch after merge.
- **Conventional Commits for everyone.** Message format: `type: imperative summary`, where `type` is one of `feat`, `fix`, `refactor`, `chore`, `docs`, or `test`. The summary line is under 72 characters. No `wip`, `updates`, `stuff`, or similar. A breaking change adds `!` after the type (for example `feat!: rename public config key`) and explains it in the body.
- **Tags are human-only.** Stable versions get an annotated tag through `scripts/release.sh <version>` (default branch, clean tree, up to date, `vX.Y.Z`). The script prints the push command rather than pushing. Agents must not run it; the policy and this file both block it.
- **Downstream sync.** A project repo created from this kit pulls kit updates with `scripts/setup/sync-kit.sh <path-to-kit>`, which opens a `chore/sync-kit-<date>` branch and copies only guardrail and agent files. It never touches the project's `README.md`, `CODEOWNERS`, or source. Human-only like `release.sh`.

## Risk and autonomy

Classify every action on three axes and take the **highest**:
- **Operational:** can it break the build, a deploy, or other people's work? Is it reversible?
- **Security:** does it touch auth, secrets, permissions, agent tools, MCP servers, or hooks?
- **Compliance:** does it touch personal data, money, licences, audit evidence, or Responsible AI rules?

| Risk | Paths / actions | Autonomy |
| --- | --- | --- |
| Low | `docs/`, formatting, comments | Plan + execute in one PR. May use auto-merge (it still waits for every required check and review). |
| Medium | `src/`, tests, dependency bumps | Plan + execute. A human reviews and merges. |
| High | `.github/workflows|agents|hooks/`, `.claude/agents/`, `.mcp.json`, `scripts/`, `github/`, `copilot/`, `infra/`, `src/auth/`, `CODEOWNERS` | Plan-first. Human approval (`approve-plan.sh`) before editing. Code owner review. |
| Critical | Deploys, secrets, repo settings, funds or keys, personal data | Prepare only. A human executes (`deploy.yml` is human-started and environment-gated). |
| Never | `.claude/settings*.json`, `.claude/hooks/`, `.agent-policy/`, `.agent-control/`, secrets | Agents cannot write these at all. |

When unsure, pick the higher level. Changing an agent's tools, an MCP server, or a hook is always **high**: it changes what agents can do.
Gates exist only where they reduce real risk: low and medium work is not held for plan approval.

## Tools, MCP, and environment

- Least privilege. Planner and reviewer are read-only. Only the implementer edits.
- MCP: only servers listed in `.mcp.json` (Claude Code) or `copilot/mcp-config.json` (Copilot) are enabled. Each allows only named read-only tools, never `*`. Tokens come from environment secrets at runtime (`GITHUB_MCP_PAT`, `COPILOT_MCP_*`), never from files.
- Adding or widening an MCP server is a high-risk change, reviewed like a new dependency.
- Never read, print, or write secrets (`.env*`, `*.pem`, `*.key`, `secrets/`). Refer to them by variable name only.
- Never edit `.claude/settings*.json`, `.claude/hooks/`, `.agent-policy/`, or `.agent-control/`, by any tool including the shell.
- Never use `--force`, `--no-verify`, `reset --hard`, `rebase`, `gh pr merge`, `gh secret set`, or start a deploy.
- Never run the human-only scripts: `approve-plan.sh`, `close-task.sh`, `apply-github-settings.sh`, `release.sh`, `sync-kit.sh`.
- Never pipe a download into a shell.
- Cloud agent environments are prepared by `.github/workflows/copilot-setup-steps.yml` and have their own secrets (the `copilot` environment). Do not assume CI secrets exist there.

## Errors, retries, escalation

- Retry a failing step at most **2 times**, changing something each time. A hook counts consecutive failures of the same command and tells you to escalate on the 3rd. Retrying without changing anything is flagged.
- Before each retry, classify the root cause in `.agent/state.md`: `reasoning error`, `tool misuse`, or `context/environment issue`.
- **Rollback:** revert your own commits (`git revert`), never rewrite history. Deploys roll back by redeploying a previous explicit commit or tag.
- **Escalate** after the 2nd failed retry, any scope change, or any high-risk surprise. Report: what failed, root cause, what you tried, evidence, suggested next step.

## Memory and state

| Memory | File | Lifetime | Rules |
| --- | --- | --- | --- |
| Short-term | `.agent/state.md` | One task | Under 60 lines. Task-relevant only. Archived and reset by `close-task.sh`. Stale after 7 days or if its branch differs from yours. |
| Long-term | `.agent/decisions.md` | Across tasks | Append only: `- YYYY-MM-DD \| decision \| reason \| alternatives rejected \| review-by YYYY-MM-DD`. Expired entries must be re-confirmed. |
| External | Issues, PRs, commits | Permanent | The durable record. Plans and evidence live in the PR. |
| Control | `.agent-control/` (scope, approval) | One task | Human-owned. Agents read, never write. |
| Audit | `.agent-control/audit.log` | 30 days, then archived | Written by hooks. Agents cannot edit or delete it. |

- No secrets, raw logs, or guesses stated as facts in memory.
- Shared state: Claude Code and Copilot read the same `.agent/` files and `CLAUDE.md`, so they never work from different context.
- Long runs: re-read the plan every few steps. If you drifted, stop and correct course.

## Evaluation

Success is the task's real intent, not just green CI. Every plan states:
- **Quantitative:** checks that must pass, files expected to change (CI `scope-check` enforces), no new code scanning alerts.
- **Qualitative:** the signal that proves the goal is met (for example, "the vulnerable version is gone from the lockfile, including transitive deps").

When a result fails, tune the right thing: instructions (reasoning errors), tool access (tool misuse), memory or setup steps (context/environment issues).

## Multi-agent

| Agent | Tools | Output (handoff artifact) |
| --- | --- | --- |
| `planner` | read-only | `.agent/plan.md` / PR plan section |
| `implementer` | read, edit, shell | commits on `agent/<task>` |
| `reviewer` | read-only + tests | review note in `.agent/state.md` |
| `orchestrator` (Copilot) | read + invoke agents | handoff log in `.agent/state.md` |

- Pattern: sequential pipeline with a human gate. Parallel only when file scopes do not overlap (`new-task.sh` refuses overlaps; the `Agent Conflicts` workflow fails overlapping PRs).
- Every handoff is written down: agent, input, output, result.
- Watch for: two agents editing the same file, duplicated work, contradictory outputs, stalled agents (no new commits or notes). Stop and escalate.
- Agent lifecycle (add, update, retire) follows `docs/agent-lifecycle.md`.

## Responsible AI

- **Human accountability.** A named human approves high-risk plans and merges every PR. Agents never act as the final decision-maker.
- **Transparency.** Every agent PR fills in the Agent section of the template (which agents, handoffs). Agent commits stay on `agent/*`, `claude/*` or `copilot/*` branches so their origin is visible.
- **Privacy.** Never put personal data, customer data, or credentials into prompts, plans, memory files, issues, or logs. Use synthetic or redacted examples.
- **Fairness and safety.** Flag in the plan any change that makes automated decisions about people (access, eligibility, scoring, money). Those are **critical**: prepare only.
- **Licences and provenance.** Do not paste code of unknown origin. Note any new third-party code or dependency and its licence in the PR.
- **Honest reporting.** Report failures, skipped steps, and uncertainty as they are. Never claim a check passed that you did not run.
