---
name: growth-experiment
description: Design and interpret startup growth experiments using baselines, segments, funnel stages, primary metrics, guardrails, and explicit decision thresholds.
---

# Growth experiment method

1. Define the funnel stage, target segment, event names, and measurement
   window. Audit event quality before interpreting numbers.
2. Establish a baseline with date range, denominator, sample limitations, and
   known instrumentation gaps.
3. State the hypothesis, expected mechanism, intervention, and counterfactual.
4. Choose one primary metric and guardrail metrics for quality, retention,
   revenue, latency, or trust.
5. Set a decision threshold before looking at the outcome. Record practical
   and statistical limitations; do not manufacture significance.
6. Implement the smallest product or instrumentation change, verify events,
   and capture command/build evidence.
7. Consume fixture or production-safe outcomes, compare with baseline, and
   label result as support, contradiction, or inconclusive.
8. Choose continue, iterate, stop, or investigate. Persist the learning and
   the next decision.

## Purpose
Use growth experiment to produce a decision-ready result for the current workflow stage. Keep observations separate from assumptions and recommendations.

## Triggers
Use when the stage objective concerns growth experiment, or when a handoff explicitly requests this capability. Do not invoke it for unrelated implementation work.

## Inputs
- The stage objective, role, constraints, and acceptance criteria.
- Relevant repository artifacts, prior evidence, and retrieved learning.
- Explicit uncertainty, time or context budget, and permitted actions.

## Method
1. Inspect the highest-authority available evidence and identify missing evidence.
2. Apply the growth experiment method to classify facts, assumptions, risks, and alternatives.
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
