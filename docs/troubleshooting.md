# Troubleshooting

- `hackon doctor` fails: run `hackon init` in the target workspace.
- OpenCode fails: verify `opencode --version`, provider authentication, and
  the workspace path. Use `HACKON_OPENCODE_COMMAND` for a custom executable.
- A run is failed: inspect `.hackon/runs/<id>.json`; it contains stage errors,
  gate results, selected context, and evidence.
- Tests pass but a stage is blocked: inspect the blocking gate. Agent prose
  cannot satisfy machine gates.
