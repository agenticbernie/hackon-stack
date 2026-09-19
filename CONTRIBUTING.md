# Contributing

1. Use Node.js 20 or newer.
2. Run `npm install`, `npm run lint`, `npm test`, and `npm run pack:check`.
3. Keep workflow completion evidence-based. Do not replace a real execution
   path with a fixture that writes the expected answer.
4. Add unit or integration coverage for new contracts and failure paths.
5. Keep adapter-specific behavior behind `AgentAdapter`.

Pull requests should explain the evidence produced and the gates exercised.
