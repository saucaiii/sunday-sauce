# GH-600 skills → kit files

Every skill from the [official study guide](https://learn.microsoft.com/en-us/credentials/certifications/resources/study-guides/gh-600), mapped to where this kit implements it. Use it as a lab checklist: for each row, open the file, explain what it does, then break it on purpose and watch it fail.

Legend: **E** = enforced (hook, CI, or GitHub setting blocks it) · **G** = guidance (instructions only) · **T** = tooling (script you run)

## Domain 1: Prepare agent architecture and SDLC processes (15–20%)

| Skill | Where | Type |
| --- | --- | --- |
| Identify steps for agents to perform | `CLAUDE.md` workflow, planner agents | G |
| Identify and mitigate agent anti-patterns | `planner` agents flag them; `orchestrator` stop conditions | G |
| Define inputs, outputs, success criteria | PR template Plan section; `require-plan` job | E |
| Planning distinct from execution | read-only `planner` tool lists | E |
| Output a structured plan | planner output format; `.agent/plan.md` | G |
| Validate agent plans | `require-plan` CI job; human review | E |
| Prevent action until plan approved | `policy.sh` blocks high-risk edits until a human runs `approve-plan.sh`; approval is bound to the plan hash and agents cannot write it | E |
| Degree of autonomy incl. guardrails | risk table in `CLAUDE.md`; `high-risk-plan-declared` job | E |
| Inspectable artifacts in standard tooling | PR, commits, `ci.yml` artifacts, step summaries | E |
| Human intervention without slowing delivery | only high/critical gated; low risk can auto-merge | G |

## Domain 2: Implement tool use and environment interaction (20–25%)

| Skill | Where | Type |
| --- | --- | --- |
| Identify required tools | `tools:` in each agent profile | G |
| Configure agent tools | `.github/agents/*.agent.md`, `.claude/agents/*.md` | E |
| Configure tool permissions | `.claude/settings.json` allow/ask/deny; agent `tools` lists | E |
| Add an MCP server as a tool | `.mcp.json`; `mcp-servers`/`server/tool` in agent profiles | E |
| Configure GitHub remote MCP server | `copilot/mcp-config.json` (`/readonly` URL, `X-MCP-Toolsets`) | E |
| Configure MCP registries | `README` → enterprise registry notes (enterprise feature) | G |
| Configure MCP allow lists | `tools` allowlist in `mcp-config.json`; `copilot/managed-settings.example.json` | E |
| Evaluate execution context | `copilot-setup-steps.yml` comments; `CLAUDE.md` environment section | G |
| Scope agent to a repository | default GitHub MCP token is repo-scoped read-only; human-owned `.agent-control/scope.txt` | E |
| Invoke an agent in CI | `agent-ci.yml` (Copilot CLI, `-p`, `--allow-tool`, `--no-ask-user`) | E |
| Branch-based scope | `policy.sh` blocks work on `main`; `agent/*` branches | E |
| Autonomous branches and PRs | implementer creates `agent/*` branch + draft PR | G |
| Environment-specific constraints | `copilot-setup-steps.yml`; `copilot` environment secrets; firewall | E |
| Error handling | `on-failure.sh`, `on-error.sh`, `if: always()` evidence steps | E |
| Retries | `on-failure.sh` (2 retries, consecutive, flags unchanged retries); retry loop in `agent-ci.yml` | E |
| Rollbacks | `git revert` rule; `deploy.yml` explicit-ref redeploy | E |
| Escalation paths | `on-failure.sh` ESCALATE; `escalate` job in `agent-ci.yml` | E |
| Traceability and accountability | `audit-log.sh`, Copilot `post-tool.sh` → `.agent-control/audit.log` (agents cannot alter it); artifacts named by SHA + run | E |

## Domain 3: Manage memory, state, and execution (10–15%)

| Skill | Where | Type |
| --- | --- | --- |
| Short-term vs long-term vs external memory | memory table in `CLAUDE.md` | G |
| Scope memory to task-relevant info | `state.md` 60-line limit, warned at session start | E |
| Expiration, pruning, reset rules | `review-by` dates; `close-task.sh` archive + reset + 30-day audit pruning | T |
| Capture progress and decisions as artifacts | `.agent/state.md`, `.agent/decisions.md`, PR | G |
| Resume without repeating or diverging | `session-context.sh` loads state + decisions | E |
| Detect and correct drift | re-read plan rule; `scope-check`; `eval-report.sh` | E |
| Share state across tools/environments | Claude + Copilot read the same `.agent/` and `CLAUDE.md` | G |
| Prevent conflicting context | single source of truth (`CLAUDE.md`); worktrees see each other's scope | E |
| Prevent stale context | `session-context.sh` warns on branch mismatch, age > 7 days, expired decisions | E |

## Domain 4: Perform evaluation, error analysis, and tuning (15–20%)

| Skill | Where | Type |
| --- | --- | --- |
| Expected outcomes and constraints | Success criteria in plan + PR template | E |
| Qualitative and quantitative signals | `eval-report.sh` table (tests, scope, blocks, failures, intent) | T |
| Align criteria with development intent | "intent signal" field; reviewer checks it | G |
| Signals from automated scanning | `codeql` job; reviewer checks code scanning alerts | E |
| Find failures in logs, plans, traces, artifacts | `audit-report.sh`; uploaded artifacts; step summaries | T |
| Classify root causes | categories in `on-failure.sh`, `eval-report.sh`, reviewer output | G |
| Revise instructions, workflows, constraints | tuning targets in reviewer output | G |
| Refine memory usage | `close-task.sh`; stale warnings | T |
| Refine tool usage and access | `docs/agent-lifecycle.md` update flow | G |

## Domain 5: Orchestrate multi-agent coordination (15–20%)

| Skill | Where | Type |
| --- | --- | --- |
| Apply an orchestration pattern | `orchestrator.agent.md` (sequential pipeline + human gate) | G |
| Isolate agents for parallel execution | `new-task.sh` (branch + worktree + scope per task) | E |
| Resolve conflicts (overlap, duplication, contradiction) | `new-task.sh` refuses overlap; `agent-conflicts.yml` | E |
| Artifacts for review and audit | artifacts, audit log, PR Agent section | E |
| Document decisions, handoffs, outcomes | Handoffs section in `state.md` and PR template | G |
| Post-hoc analysis | `audit-report.sh` | T |
| Spot failed, partial, stalled runs | `audit-report.sh`; lifecycle health signals | T |
| Respond to degraded behavior | `docs/agent-lifecycle.md` health signals | G |
| Recovery: rollback + human-in-the-loop | `escalate` job; revert rule; orchestrator retries once then escalates | E |
| Add agents to a workflow | `docs/agent-lifecycle.md` → Add | G |
| Update/replace without disruption | lifecycle → Update; `metadata.version`; SHA versioning | G |
| Retire while keeping auditability | lifecycle → Retire (`status: retired`, keep file) | G |

## Domain 6: Implement guardrails and accountability (10–15%)

| Skill | Where | Type |
| --- | --- | --- |
| Classify actions by operational, security, and compliance risk | three-axis rule + risk table in `CLAUDE.md`; `flag-high-risk` job | E |
| Assign autonomy levels (security + Responsible AI standards) | risk table → autonomy column; Responsible AI section in `CLAUDE.md`; PR template RAI checklist | E |
| Identify actions needing human judgment | high/critical rows; `approve-plan.sh`; human-only scripts | E |
| Block security, compliance, or Responsible AI violations | `policy.sh` (both tools, file and shell paths); deny lists; fails closed if `jq` or the policy is missing | E |
| Least privilege permissions + contexts | `permissions:` per job; read-only agents; read-only MCP; default token read-only | E |
| Explicit authorization for irreversible changes | `deploy.yml`: human-only, environment approval, explicit ref | E |
| Minimize approvals that don't reduce risk | gates only on high/critical; solo ruleset profile avoids unmeetable self-approval | G |
