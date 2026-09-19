# Configuration

`hackon init` creates `.hackon/config.json`. The current adapter can also be
configured with:

- `HACKON_OPENCODE_COMMAND`: executable or argv prefix for OpenCode.
- `HACKON_OPENCODE_AUTO_APPROVE=1`: opt into OpenCode auto-approval.

Auto-approval is intentionally opt-in. Network and external side effects are
not enabled by the default HackOn config.
