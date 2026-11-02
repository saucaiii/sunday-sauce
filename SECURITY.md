# Security policy

## Reporting a vulnerability

Please report vulnerabilities privately through GitHub's "Report a vulnerability" button on the Security tab of this repository (private vulnerability reporting). Do not open a public issue for security problems.

Include, if you can:

- A short description of the issue.
- Steps or a minimal proof of concept.
- The commit SHA or release tag affected.
- Your assessment of impact (what an attacker can do).

Target response time: within 3 business days to acknowledge, with a plan or fix target in the follow-up. Adjust the SLA to what you can actually commit to for this project.

## Critical risk areas

Per `CLAUDE.md`, the following are classified as critical risk and get prepared only by agents, never executed:

- Secrets, keys, and tokens (`.env*`, `*.pem`, `*.key`, `secrets/`).
- Code that moves funds, signs transactions, or holds private keys.
- Deploy workflows, repo settings, environments, and rulesets.
- Personal or customer data.

A fix PR that touches any of these needs a human to execute, following the Responsible AI section of `CLAUDE.md`.

## Supported versions

Patch and support policy is per project. Add the versions you support here when the project ships a release.

## License

This template intentionally ships without a `LICENSE` file. Pick a license per project before publishing or accepting third-party contributions.
