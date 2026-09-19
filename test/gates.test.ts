import test from "node:test";
import assert from "node:assert/strict";
import { evaluateGate } from "../src/gates.js";
import { evidence, type RunState } from "../src/domain.js";

function runWith(...items: ReturnType<typeof evidence>[]): RunState {
  return { id: "r", workflowId: "w", objective: "o", workspace: "/tmp", status: "running", createdAt: "", updatedAt: "", stages: { s: { id: "s", status: "running", attempts: 1 } }, evidence: items, selectedContext: [], stageBaselines: {} };
}

test("machine gates require machine evidence rather than textual claims", () => {
  const claim = evidence({ kind: "AgentEvidence", producer: "agent", stageId: "s", source: "agent", result: "pass", metadata: { output: "tests pass" } });
  assert.equal(evaluateGate({ id: "tests", type: "tests_pass", blocking: true, description: "tests" }, runWith(claim), "s").passed, false);
  const command = evidence({ kind: "TestEvidence", producer: "runner", stageId: "s", source: "npm test", result: "pass", verification: "verified", metadata: { exitCode: 0 } });
  assert.equal(evaluateGate({ id: "tests", type: "tests_pass", blocking: true, description: "tests" }, runWith(command), "s").passed, true);
  const unverified = evidence({ kind: "TestEvidence", producer: "agent", stageId: "s", source: "claimed", result: "pass", metadata: { exitCode: 0 } });
  assert.equal(evaluateGate({ id: "tests", type: "tests_pass", blocking: true, description: "tests" }, runWith(unverified), "s").passed, false);
});

test("review and metric gates are independently evaluated", () => {
  const review = evidence({ kind: "ReviewEvidence", producer: "reviewer", stageId: "s", source: "review", result: "pass", verification: "verified", metadata: { approved: true, blockerCount: 0 } });
  assert.equal(evaluateGate({ id: "review", type: "review_approved", blocking: true, description: "review" }, runWith(review), "s").passed, true);
  const metric = evidence({ kind: "MetricEvidence", producer: "analytics", stageId: "s", source: "fixture", result: "pass", verification: "verified", metadata: { metric: "activation", value: 0.42 } });
  assert.equal(evaluateGate({ id: "metric", type: "metric_threshold", blocking: true, description: "metric", config: { threshold: 0.4, operator: ">=" } }, runWith(metric), "s").passed, true);
});
