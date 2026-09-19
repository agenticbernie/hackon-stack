# Build status

Status vocabulary: `NOT_STARTED`, `IMPLEMENTED`, `TESTED`,
`REAL_E2E_VERIFIED`.

| Area | Status | Evidence |
|---|---|---|
| Node.js/TypeScript package | TESTED | `npm run build`, `npm run typecheck` |
| Evidence/state engine | TESTED | unit and integration tests |
| Tool execution/security boundaries | TESTED | `test/core.test.ts` |
| Verified evidence enforcement | TESTED | unverified test/review evidence is rejected by blocking gates |
| Stage baseline provenance | TESTED | before/after fingerprints prevent dirty-tree and stale-artifact false positives |
| Atomic state persistence | TESTED | state/knowledge writes use temporary files and rename |
| Process-level permission boundary | TESTED | read-only agent mutation and command permission regressions pass; OS sandbox still external |
| DAG/resume/parallel reviewers | TESTED | `test/core.test.ts` |
| OpenCode adapter implementation | IMPLEMENTED | `src/adapters.ts`, CLI help inspection |
| Feature real E2E | TESTED | A prior local OpenCode run completed all 13 stages, but its evidence was temporary; canonical sanitized snapshots are now produced by `test/real-e2e.test.ts` on the next live run |
| Bug-fix real E2E | NOT_STARTED | fixture still to add |
| Zero-to-MVP real E2E | NOT_STARTED | fixture still to add |
| Growth real E2E | NOT_STARTED | analytics fixture still to add |
| Compound-learning real E2E | TESTED | retrieval unit test; live cycle not verified |
| Package clean-install workflow | TESTED | `npm pack` installed in `/tmp/hackon-clean`; `npx hackon --version`, `init`, `doctor`, and `status --json` passed |
| Dogfood cycle | NOT_STARTED | live agent cycle pending |
| CI real OpenCode E2E | NOT_STARTED | intentionally manual; ordinary CI reports availability instead of ignoring failures |

This file intentionally does not call the project release-ready.
