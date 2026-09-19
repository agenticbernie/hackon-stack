# Adapters

`AgentAdapter` accepts an objective, role, permissions, workspace, and bounded
context, then returns an agent result. The OpenCode adapter invokes
`opencode run --format json --dir <workspace> -- <prompt>` without a shell.

An adapter must be tested against its actual host before it is described as
working. No Codex or Claude Code adapter is claimed in this release.
