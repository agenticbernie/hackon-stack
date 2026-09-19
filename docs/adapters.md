# Adapters

`AgentAdapter` accepts an objective, role, permissions, workspace, and bounded
context, then returns an agent result. The production Factory Droid adapter
invokes `droid exec --cwd <workspace> --output-format json` without a shell.
It passes the existing `OPENAI_API_KEY` environment variable to Droid. For
direct OpenAI usage, select a Droid BYOK model configured in
`~/.factory/settings.json`; it does not require or forward `FACTORY_API_KEY`.

An adapter must be tested against its actual host before it is described as
working. Factory Droid autonomy flags and `--only-tools` enforce the task
boundary, while workspace fingerprints reject read-only mutations. The adapter
does not provide OS-level network or privilege isolation; use a container or
equivalent host sandbox for untrusted code. OpenCode remains a secondary
compatibility adapter.
