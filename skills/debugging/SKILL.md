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
