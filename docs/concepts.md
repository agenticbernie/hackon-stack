# Concepts

**Intent** is the natural-language objective. **Work** is an agent or tool
action. **Evidence** is a provenance-bearing observation. **Verification** is a
machine or explicitly human check that validates evidence. **Artifact** is a
file output and is not automatically evidence.

A stage is successful only when its blocking gates pass. A run is successful
only when all stages succeed. Failed, blocked, or interrupted stages can be
resumed; succeeded stages are not rerun.
