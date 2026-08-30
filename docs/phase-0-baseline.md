# Phase 0 baseline record

Execution date: 2026-08-30 (Asia/Shanghai)

## Inputs

- Working directory: `D:\repos\amout recycling`
- Provisional project name: Credit Trade
- Default target markets: China mainland, Hong Kong, Singapore, United States, European Union
- Vendor candidates: none supplied
- Stack constraints: none supplied; greenfield defaults apply provisionally
- Maximum repair rounds: 3
- GitHub repository visibility: `private` (user-confirmed); public publication: prohibited

## Read-only checks and results

| Check | Result | Interpretation |
|---|---|---|
| Directory inventory | Zero files and directories before baseline creation | Greenfield directory |
| Repository rules | No `AGENTS.md` in the working directory or checked ancestors | Only conversation and platform instructions apply |
| Git repository | `.git` absent; Git reports “not a git repository” | No branch, commit, tag, remote, or Git worktree status existed |
| Existing changes | Not applicable because no repository or files existed | Do not describe this as a clean worktree |
| Dependencies/config | None existed | No existing stack to preserve |
| Git | 2.54.0.windows.1 | Available |
| Bundled Node.js | 24.19.0 | Available by explicit workspace-runtime path, not normal PATH |
| pnpm | 11.19.0 | Available |
| Bundled Python | 3.12.13 | Available |
| PowerShell | 7.6.4 | Available |
| ripgrep | 15.2.0 | Available |
| Docker | Missing from PATH | Container demo/build/scan not presently verifiable |
| GitHub CLI | Missing from PATH | GitHub authentication and publication permissions not presently verifiable |
| GitHub-related environment names | Only `GH_PAGER`; no credential variable name detected | No GitHub credential was read or exposed |

## Prompt validation scenarios

This is a policy-path review, not an executed application test. Runtime tests remain `NOT_STARTED` because no application existed at the time of review.

| Scenario | Required behavior | Phase 0 disposition |
|---|---|---|
| All approvals and access valid | Build/test, bounded live loop, then verified stable Release | PASS — path is permitted only after evidence and explicit amount authorization |
| Missing entity or payment approval | Complete fail-closed RC; no real funding/payout or GA claim | PASS — recorded as external blockers |
| Vendor prohibits resale | Disable that vendor and continue vendor-neutral core | PASS — no vendor is enabled by default |
| One market approved | Admit only that market; preserve regional data/fund isolation | PASS — per-market state and build are required |
| GitHub access missing | Produce local artifacts, hashes, and handoff; no Release claim | PASS — GitHub is currently unverified |
| Real secret discovered | Stop release, redact report, require revocation/rotation | PASS — release gate requirement recorded |
| Duplicate/concurrent financial events | Exactly-once financial effect and balanced ledger; otherwise manual handling | PASS — required as implementation/property-test gate |
| Cryptocurrency, lending, anonymous supplier, or rule evasion requested | Reject automatic scope expansion and place behind reassessment | PASS — explicitly out of initial scope |

## Artifacts created in Phase 0

- `.gitignore`
- `docs/project-status.md`
- `docs/blockers.md`
- `docs/requirements-traceability.md`
- `docs/phase-0-baseline.md`
- `docs/adr/0001-platform-shape.md`
- `docs/compliance/README.md`
- `docs/security/risk-register.md`
- `docs/runbooks/README.md`
- `docs/evidence/phase-0.sha256`

## Automatic checks and pass conditions

Phase 0 passes when the starting state is evidenced, existing work is protected, tool gaps are known, assumptions and blockers are explicit, risk and traceability records exist, and no unauthorized remote or financial action occurred.

Application build, tests, security scans, payment sandbox verification, container build, and GitHub publication are not Phase 0 pass claims and have not been run.

## Failures and root causes

- Initial Git inspection commands failed because the directory had no `.git` repository. This was the discovered starting condition; a local repository was then initialized on provisional branch `main` without a remote.
- The first post-initialization Git inspection was blocked by Git's dubious-ownership protection because the workspace owner and sandbox process account differ. Root cause was confirmed, and validation succeeded by applying a per-command `safe.directory` value scoped to this exact repository; global Git configuration was not changed.
- Docker and GitHub CLI checks could not run because their executables are absent from PATH.
- Normal-PATH Node.js checks failed; the bundled Node.js executable was then located and verified. This is an environment-path issue, not an application defect.

## Recovery point

Recover to the first local Phase 0 commit and verify the tracked Phase 0 files against `docs/evidence/phase-0.sha256`. No remote recovery point exists.
