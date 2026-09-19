# Capability matrix

Legend: **ADOPT** means the capability is present in the current rebuild,
**ADAPT** means the idea exists with a HackOn-specific contract, **MISSING**
means not implemented, and **REJECT** means intentionally excluded.

| Domain | Capability | Status | Evidence / boundary |
|---|---|---|---|
| Orchestration | resumable DAG, dependency blocking, retries | ADOPT | `src/orchestrator.ts`, core tests |
| Orchestration | parallel read-only reviewers | ADOPT | independent review stages and concurrency test |
| Execution | shell-free bounded commands | ADOPT | `SafeToolRunner`, security tests |
| Execution | OpenCode headless adapter | ADAPT | `OpenCodeAdapter`; requires configured model/provider |
| Evidence | provenance and verification status | ADOPT | `Evidence` union and persisted run state |
| Gates | command/test/build/review/metric/security families | ADOPT | `src/gates.ts` |
| Context | bounded progressive repository context | ADOPT | `src/context.ts` |
| Learning | durable file store and scored retrieval | ADAPT | `FileKnowledgeStore`; lexical baseline |
| Skills | debugging, discovery, growth, TDD, review, learning | ADOPT | `skills/` |
| Product | idea, feature, request, MVP workflows | ADAPT | workflow graph and methodology skills |
| Quality | test, review, fix, final verification loop | ADOPT | built-in workflows |
| Growth/data | metric and experiment gate contracts | ADAPT | evidence/gate contract; fixture analytics E2E missing |
| DevOps | launch/incident workflow names | ADAPT | shared graph; deployment provider integrations missing |
| Business | pivot/founder review workflow names | ADAPT | methodology prompts; business system integrations missing |
| Security | permissions, path confinement, injection warnings | ADOPT | `SECURITY.md`, runner/context controls |
| External effects | network, publish, paid infrastructure | MISSING by design | explicit future adapter boundary; no automatic publish |
| Autonomous multi-agent E2E | real OpenCode fixture verified | MISSING | test is present but requires live provider credentials |

This matrix is deliberately honest: breadth is represented in reusable
contracts, while provider-specific integrations and live model verification
remain visible gaps.
