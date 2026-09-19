# Troubleshooting

- `hackon doctor` fails: run `hackon init` in the target workspace.
- Factory Droid fails: verify `droid --version`, `OPENAI_API_KEY`, and the
  workspace path. Use `HACKON_DROID_COMMAND` for a custom executable.
- OpenCode fails: verify `opencode --version`, provider authentication, and
  the workspace path. Use `HACKON_OPENCODE_COMMAND` for a custom executable.
- A run is failed: inspect `.hackon/runs/<id>.json`; it contains stage errors,
  gate results, selected context, and evidence.
- Tests pass but a stage is blocked: inspect the blocking gate. Agent prose
  cannot satisfy machine gates.
