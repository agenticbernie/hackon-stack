---
name: tdd
description: Drive implementation with a failing behavioral test, a minimal root-cause change, and a verified regression suite.
---

# Test-driven implementation

1. Convert acceptance criteria into observable behavior and edge cases.
2. Add the smallest failing test. Run it and capture the failure.
3. Implement only enough production behavior to satisfy that test.
4. Refactor for clarity while keeping the test green.
5. Run focused, adjacent, and full project tests. Add typecheck/lint/build
   evidence where the project exposes those commands.
6. Never weaken an assertion, skip a regression, or hardcode a fixture result
   to obtain green output.
