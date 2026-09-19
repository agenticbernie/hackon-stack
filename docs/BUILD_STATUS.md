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
| Factory Droid production adapter | REAL_E2E_VERIFIED | `src/adapters.ts`, Droid 0.222.0, OpenAI BYOK model, persisted sanitized snapshot |
| Worktree and run locking | TESTED | disposable Git worktree and duplicate-lock regression tests |
| Project profiling and command discovery | TESTED | package-manager, script, language, and override tests |
| Structured review contract | REAL_E2E_VERIFIED | validated JSON review schema and all four live Factory review stages |
| OpenCode compatibility adapter | IMPLEMENTED | `src/adapters.ts`, CLI help inspection |
| Feature real E2E | TESTED | A prior local OpenCode run completed all 13 stages, but its evidence was temporary; canonical sanitized snapshots are now produced by `test/real-e2e.test.ts` on the next live run |
| Bug-fix real E2E | NOT_STARTED | fixture still to add |
| Zero-to-MVP real E2E | NOT_STARTED | fixture still to add |
| Growth real E2E | NOT_STARTED | analytics fixture still to add |
| Compound-learning real E2E | NOT_STARTED | retrieval unit test; live two-cycle influence not verified |
| Package clean-install workflow | TESTED | `npm pack` installed in `/tmp/hackon-clean`; `npx hackon --version`, `init`, `doctor`, and `status --json` passed |
| Factory Droid feature E2E | REAL_E2E_VERIFIED | `docs/e2e/factory-droid-feature/`; disposable fixture completed all stages and persisted verified evidence |
| Dogfood cycle | NOT_STARTED | live agent cycle pending |
| CI real Factory Droid E2E | NOT_STARTED | intentionally manual; requires a runner with Droid and `OPENAI_API_KEY` |

This file intentionally does not call the project release-ready.

## Release classification

`NOT_READY`. The canonical Factory feature path is now real-E2E verified, but
bug-fix, MVP, growth, compound two-cycle, crash-resume, prompt-injection,
three-cycle dogfood, and clean-package real-workflow evidence are still
missing. No publish or release action is authorized by this status.
