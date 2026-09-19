# Testing

The repository uses Node's built-in test runner after TypeScript compilation.
Tests cover:

- contract validation for workflow IDs and dependencies;
- unit behavior for tools, evidence gates, and retrieval;
- integration behavior for DAG concurrency and resume;
- security boundaries for path traversal and destructive commands;
- a real OpenCode fixture test, skipped unless `HACKON_REAL_E2E=1`.

The skipped test is not counted as real E2E release evidence.
