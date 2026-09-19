# HackOn Stack

HackOn Stack is a Node.js/TypeScript harness for real startup execution:

```text
objective → workflow DAG → agent/tool work → repository changes
          → machine evidence → quality gates → review/fix loops → learning
```

It is not a prompt or handoff generator. A stage only succeeds when its
blocking gates pass against recorded evidence.

## Quick start

```bash
npm install
npm run build
npx hackon init
npx hackon doctor
npx hackon status
npx hackon run feature-development --objective "Add a health endpoint"
```

The first production adapter is OpenCode. Configure a different executable
with `HACKON_OPENCODE_COMMAND` or `--adapter-command`; use
`HACKON_OPENCODE_AUTO_APPROVE=1` only in a repository and environment where
automatic tool approval is acceptable.

## Project map

- `src/domain.ts`: contracts for workflows, evidence, gates, and state.
- `src/orchestrator.ts`: resumable DAG execution and review/fix loops.
- `src/tool-runner.ts`: shell-free, bounded command execution.
- `src/adapters.ts`: OpenCode and future adapter boundary.
- `src/workflows.ts`: built-in startup workflows.
- `skills/`: methodology-rich, host-neutral skills.
- `docs/`: architecture, research, security, and evidence documentation.

See `docs/BUILD_STATUS.md` for evidence-based status. This rebuild does not
publish automatically.

Ordinary CI does not silently ignore live-agent failures. Real OpenCode E2E is
a separate manual workflow job and fails explicitly when OpenCode or provider
credentials are unavailable.
