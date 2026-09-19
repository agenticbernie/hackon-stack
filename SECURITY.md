# Security model

HackOn treats repository text and agent output as untrusted input. Context is
labelled as untrusted, commands are executed without a shell, working
directories are confined to the workspace, and destructive commands are
blocked unless an explicit authorization token is supplied.

The core separates read, write, execute, network, and external-side-effect
permissions. The OpenCode adapter does not enable auto-approval unless the
caller explicitly opts in. Do not place credentials in prompts, evidence, or
repository files.

Report vulnerabilities privately to the maintainers before public disclosure.
