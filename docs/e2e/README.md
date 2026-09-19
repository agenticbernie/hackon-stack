# Canonical E2E evidence

The live E2E test writes a sanitized snapshot here when it is run with:

```bash
HACKON_REAL_E2E=1 HACKON_OPENCODE_AUTO_APPROVE=1 npm run e2e:real
```

The snapshot contains the persisted run summary, evidence, command evidence,
diff, and independent review records. It must not contain credentials or raw
provider secrets. A snapshot is evidence for the exact fixture and commit that
generated it; it is not a substitute for rerunning the test in a clean
environment.
