import type { Evidence, GateResult, QualityGate, RunState } from "./domain.js";

function matching(run: RunState, stageId: string, kind?: Evidence["kind"]): Evidence[] {
  return run.evidence.filter((item) => item.stageId === stageId && (!kind || item.kind === kind));
}

export function evaluateGate(gate: QualityGate, run: RunState, stageId: string): GateResult {
  const all = matching(run, stageId);
  const command = all.filter((item) => item.kind === "CommandEvidence");
  const reviews = all.filter((item) => item.kind === "ReviewEvidence");
  let passed = false;
  let message = gate.description;
  switch (gate.type) {
    case "artifact_exists":
      passed = all.some((item) => item.result === "pass" && item.metadata.exists === true);
      break;
    case "schema_valid":
      passed = all.some((item) => item.metadata.schemaValid === true);
      break;
    case "diff_exists":
      passed = all.some((item) => item.kind === "DiffEvidence" && item.result === "pass" && item.metadata.changed === true);
      break;
    case "command_exit_zero":
      passed = command.some((item) => item.result === "pass" && item.metadata.exitCode === 0);
      break;
    case "tests_pass":
      passed = all.some((item) => item.kind === "TestEvidence" && item.result === "pass" && item.metadata.exitCode === 0);
      break;
    case "build_pass":
      passed = all.some((item) => item.kind === "BuildEvidence" && item.result === "pass" && item.metadata.exitCode === 0);
      break;
    case "lint_pass":
    case "typecheck_pass":
      passed = command.some((item) => item.result === "pass" && item.metadata.exitCode === 0 &&
        String(item.metadata.command ?? "").includes(gate.type === "lint_pass" ? "lint" : "typecheck"));
      break;
    case "review_approved":
      passed = reviews.some((item) => item.result === "pass" && item.metadata.approved === true);
      break;
    case "no_blocker_findings":
      passed = reviews.length > 0 && reviews.every((item) => Number(item.metadata.blockerCount ?? 1) === 0);
      break;
    case "human_approval":
      passed = all.some((item) => item.kind === "HumanApprovalEvidence" && item.metadata.approved === true);
      break;
    case "metric_threshold": {
      const metric = all.find((item) => item.kind === "MetricEvidence");
      const value = Number(metric?.metadata.value);
      const threshold = Number(gate.config?.threshold);
      const operator = gate.config?.operator ?? ">=";
      passed = metric !== undefined && Number.isFinite(value) && (operator === ">=" ? value >= threshold : value <= threshold);
      message = `${metric?.metadata.metric ?? "metric"} ${operator} ${threshold}; observed ${value}`;
      break;
    }
    case "coverage_threshold": {
      const coverage = Number(all.find((item) => item.metadata.coverage !== undefined)?.metadata.coverage);
      passed = Number.isFinite(coverage) && coverage >= Number(gate.config?.threshold ?? 0);
      break;
    }
    case "security_scan":
      passed = all.some((item) => item.metadata.vulnerabilities === 0 && item.result === "pass");
      break;
  }
  return { gateId: gate.id, type: gate.type, passed, blocking: gate.blocking, message: passed ? `PASS: ${message}` : `FAIL: ${message}` };
}

export function evaluateGates(gates: QualityGate[], run: RunState, stageId: string): GateResult[] {
  return gates.map((gate) => evaluateGate(gate, run, stageId));
}
