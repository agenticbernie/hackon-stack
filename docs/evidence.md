# Evidence

Evidence fields include ID, kind, producer, stage, timestamp, source, result,
verification status, and metadata. Supported kinds include files, diffs,
commands, tests, builds, reviews, metrics, human approvals, and agent output.

Agent output is retained for traceability but does not satisfy test/build
gates. Command evidence records argv, cwd, exit code, stdout, stderr, duration,
timeout, and timestamp.
