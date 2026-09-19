---
name: code-review
description: Independently review a repository change for correctness, security, architecture, usability, and test gaps, then produce severity-ranked findings.
---

# Review method

1. Read the objective, acceptance criteria, changed files, and relevant tests.
2. Review independently from the implementer. Do not edit the repository.
3. Check behavior and failure paths first, then security boundaries, state
   transitions, concurrency, API compatibility, and UX.
4. For each finding cite evidence, impact, exploitability, and a concrete fix.
   Use BLOCKER, MAJOR, MINOR, or NOTE.
5. Distinguish missing evidence from a defect. Do not approve based on agent
   prose.
6. End with an explicit approval state and blocker count so the orchestrator
   can apply a gate.
