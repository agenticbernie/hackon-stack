# Configuration

`hackon init` creates `.hackon/config.json`. The current adapter can also be
configured with:

- `HACKON_OPENCODE_COMMAND`: executable or argv prefix for OpenCode.
- `HACKON_OPENCODE_AUTO_APPROVE=1`: opt into OpenCode auto-approval.
- `HACKON_PASSTHROUGH_ENV`: comma-separated environment variable names
  explicitly approved for adapter subprocesses.

Auto-approval is intentionally opt-in. Network and external side effects are
not enabled by the default HackOn config. The runtime allowlists the adapter
environment; it does not replace an OS-level sandbox.
