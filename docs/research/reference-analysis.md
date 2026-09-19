# Reference analysis

Research date: 2026-09-19. Sources were the public repositories and current
documentation returned by web search. HackOn uses the ideas below as design
inputs, not copied source code.

| System | Primitive | Purpose | Strength | Weakness / boundary | Context model | Execution model | Verification model | Learning model | Decision |
|---|---|---|---|---|---|---|---|---|---|
| [gstack](https://github.com/garrytan/gstack) | role-oriented skills | CEO, designer, engineering, QA, release perspectives | Clear opinionated role switching and review depth | Primarily host/plugin skills; a skill does not itself prove repository state | Host-managed skill prompts | Host agent executes tools | Review and QA practices, not a general evidence ledger | Practice encoded in skills | ADAPT |
| [vibecode-pro-max-kit](https://github.com/withkynam/vibecode-pro-max-kit) | context files, goals, agents, skills | Reduce context rot and preserve project memory | Strong file-routed context and explicit planning protocol | File protocol can become ceremony without machine gates | Progressive project/process files | Host-specific agent sessions | Planning and validation conventions | Durable reports and context routing | ADAPT |
| [Every Compound Engineering](https://github.com/EveryInc/compound-engineering-plugin) | plan → work → review → compound | Make each cycle improve the next | Treats learning as a first-class development phase | Plugin prompts do not replace a runtime evidence contract | Local packs and relevant skill disclosure | Agent/plugin workflow | Review specialists; quality depends on host | Compound packs and recorded learnings | ADAPT |
| [obra/superpowers](https://github.com/obra/superpowers) | skills framework, TDD, subagents | Force disciplined coding habits | Deep implementation/debugging methodology and subagent patterns | Host integration and narrative claims are not enough for machine verification | Skill metadata plus progressive skill bodies | Host agent plus subagents | Tests, review, and TDD practices | Reusable skills | ADOPT |
| [GitHub Spec Kit](https://github.com/github/spec-kit) | constitution → specify → plan → tasks → implement | Spec-driven development | Strong separation of intent, plan, and implementation | A spec can still be satisfied on paper unless runtime evidence is added | Repository-local specs and templates | Host-selected coding agent | Convergence and verification guidance | Specs and decisions | ADAPT |
| [BMAD Method](https://github.com/bmad-code-org/BMAD-METHOD) | specialized personas and agile phases | Coordinate product and engineering roles | Broad startup/product coverage and explicit roles | Broad role catalogs can add overhead and do not guarantee execution | Persona/project artifacts | Agent role handoffs | Phase reviews and checklists | Project artifacts | ADAPT |
| [GSD](https://github.com/gsd-build/get-shit-done) | context engineering, plans, DAG-oriented workflow | Keep work small and resumable | Good decomposition, context loading, and cross-host intent | Prompt orchestration alone cannot attest to tests or changes | File-based progressive context | Multiple coding hosts | Verification instructions | Persistent project state | ADAPT |
| [Anthropic Skills](https://github.com/anthropics/skills) | `SKILL.md` package | Discoverable portable skills | Simple metadata/body format and progressive disclosure | It is a capability format, not an orchestration/evidence engine | Skill frontmatter then body/references | Host-dependent | Host-dependent | Skill files and references | ADOPT |

## Rejected assumptions

- A Markdown handoff is not work evidence.
- An agent statement is not command evidence.
- A linear checklist is not a workflow engine.
- A large catalog is not methodological depth.
- A mock executor can test contracts but cannot qualify real E2E.

## License posture

HackOn keeps its own implementation under MIT. The reference systems remain
separate works, and this document contains analysis and links rather than
copied implementation assets. Contributors must preserve source license
notices if they add third-party code or text.
