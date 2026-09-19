# Canonical E2E evidence

The live E2E test writes a sanitized snapshot here when it is run with:

```bash
OPENAI_API_KEY=... HACKON_DROID_MODEL=custom:gpt-5.6-terra-1 npm run e2e:factory
```

The snapshot contains the persisted run summary, evidence, command evidence,
diff, and independent review records. It must not contain credentials or raw
provider secrets. The Factory Droid adapter receives `OPENAI_API_KEY` through
its allowlisted child environment; `FACTORY_API_KEY` is not used. A snapshot
is evidence for the exact fixture and commit that generated it; it is not a
substitute for rerunning the test in a clean environment.
