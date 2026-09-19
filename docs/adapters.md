# Adapters

`AgentAdapter` accepts an objective, role, permissions, workspace, and bounded
context, then returns an agent result. The OpenCode adapter invokes
`opencode run --format json --dir <workspace> -- <prompt>` without a shell.

An adapter must be tested against its actual host before it is described as
working. The OpenCode adapter allowlists its environment and enforces
read-only tasks with workspace fingerprints. It does not provide OS-level
network or privilege isolation; use a container or equivalent host sandbox for
untrusted code. No Codex or Claude Code adapter is claimed in this release.
