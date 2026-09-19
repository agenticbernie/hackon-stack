import type { Evidence, GateResult, QualityGate, RunState } from "./domain.js";

function matching(run: RunState, stageId: string, kind?: Evidence["kind"]): Evidence[] {
  return run.evidence.filter((item) => item.stageId === stageId && (!kind || item.kind === kind));
}

function verifiedPass(items: Evidence[]): Evidence[] {
  return items.filter((item) => item.result === "pass" && item.verification === "verified");
}

export function evaluateGate(gate: QualityGate, run: RunState, stageId: string): GateResult {
  const all = matching(run, stageId);
  const command = all.filter((item) => item.kind === "CommandEvidence");
  const reviews = all.filter((item) => item.kind === "ReviewEvidence");
  let passed = false;
  let message = gate.description;
  switch (gate.type) {
    case "artifact_exists":
      passed = verifiedPass(all).some((item) => item.metadata.exists === true);
      break;
    case "schema_valid":
      passed = verifiedPass(all).some((item) => item.metadata.schemaValid === true);
      break;
    case "diff_exists":
      passed = verifiedPass(all.filter((item) => item.kind === "DiffEvidence")).some((item) => item.metadata.changed === true);
      break;
    case "command_exit_zero":
      passed = verifiedPass(command).some((item) => item.metadata.exitCode === 0);
      break;
    case "tests_pass":
      passed = verifiedPass(all.filter((item) => item.kind === "TestEvidence")).some((item) => item.metadata.exitCode === 0);
      break;
    case "build_pass":
      passed = verifiedPass(all.filter((item) => item.kind === "BuildEvidence")).some((item) => item.metadata.exitCode === 0);
      break;
    case "lint_pass":
    case "typecheck_pass":
      passed = verifiedPass(command).some((item) => item.metadata.exitCode === 0 &&
        String(item.metadata.command ?? "").includes(gate.type === "lint_pass" ? "lint" : "typecheck"));
      break;
    case "review_approved":
      passed = verifiedPass(reviews).some((item) => item.metadata.approved === true);
      break;
    case "no_blocker_findings":
      passed = reviews.length > 0 && reviews.every((item) => item.result === "pass" && item.verification === "verified" && Number(item.metadata.blockerCount ?? 1) === 0);
      break;
    case "human_approval":
      passed = verifiedPass(all.filter((item) => item.kind === "HumanApprovalEvidence")).some((item) => item.metadata.approved === true);
      break;
    case "metric_threshold": {
      const metric = all.find((item) => item.kind === "MetricEvidence");
      const value = Number(metric?.metadata.value);
      const threshold = Number(gate.config?.threshold);
      const operator = gate.config?.operator ?? ">=";
      passed = metric !== undefined && metric.verification === "verified" && metric.result === "pass" && Number.isFinite(value) && (operator === ">=" ? value >= threshold : value <= threshold);
      message = `${metric?.metadata.metric ?? "metric"} ${operator} ${threshold}; observed ${value}`;
      break;
    }
    case "coverage_threshold": {
      const coverageEvidence = all.find((item) => item.metadata.coverage !== undefined);
      const coverage = Number(coverageEvidence?.metadata.coverage);
      passed = coverageEvidence?.verification === "verified" &&
        coverageEvidence.result === "pass" &&
        Number.isFinite(coverage) &&
        coverage >= Number(gate.config?.threshold ?? 0);
      break;
    }
    case "security_scan":
      passed = verifiedPass(all).some((item) => item.metadata.vulnerabilities === 0);
      break;
    case "agent_succeeded":
      passed = verifiedPass(all.filter((item) => item.kind === "AgentEvidence")).some((item) => item.metadata.agentSucceeded === true);
      break;
  }
  return { gateId: gate.id, type: gate.type, passed, blocking: gate.blocking, message: passed ? `PASS: ${message}` : `FAIL: ${message}` };
}

export function evaluateGates(gates: QualityGate[], run: RunState, stageId: string): GateResult[] {
  return gates.map((gate) => evaluateGate(gate, run, stageId));
}
