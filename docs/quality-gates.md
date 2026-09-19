# Quality gates

The gate evaluator supports artifact, schema, diff, command, test, build,
lint, typecheck, review, blocker, human approval, metric, coverage, and
security gates. Gates are explicit and can be blocking or advisory.

Adding a gate requires an evidence producer. Do not add a textual assertion
when a machine check can be performed.
