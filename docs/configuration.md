# Configuration

`hackon init` creates `.hackon/config.json`. The current adapter can also be
configured with:

- `OPENAI_API_KEY`: credential passed to the Factory Droid subprocess.
- `HACKON_DROID_COMMAND`: Factory Droid executable or argv prefix.
- `HACKON_DROID_MODEL`: optional Droid model ID, including a custom BYOK model.
- `HACKON_OPENCODE_COMMAND`: executable or argv prefix for OpenCode.
- `HACKON_OPENCODE_AUTO_APPROVE=1`: opt into OpenCode auto-approval.
- `HACKON_PASSTHROUGH_ENV`: comma-separated environment variable names
  explicitly approved for adapter subprocesses.

Factory Droid is the default. `FACTORY_API_KEY` is not used by HackOn's
adapter. Auto-approval is intentionally opt-in. Network and external side
effects are not enabled by the default HackOn config. The runtime allowlists
the adapter environment; it does not replace an OS-level sandbox.

To use OpenAI directly through Droid BYOK, configure the Droid CLI once in
`~/.factory/settings.json` without placing the key in the file:

```json
{
  "customModels": [{
    "model": "hackon-openai",
    "displayName": "HackOn OpenAI",
    "baseUrl": "https://api.openai.com/v1",
    "apiKey": "${OPENAI_API_KEY}",
    "provider": "openai",
    "maxOutputTokens": 16384
  }]
}
```

Then set `HACKON_DROID_MODEL=hackon-openai`. The adapter passes
`OPENAI_API_KEY` to Droid, never persists its value, and records only the
selected model ID.
