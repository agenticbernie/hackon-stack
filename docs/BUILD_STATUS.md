# Build status

Status vocabulary: `NOT_STARTED`, `IMPLEMENTED`, `TESTED`,
`REAL_E2E_VERIFIED`.

| Area | Status | Evidence |
|---|---|---|
| Node.js/TypeScript package | TESTED | `npm run build`, `npm run typecheck` |
| Evidence/state engine | TESTED | unit and integration tests |
| Tool execution/security boundaries | TESTED | `test/core.test.ts` |
| Verified evidence enforcement | TESTED | unverified test/review evidence is rejected by blocking gates |
| Stage baseline provenance | TESTED | before/after content hashes prevent dirty-tree and stale-artifact false positives |
| Atomic state persistence | TESTED | state/knowledge writes use temporary files and rename |
| Process-level permission boundary | TESTED | read-only agent mutation and command permission regressions pass; OS sandbox still external |
| DAG/resume/parallel reviewers | TESTED | `test/core.test.ts` |
| Factory Droid production adapter | TESTED | `src/adapters.ts`, Droid 0.222.0, auth separation, cancellation, timeout, and adapter contract tests |
| Worktree and run locking | TESTED | disposable Git worktree and duplicate-lock regression tests |
| Project profiling and command discovery | TESTED | package-manager, script, language, and override tests |
| Structured review contract | TESTED | validated JSON review schema, lifecycle fixture, and targeted re-review gate |
| OpenCode compatibility adapter | IMPLEMENTED | `src/adapters.ts`, CLI help inspection |
| Feature real E2E | NOT_READY | Live test remains opt-in; the current Factory attempt was blocked by missing Droid authentication |
| Bug-fix real E2E | NOT_STARTED | fixture still to add |
| Zero-to-MVP real E2E | NOT_STARTED | fixture still to add |
| Growth real E2E | NOT_STARTED | analytics fixture still to add |
| Compound-learning real E2E | NOT_STARTED | retrieval unit test; live two-cycle influence not verified |
| Package clean-install workflow | TESTED | tarball install regression covers `npx hackon --version`, skills, init, workflows, and status |
| Factory Droid feature E2E | NOT_READY | `npm run e2e:factory` reached Droid 0.222.0 but failed authentication before the first stage |
| Dogfood cycle | NOT_STARTED | live agent cycle pending |
| CI real Factory Droid E2E | NOT_STARTED | intentionally manual; requires a runner with Factory authentication; BYOK credentials are separate |

This file intentionally does not call the project release-ready.

## Release classification

`NOT_READY`. Local typecheck, tests, docs validation, package dry-run, dependency
audit, cancellation, worktree, context, workflow-contract, and targeted
re-review checks pass. Mandatory live Factory authentication, the full E2E
matrix, three dogfood cycles, adversarial live run, and packed-package real
workflow evidence are still missing. No publish or release action is authorized.
