---
name: debugging
description: Reproduce software defects, falsify hypotheses, fix root causes, and prove regressions are gone with machine evidence.
---

# Debugging method

1. Reproduce the report with the smallest safe command and record the failing
   output. Do not begin with a fix.
2. Minimize the reproduction while preserving the failure. Identify input,
   state, time, dependency, and boundary conditions.
3. Separate observations, user statements, hypotheses, and inferences.
4. Rank hypotheses by explanatory power and test cost. Falsify the cheapest
   plausible hypothesis first.
5. Trace the failure to a root cause at a specific boundary. Reject symptom
   patches that leave the cause intact.
6. Add a regression test that fails before the change and passes after it.
7. Implement the smallest root-cause fix. Preserve permissions, data
   validation, and backwards compatibility.
8. Run the affected test, adjacent regressions, lint/typecheck/build as
   applicable. Capture command evidence, not a claim.
9. Record residual risk and a reusable learning cue.

## Purpose
Use debugging to produce a decision-ready result for the current workflow stage. Keep observations separate from assumptions and recommendations.

## Triggers
Use when the stage objective concerns debugging, or when a handoff explicitly requests this capability. Do not invoke it for unrelated implementation work.

## Inputs
- The stage objective, role, constraints, and acceptance criteria.
- Relevant repository artifacts, prior evidence, and retrieved learning.
- Explicit uncertainty, time or context budget, and permitted actions.

## Method
1. Inspect the highest-authority available evidence and identify missing evidence.
2. Apply the debugging method to classify facts, assumptions, risks, and alternatives.
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
