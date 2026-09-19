# Security model

The runtime separates read, write, execute, network, and external permissions.
The command broker enforces execute/write/network checks for known command
classes, uses argv vectors, confines cwd to the workspace, caps output, times
out commands, and blocks common destructive commands. Read-only OpenCode tasks
are fingerprinted before and after execution and fail if files change.
Repository context is untrusted. Subprocess environments are allowlisted and
secrets are redacted before learning persistence.

The OpenCode adapter does not auto-approve by default. Publishing, paid
infrastructure, and irreversible external actions are not implemented. This
is a process-level policy boundary, not an OS sandbox; hostile code execution
requires a container or other isolation boundary supplied by the host.
