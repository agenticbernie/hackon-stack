---
name: experiment-analysis
description: Use the experiment analysis method with explicit evidence and a next decision.
---

# Experiment analysis

State the hypothesis, unit, exposure, primary metric, guardrails, baseline,
observation window, and stopping rule. Check data quality and segment effects
before interpreting the result. Report uncertainty and next action.

## Purpose
Use experiment analysis to produce a decision-ready result for the current workflow stage. Keep observations separate from assumptions and recommendations.

## Triggers
Use when the stage objective concerns experiment analysis, or when a handoff explicitly requests this capability. Do not invoke it for unrelated implementation work.

## Inputs
- The stage objective, role, constraints, and acceptance criteria.
- Relevant repository artifacts, prior evidence, and retrieved learning.
- Explicit uncertainty, time or context budget, and permitted actions.

## Method
1. Inspect the highest-authority available evidence and identify missing evidence.
2. Apply the experiment analysis method to classify facts, assumptions, risks, and alternatives.
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
