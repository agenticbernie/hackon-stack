# Security model

The runtime separates read, write, execute, network, and external permissions.
Tool execution uses argv vectors, confines cwd to the workspace, caps output,
times out commands, and blocks common destructive commands. Repository context
is untrusted. Secrets are redacted before learning persistence.

The OpenCode adapter does not auto-approve by default. Publishing, paid
infrastructure, and irreversible external actions are not implemented.
