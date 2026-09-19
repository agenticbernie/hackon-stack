---
name: tdd
description: Drive implementation with a failing behavioral test, a minimal root-cause change, and a verified regression suite.
---

# Test-driven implementation

1. Convert acceptance criteria into observable behavior and edge cases.
2. Add the smallest failing test. Run it and capture the failure.
3. Implement only enough production behavior to satisfy that test.
4. Refactor for clarity while keeping the test green.
5. Run focused, adjacent, and full project tests. Add typecheck/lint/build
   evidence where the project exposes those commands.
6. Never weaken an assertion, skip a regression, or hardcode a fixture result
   to obtain green output.

## Purpose
Use tdd to produce a decision-ready result for the current workflow stage. Keep observations separate from assumptions and recommendations.

## Triggers
Use when the stage objective concerns tdd, or when a handoff explicitly requests this capability. Do not invoke it for unrelated implementation work.

## Inputs
- The stage objective, role, constraints, and acceptance criteria.
- Relevant repository artifacts, prior evidence, and retrieved learning.
- Explicit uncertainty, time or context budget, and permitted actions.

## Method
1. Inspect the highest-authority available evidence and identify missing evidence.
2. Apply the tdd method to classify facts, assumptions, risks, and alternatives.
3. Produce an actionable recommendation with confidence, counter-evidence, and a reversible next step.
4. Record only claims supported by cited evidence, and hand off unresolved questions explicitly.

## Outputs
Return a concise artifact containing: observed evidence, analysis, decision or recommendation, confidence, unresolved uncertainty, next action, owner, and retrieval cues.

## Evidence
Cite repository paths, command results, user or customer sources, metric names and time windows, or prior run IDs. Never treat an agent assertion as proof without a machine-checkable or human-attributed source.

## Quality criteria
- The result is specific enough for the next stage to act without guessing.
- Evidence and inference are visibly distinct.
- Risks, alternatives, and failure conditions are named.
- The handoff is scoped, reversible where possible, and does not claim unperformed work.

## Failure modes and handoff
Stop and report when inputs are missing, contradictory, stale, or outside the role's authority. Do not silently fill gaps. Hand off blockers, the exact missing evidence, and the smallest safe follow-up to the orchestrator or named next role.
