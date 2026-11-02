## Plan (required, checked by CI)
- **Risk:** low | medium | high | critical
- **Goal:**
- **Scope (paths/files):**
- **Steps:**
  1.
  2.
- **Success criteria (verifiable):**
  - [ ] Required checks pass
  - [ ] Intent signal met:
  - [ ] Only files in scope changed (checked by `scope-check`)
  - [ ] No new code scanning alerts
- **Risks + mitigations:**
- **Rollback / escalation plan:**

## Agent
- Agent(s): <!-- e.g. claude:implementer, copilot -->
- Handoffs: <!-- planner -> implementer -> reviewer, with results -->

## Evidence
- Workflow run(s):
- Artifacts: <!-- test-results-<sha>-run<id> -->
- Eval report: <!-- output of scripts/agent/eval-report.sh -->
- Decisions: see `.agent/decisions.md`

## Responsible AI
- [ ] No personal data, customer data, or credentials in prompts, plans, memory, or logs
- [ ] No automated decisions about people (or flagged as critical and prepared only)
- [ ] New third-party code or dependencies listed with their licence:

## Review checklist
- [ ] Plan reviewed and approved (high risk: `approve-plan.sh` run before code was written)
- [ ] Required reviews satisfied (code owners for guardrail paths)
- [ ] Required checks satisfied
