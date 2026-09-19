import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Evidence, ReviewResult, StageDefinition, StageContext, WorkflowDefinition } from "./domain.js";
import { evidence } from "./domain.js";
import { agentEvidence, captureStageBaseline } from "./orchestrator.js";

function reviewDecision(output: string, ok: boolean): { blockerCount: number; approved: boolean; review?: ReviewResult; validSchema: boolean } {
  if (!ok) return { blockerCount: 0, approved: false, validSchema: false };
  const tryValue = (value: Partial<ReviewResult>) => {
    if (typeof value.approved !== "boolean" || typeof value.summary !== "string" || !Array.isArray(value.findings)) {
      return undefined;
    }
    const findings = value.findings.filter((finding) => {
      if (!finding || typeof finding !== "object") return false;
      const candidate = finding as Partial<ReviewResult["findings"][number]>;
      return typeof candidate.id === "string" &&
        ["BLOCKER", "MAJOR", "MINOR", "NOTE"].includes(String(candidate.severity)) &&
        typeof candidate.category === "string" &&
        typeof candidate.finding === "string" &&
        typeof candidate.evidence === "string" &&
        typeof candidate.recommendedFix === "string" &&
        (candidate.file === undefined || typeof candidate.file === "string") &&
        (candidate.line === undefined || typeof candidate.line === "number") &&
        (candidate.status === undefined || ["open", "fixed", "invalidated", "accepted-risk"].includes(candidate.status));
    });
    const review = { approved: value.approved, summary: value.summary, findings } as ReviewResult;
    const blockerCount = findings.filter((finding) => finding.severity === "BLOCKER" && finding.status !== "invalidated" && finding.status !== "fixed").length;
    const validSchema = findings.length === value.findings.length;
    return { blockerCount, approved: value.approved && blockerCount === 0 && validSchema, review, validSchema };
  };
  const strings: string[] = [output];
  for (const line of output.split("\n").slice(-500)) {
    try {
      const value = JSON.parse(line) as unknown;
      const visit = (item: unknown): void => {
        if (typeof item === "string") strings.push(item);
        else if (Array.isArray(item)) item.forEach(visit);
        else if (item && typeof item === "object") Object.values(item).forEach(visit);
      };
      visit(value);
    } catch {
      // OpenCode may emit non-JSON progress lines around its JSON events.
    }
  }
  for (const candidate of strings.slice(-1_000)) {
    try {
      const direct = tryValue(JSON.parse(candidate) as Partial<ReviewResult>);
      if (direct) return direct;
    } catch {
      // Search embedded final JSON below.
    }
    for (let start = candidate.indexOf("{"); start >= 0; start = candidate.indexOf("{", start + 1)) {
      if (!candidate.slice(start, Math.min(candidate.length, start + 240)).includes("\"approved\"")) continue;
      let depth = 0;
      let quoted = false;
      let escaped = false;
      for (let end = start; end < candidate.length; end += 1) {
        const character = candidate[end];
        if (quoted) {
          if (escaped) escaped = false;
          else if (character === "\\") escaped = true;
          else if (character === "\"") quoted = false;
          continue;
        }
        if (character === "\"") quoted = true;
        else if (character === "{") depth += 1;
        else if (character === "}" && --depth === 0) {
          try {
            const embedded = tryValue(JSON.parse(candidate.slice(start, end + 1)) as Partial<ReviewResult>);
            if (embedded) return embedded;
          } catch {
            // Keep scanning for the next balanced JSON object.
          }
          break;
        }
      }
    }
  }
  return { blockerCount: 0, approved: false, validSchema: false };
}

async function findArtifact(workspace: string, pattern: RegExp): Promise<string | undefined> {
  const visit = async (directory: string, depth: number): Promise<string | undefined> => {
    if (depth > 8) return undefined;
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      return undefined;
    }
    for (const entry of entries) {
      if (["node_modules", ".git", "dist", "coverage"].includes(entry.name)) continue;
      if (entry.isSymbolicLink()) continue;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        const found = await visit(path, depth + 1);
        if (found) return found;
      } else if (pattern.test(entry.name)) {
        return path;
      }
    }
    return undefined;
  };
  return visit(workspace, 0);
}

function commandEvidence(stageId: string, kind: Evidence["kind"], result: Awaited<ReturnType<StageContext["tools"]["run"]>>): Evidence {
  return evidence({
    kind,
    producer: "hackon-tool-runner",
    stageId,
    source: result.command,
    result: result.exitCode === 0 && !result.timedOut ? "pass" : "fail",
    verification: "verified",
    metadata: { ...result, command: result.command, exitCode: result.exitCode },
  });
}

async function askAgent(context: StageContext, prompt: string, role: string, permissions: StageDefinition["permissions"]): Promise<Evidence> {
  const result = await context.adapter.run({
    objective: context.run.objective,
    stageId: context.stage.id,
    role,
    prompt,
    workspace: context.run.workspace,
    permissions,
    context: context.context,
  });
  recordSession(context, result.sessionId);
  return agentEvidence(context.stage.id, result.source, result.output, result.ok, {
    agentSucceeded: result.ok,
    error: result.error,
    sessionId: result.sessionId,
    adapterMetadata: result.metadata,
  });
}

function recordSession(context: StageContext, sessionId: string | undefined): void {
  if (!sessionId) return;
  context.run.adapterSessions ??= {};
  context.run.adapterSessions[context.stage.id] = {
    adapter: context.adapter.id,
    sessionId,
    stageId: context.stage.id,
    createdAt: new Date().toISOString(),
  };
}

async function runProjectCommand(context: StageContext, intent: "test" | "build" | "lint" | "typecheck" | "security", kind: Evidence["kind"]): Promise<Evidence> {
  const argv = context.run.projectProfile?.commands[intent];
  if (!argv) {
    return evidence({
      kind,
      producer: "hackon-project-profile",
      stageId: context.stage.id,
      source: `profile.commands.${intent}`,
      result: "informational",
      verification: "verified",
      metadata: { available: false, intent, projectProfile: context.run.projectProfile },
    });
  }
  const result = await context.tools.run({ argv, cwd: context.run.workspace, permissions: ["read", "execute"] });
  return commandEvidence(context.stage.id, kind, result);
}

function agentStage(id: string, title: string, dependsOn: string[], role: string, prompt: string, writes: boolean, permissions: StageDefinition["permissions"], gates: StageDefinition["gates"] = []): StageDefinition {
  const agentGates: StageDefinition["gates"] = [
    { id: `${id}-agent-succeeded`, type: "agent_succeeded", blocking: true, description: "Agent execution completed successfully" },
    ...gates,
  ];
  return {
    id,
    title,
    dependsOn,
    writes,
    permissions,
    gates: agentGates,
    retry: { maxAttempts: 2, backoffMs: 250 },
    async execute(context) {
      const item = await askAgent(context, prompt, role, permissions);
      return [item];
    },
  };
}

function commandStage(id: string, title: string, dependsOn: string[], intent: "test" | "build" | "lint" | "typecheck" | "security", kind: Evidence["kind"], gates: StageDefinition["gates"]): StageDefinition {
  return {
    id,
    title,
    dependsOn,
    writes: false,
    permissions: ["read", "execute"],
    gates,
    async execute(context) {
      return [await runProjectCommand(context, intent, kind)];
    },
  };
}

function approvalStage(id: string, title: string, dependsOn: string[]): StageDefinition {
  return {
    id, title, dependsOn, writes: false, permissions: ["read"],
    gates: [{ id: `${id}-approval`, type: "human_approval", blocking: true, description: "Human approval is required before any irreversible action" }],
    async execute(context) {
      const approved = process.env.HACKON_HUMAN_APPROVAL === "1";
      return [evidence({
        kind: "HumanApprovalEvidence", producer: "hackon-orchestrator", stageId: id, source: "HACKON_HUMAN_APPROVAL",
        result: approved ? "pass" : "informational", verification: "verified",
        metadata: { approved, irreversibleActionAllowed: approved, required: true },
      })];
    },
  };
}

function testStage(id: string, title: string, dependsOn: string[], gate: "tests_pass" | "tests_fail"): StageDefinition {
  return commandStage(id, title, dependsOn, "test", "TestEvidence", [
    { id: `${id}-${gate}`, type: gate, blocking: true, description: gate === "tests_fail" ? "The regression is observably failing before the fix" : "Tests pass" },
  ]);
}

function metricStage(id: string, title: string, dependsOn: string[]): StageDefinition {
  return {
    id, title, dependsOn, writes: false, permissions: ["read"],
    gates: [{ id: `${id}-valid`, type: "metric_valid", blocking: true, description: "Metric evidence is machine-readable" }],
    async execute(context) {
      try {
        const value = JSON.parse(await readFile(join(context.run.workspace, ".hackon", "metrics.json"), "utf8")) as { metric: string; value: number; threshold?: number; decision?: string };
        const valid = typeof value.metric === "string" && Number.isFinite(value.value);
        return [evidence({ kind: "MetricEvidence", producer: "hackon-metric-ingestion", stageId: id, source: ".hackon/metrics.json", result: valid ? "pass" : "fail", verification: "verified", metadata: value })];
      } catch (error) {
        return [evidence({ kind: "MetricEvidence", producer: "hackon-metric-ingestion", stageId: id, source: ".hackon/metrics.json", result: "fail", verification: "verified", metadata: { available: false, error: error instanceof Error ? error.message : String(error) } })];
      }
    },
  };
}

function learningStage(dependsOn: string[]): StageDefinition {
  const base = agentStage("learn", "Compound learning", dependsOn, "learning facilitator", "Write a durable retrospective in .hackon/learning with decisions, evidence, unresolved uncertainty, retrieval cues, and how future work should change.", true, ["read", "write"]);
  return {
    ...base,
    gates: [...base.gates, { id: "learning-artifact", type: "artifact_exists", blocking: true, description: "A durable learning artifact exists" }],
    execute: async (context) => {
      const item = await askAgent(context, "Write a durable retrospective in .hackon/learning with decisions, evidence, unresolved uncertainty, retrieval cues, and how future work should change.", "learning facilitator", ["read", "write"]);
      const artifact = await findArtifact(join(context.run.workspace, ".hackon", "learning"), /.+/);
      return [item, evidence({ kind: "FileEvidence", producer: "hackon-orchestrator", stageId: "learn", source: artifact ?? ".hackon/learning", result: artifact ? "pass" : "fail", verification: "verified", metadata: { exists: Boolean(artifact), path: artifact } })];
    },
  };
}

function nonCodingWorkflowStages(id: string): StageDefinition[] | undefined {
  if (id === "weekly-founder-review") return [
    agentStage("product-signals", "Product signals", [], "product signal analyst", "Review current product decisions, user outcomes, and commitments. Record observed signals and uncertainty.", false, ["read"]),
    agentStage("engineering-signals", "Engineering signals", ["product-signals"], "engineering lead", "Review engineering status, quality, reliability, debt, and delivery risks. Do not implement or run project commands.", false, ["read"]),
    agentStage("growth-signals", "Growth signals", ["product-signals"], "growth lead", "Review funnel, experiment, and customer signals. Record measured values and missing instrumentation.", false, ["read"]),
    agentStage("business-signals", "Business signals", ["product-signals"], "business lead", "Review business commitments, pricing, pipeline, and customer signals. Separate evidence from forecast.", false, ["read"]),
    agentStage("risk-register", "Risk register", ["engineering-signals", "growth-signals", "business-signals"], "risk lead", "Synthesize the risk register and unresolved decisions. Do not modify product code.", false, ["read"]),
    agentStage("decision-review", "Decision review", ["risk-register"], "founder decision reviewer", "Choose priority changes and explicit decisions from the signals. Record alternatives and revisit triggers.", true, ["read", "write"]),
    agentStage("commitments", "New commitments", ["decision-review"], "operating partner", "Turn decisions into owned, dated commitments and follow-up work items. Do not implement them here.", true, ["read", "write"]),
    agentStage("learn", "Compound learning", ["commitments"], "learning facilitator", "Write the founder review retrospective and retrieval cues.", true, ["read", "write"], [{ id: "learning-artifact", type: "artifact_exists", blocking: true, description: "Learning artifact exists" }]),
  ];
  if (id === "pivot") return [
    agentStage("current-thesis", "Current thesis", [], "strategy analyst", "State the current thesis, target user, mechanism, and success condition.", false, ["read"]),
    agentStage("evidence-against", "Evidence against thesis", ["current-thesis"], "evidence analyst", "Find evidence against the thesis and identify invalidated assumptions. Do not code.", false, ["read"]),
    agentStage("alternative-theses", "Alternative theses", ["evidence-against"], "strategy lead", "Generate and compare alternative theses, including reversibility and downside.", false, ["read"]),
    agentStage("pivot-decision", "Pivot decision", ["alternative-theses"], "decision maker", "Record stop, continue, research, prototype, or pivot with evidence and confidence.", true, ["read", "write"]),
    agentStage("transition-plan", "Transition plan", ["pivot-decision"], "transition planner", "Define the reversible transition and validation plan. Do not implement product code.", true, ["read", "write"]),
    agentStage("learn", "Compound learning", ["transition-plan"], "learning facilitator", "Record the pivot rationale and retrieval cues.", true, ["read", "write"], [{ id: "learning-artifact", type: "artifact_exists", blocking: true, description: "Learning artifact exists" }]),
  ];
  if (id === "idea-to-product") return [
    agentStage("idea", "Idea", [], "idea analyst", "Clarify the idea and its intended outcome.", false, ["read"]),
    agentStage("user-problem", "User and problem", ["idea"], "customer researcher", "Identify target user, job, trigger, alternatives, and problem evidence.", false, ["read"]),
    agentStage("assumptions", "Assumptions", ["user-problem"], "assumption mapper", "Rank desirability, viability, feasibility, and usability assumptions.", false, ["read"]),
    agentStage("opportunity", "Opportunity", ["assumptions"], "product strategist", "Compare opportunity evidence and define the product hypothesis.", true, ["read", "write"]),
    agentStage("idea-decision", "Idea decision", ["opportunity"], "decision maker", "Choose stop, research, prototype, or MVP. Enter implementation only through a new approved workflow.", true, ["read", "write"]),
    agentStage("learn", "Compound learning", ["idea-decision"], "learning facilitator", "Record the idea decision and retrieval cues.", true, ["read", "write"], [{ id: "learning-artifact", type: "artifact_exists", blocking: true, description: "Learning artifact exists" }]),
  ];
  if (id === "customer-request") return [
    agentStage("literal-request", "Literal request", [], "customer advocate", "Record the request exactly and preserve source evidence.", false, ["read"]),
    agentStage("underlying-job", "Underlying job", ["literal-request"], "customer researcher", "Identify the underlying job, affected segment, frequency, and workaround.", false, ["read"]),
    agentStage("product-fit", "Product-fit decision", ["underlying-job"], "product decision maker", "Decide whether the request generalizes into a product problem. Do not implement unless explicitly approved.", true, ["read", "write"]),
    agentStage("learn", "Compound learning", ["product-fit"], "learning facilitator", "Record the request triage and retrieval cues.", true, ["read", "write"], [{ id: "learning-artifact", type: "artifact_exists", blocking: true, description: "Learning artifact exists" }]),
  ];
  if (id === "bug-fix") return [
    agentStage("bug-intake", "Bug intake", [], "bug investigator", "Capture the observed defect, impact, environment, and expected behavior.", false, ["read"]),
    agentStage("reproduce", "Reproduce bug", ["bug-intake"], "reproduction engineer", "Create a minimal reproducible fixture and record the observable failure without applying a fix.", true, ["read", "write", "execute"]),
    agentStage("regression-red", "Regression test RED", ["reproduce"], "test engineer", "Add the smallest regression test that demonstrates the bug. Do not fix the implementation.", true, ["read", "write", "execute"]),
    testStage("regression-red-check", "Verify regression fails", ["regression-red"], "tests_fail"),
    agentStage("root-cause", "Root-cause investigation", ["regression-red-check"], "debugging investigator", "Trace the failure, record competing hypotheses, and falsify them with evidence.", true, ["read", "write"]),
    agentStage("bug-fix", "Apply bug fix", ["root-cause"], "implementation engineer", "Implement the minimal root-cause fix while preserving the failing regression test.", true, ["read", "write", "execute"]),
    testStage("regression-green", "Verify regression passes", ["bug-fix"], "tests_pass"),
    testStage("adjacent-regression", "Run adjacent regression suite", ["regression-green"], "tests_pass"),
    reviewStage("bug-review", "bug-fix", "root cause, regression coverage, and unintended behavior", "adjacent-regression"),
    agentStage("bug-fix-consolidate", "Consolidate bug review", ["bug-review"], "review lead", "Summarize bug review findings and required fixes as structured JSON.", false, ["read"]),
    agentStage("bug-fix-repair", "Repair review findings", ["bug-fix-consolidate"], "senior engineer", "Repair blocking bug review findings and preserve the RED-to-GREEN regression evidence.", true, ["read", "write", "execute"]),
    targetedReReviewStage("bug-fix-repair"),
    testStage("bug-final-verification", "Final bug verification", ["targeted-re-review"], "tests_pass"),
    learningStage(["bug-final-verification"]),
  ];
  if (id === "zero-to-mvp") return [
    agentStage("problem-framing", "Problem framing", [], "problem researcher", "Frame the target user's problem, trigger, consequence, alternatives, and evidence.", false, ["read"]),
    agentStage("target-user", "Target user", ["problem-framing"], "customer researcher", "Define the narrow target user and job to be done.", false, ["read"]),
    agentStage("assumptions", "Assumptions", ["target-user"], "assumption mapper", "Rank riskiest desirability, viability, feasibility, and usability assumptions.", false, ["read"]),
    agentStage("research", "Evidence and research", ["assumptions"], "researcher", "Gather or inspect evidence and distinguish facts, estimates, and unknowns.", false, ["read"]),
    agentStage("mvp-hypothesis", "MVP hypothesis", ["research"], "MVP strategist", "Define the thin vertical slice, explicit non-goals, and learning decision.", true, ["read", "write"]),
    agentStage("ux-flow", "UX flow", ["mvp-hypothesis"], "UX designer", "Specify the smallest usable flow, states, errors, and accessibility requirements.", true, ["read", "write"]),
    agentStage("mvp-architecture", "MVP architecture", ["ux-flow"], "architect", "Design the smallest reversible architecture and implementation plan.", true, ["read", "write"]),
    agentStage("mvp-implementation", "MVP implementation", ["mvp-architecture"], "implementation engineer", "Implement the runnable MVP vertical slice with acceptance tests.", true, ["read", "write", "execute"]),
    testStage("mvp-acceptance", "MVP acceptance tests", ["mvp-implementation"], "tests_pass"),
    reviewStage("product-review", "product", "MVP scope, user value, and acceptance criteria", "mvp-acceptance"),
    reviewStage("engineering-security-review", "engineering/security", "architecture, security, and runnable MVP quality", "mvp-acceptance"),
    testStage("mvp-runnable", "Runnable MVP verification", ["product-review", "engineering-security-review"], "tests_pass"),
    learningStage(["mvp-runnable"]),
  ];
  if (id === "growth-experiment") return [
    agentStage("funnel-diagnosis", "Funnel diagnosis", [], "growth analyst", "Diagnose the funnel from existing evidence and identify a constrained opportunity.", false, ["read"]),
    agentStage("segment-definition", "Segment definition", ["funnel-diagnosis"], "growth analyst", "Define the segment, exposure, and exclusion criteria.", false, ["read"]),
    agentStage("instrumentation-audit", "Instrumentation audit", ["segment-definition"], "analytics engineer", "Audit event taxonomy and data quality. Record missing instrumentation.", false, ["read"]),
    agentStage("baseline", "Baseline", ["instrumentation-audit"], "data analyst", "Record the baseline, observation window, and uncertainty.", false, ["read"]),
    agentStage("hypothesis", "Experiment hypothesis", ["baseline"], "growth scientist", "Define mechanism, primary metric, guardrails, threshold, and stopping rule.", true, ["read", "write"]),
    agentStage("experiment-design", "Experiment design", ["hypothesis"], "experiment designer", "Design a reversible experiment and implementation/instrumentation plan.", true, ["read", "write"]),
    agentStage("experiment-implementation", "Experiment implementation", ["experiment-design"], "growth engineer", "Implement only the instrumentation or experiment required by the design.", true, ["read", "write", "execute"]),
    metricStage("outcome-ingestion", "Outcome ingestion", ["experiment-implementation"],),
    agentStage("interpretation", "Interpretation", ["outcome-ingestion"], "growth scientist", "Interpret the observed metric and guardrails without manufacturing significance.", false, ["read"]),
    agentStage("growth-decision", "Growth decision", ["interpretation"], "growth decision maker", "Choose continue, iterate, stop, or investigate based on the recorded metric.", true, ["read", "write"]),
    learningStage(["growth-decision"]),
  ];
  if (id === "production-incident") return [
    agentStage("incident-intake", "Incident intake", [], "incident commander", "Capture impact, severity, affected users, and timeline.", true, ["read", "write"]),
    agentStage("evidence-preservation", "Evidence preservation", ["incident-intake"], "incident investigator", "Preserve logs, state, and a timeline without mutating production.", true, ["read", "write"]),
    agentStage("containment-plan", "Containment plan", ["evidence-preservation"], "incident commander", "Define reversible containment and explicit dangerous actions requiring approval.", true, ["read", "write"]),
    approvalStage("containment-approval", "Human containment approval", ["containment-plan"]),
    agentStage("containment", "Containment", ["containment-approval"], "incident responder", "Execute only approved, reversible containment actions.", true, ["read", "write", "execute"]),
    agentStage("diagnosis", "Diagnosis", ["containment"], "incident investigator", "Investigate root cause and contributing conditions.", false, ["read"]),
    agentStage("remediation", "Remediation", ["diagnosis"], "senior engineer", "Implement a reversible remediation and verification plan.", true, ["read", "write", "execute"]),
    testStage("incident-verification", "Incident verification", ["remediation"], "tests_pass"),
    agentStage("recovery", "Recovery", ["incident-verification"], "incident commander", "Define and verify recovery without automatic irreversible production action.", false, ["read"]),
    agentStage("observability-check", "Observability check", ["recovery"], "SRE", "Verify alerts, dashboards, and runbooks cover the failure mode.", false, ["read"]),
    learningStage(["observability-check"]),
  ];
  if (id === "launch") return [
    agentStage("release-scope", "Release scope", [], "release manager", "Define release scope and acceptance evidence.", false, ["read"]),
    agentStage("acceptance-verification", "Acceptance verification", ["release-scope"], "QA lead", "Verify acceptance evidence and unresolved risks.", false, ["read"]),
    agentStage("security-readiness", "Security readiness", ["acceptance-verification"], "security lead", "Verify security checks and residual risk.", false, ["read"]),
    agentStage("operational-readiness", "Operational readiness", ["security-readiness"], "SRE", "Verify observability, migration, rollback, and support readiness.", false, ["read"]),
    agentStage("communication", "Communication", ["operational-readiness"], "launch manager", "Prepare release communication and support handoff.", true, ["read", "write"]),
    approvalStage("launch-approval", "Human launch approval", ["communication"]),
    agentStage("launch-decision", "Launch decision", ["launch-approval"], "release manager", "Record READY_FOR_LAUNCH unless explicit human approval authorizes an external launch. Do not deploy.", true, ["read", "write"]),
    agentStage("post-launch-verification", "Post-launch verification", ["launch-decision"], "release verifier", "Record the verification plan and observed result when launch is authorized.", false, ["read"]),
    learningStage(["post-launch-verification"]),
  ];
  if (id === "product-improvement") return [
    agentStage("customer-evidence", "Customer evidence", [], "customer researcher", "Separate observed user behavior, direct requests, and inferred needs. Preserve source and confidence.", false, ["read"]),
    agentStage("behavior-baseline", "Behavior baseline", ["customer-evidence"], "product analyst", "Record current behavior, outcome, and unmet need using measurable baseline evidence.", false, ["read"]),
    agentStage("improvement-hypothesis", "Improvement hypothesis", ["behavior-baseline"], "product strategist", "Define the smallest improvement, target segment, mechanism, metric, and non-goals.", true, ["read", "write"]),
    agentStage("ux-specification", "UX specification", ["improvement-hypothesis"], "UX designer", "Specify the user flow, states, accessibility, copy, and failure behavior before implementation.", true, ["read", "write"]),
    agentStage("product-implementation", "Product implementation", ["ux-specification"], "product engineer", "Implement the smallest product improvement with an acceptance test and instrumentation where needed.", true, ["read", "write", "execute"]),
    testStage("product-acceptance", "Product acceptance", ["product-implementation"], "tests_pass"),
    agentStage("product-review", "Product review", ["product-acceptance"], "product reviewer", "Review the improvement against user evidence, scope, accessibility, and acceptance criteria. Return structured findings.", false, ["read"]),
    learningStage(["product-review"]),
  ];
  if (id === "technical-debt") return [
    agentStage("debt-inventory", "Debt inventory", [], "technical lead", "Map debt items to affected behavior, ownership, risk, frequency, and evidence.", false, ["read"]),
    agentStage("debt-prioritization", "Debt prioritization", ["debt-inventory"], "engineering manager", "Prioritize debt by risk reduction, leverage, reversibility, and opportunity cost.", true, ["read", "write"]),
    agentStage("characterization-plan", "Characterization plan", ["debt-prioritization"], "test engineer", "Define behavior-preserving characterization coverage before changing internals.", true, ["read", "write"]),
    agentStage("characterization-tests", "Characterization tests", ["characterization-plan"], "test engineer", "Add characterization tests for the selected debt boundary without refactoring yet.", true, ["read", "write", "execute"]),
    testStage("characterization-verification", "Characterization verification", ["characterization-tests"], "tests_pass"),
    agentStage("debt-refactor", "Debt refactor", ["characterization-verification"], "refactoring engineer", "Refactor the selected debt boundary while preserving characterized behavior.", true, ["read", "write", "execute"]),
    testStage("behavior-preservation", "Behavior preservation", ["debt-refactor"], "tests_pass"),
    agentStage("debt-review", "Debt review", ["behavior-preservation"], "architecture reviewer", "Review coupling reduction, compatibility, performance, security, and whether the debt was actually reduced.", false, ["read"]),
    learningStage(["debt-review"]),
  ];
  return undefined;
}

function reviewStage(id: string, role: string, focus: string, dependency = "quality-security"): StageDefinition {
  return {
    id,
    title: `${role} review`,
    dependsOn: [dependency],
    writes: false,
    permissions: ["read"],
    gates: [
      { id: `${id}-approved`, type: "review_approved", blocking: true, description: "Reviewer explicitly approved the work" },
      { id: `${id}-no-blockers`, type: "no_blocker_findings", blocking: true, description: "Reviewer found no blocker findings" },
    ],
    async execute(context) {
      const result = await context.adapter.run({
        objective: context.run.objective,
        stageId: id,
        role,
        prompt: `Review the current diff and relevant test files for ${focus}. Do not modify files and do not run tests, builds, package managers, or other commands that require write-enabled autonomy; use the recorded command evidence instead. Return only valid JSON matching {"approved":boolean,"summary":string,"findings":[{"id":string,"severity":"BLOCKER"|"MAJOR"|"MINOR"|"NOTE","category":string,"file":string,"line":number,"finding":string,"evidence":string,"recommendedFix":string,"status":"open"|"fixed"|"invalidated"|"accepted-risk"}]}. Do not use markdown fences. A review is approved only when no open BLOCKER findings remain.`,
        workspace: context.run.workspace,
        permissions: ["read"],
        context: context.context,
      });
      recordSession(context, result.sessionId);
      const { blockerCount, approved, validSchema, review } = reviewDecision(result.output, result.ok);
      context.run.findingRegistry = review?.findings ?? [];
      return [evidence({
        kind: "ReviewEvidence",
        producer: result.source,
        stageId: id,
        source: result.source,
        result: approved ? "pass" : "fail",
        verification: result.ok ? "verified" : "unverified",
        metadata: { output: result.output.slice(-20_000), blockerCount, approved, validSchema, review, agentSucceeded: result.ok, sessionId: result.sessionId, adapterMetadata: result.metadata },
      })];
    },
  };
}

export function targetedReReviewStage(dependsOn = "fix"): StageDefinition {
  return {
    id: "targeted-re-review",
    title: "Targeted re-review",
    dependsOn: [dependsOn],
    writes: false,
    permissions: ["read"],
    gates: [
      { id: "targeted-approved", type: "review_approved", blocking: true, description: "Targeted findings are resolved" },
      { id: "finding-lifecycle", type: "finding_lifecycle", blocking: true, description: "Every consolidated finding is closed or explicitly approved" },
    ],
    async execute(context) {
      const openFindings = (context.run.findingRegistry ?? []).filter((finding) => !["fixed", "invalidated", "accepted-risk"].includes(finding.status ?? ""));
      if (openFindings.length === 0) {
        return [evidence({
          kind: "ReviewEvidence", producer: "hackon-orchestrator", stageId: context.stage.id, source: "no-open-findings",
          result: "pass", verification: "verified", metadata: { approved: true, blockerCount: 0, validSchema: true, review: { approved: true, summary: "No open findings required targeted re-review.", findings: [] } },
        })];
      }
      const result = await context.adapter.run({
        objective: context.run.objective,
        stageId: context.stage.id,
        role: "targeted reviewer",
        prompt: `Re-review only these findings after the fix stage:\n${JSON.stringify(openFindings, null, 2)}\nInspect the current diff and affected tests. Return only the validated JSON review schema. Preserve each finding id and set status to fixed, invalidated, accepted-risk, or open. A finding is fixed only with concrete current evidence.`,
        workspace: context.run.workspace,
        permissions: ["read"],
        context: context.context,
        signal: context.signal,
      });
      recordSession(context, result.sessionId);
      const parsed = reviewDecision(result.output, result.ok);
      const findings = parsed.review?.findings ?? [];
      const closed = findings.length === openFindings.length && findings.every((finding) => ["fixed", "invalidated", "accepted-risk"].includes(finding.status ?? ""));
      const updates = new Map(findings.map((finding) => [finding.id, finding]));
      context.run.findingRegistry = (context.run.findingRegistry ?? []).map((finding) => updates.get(finding.id) ?? finding);
      const targetedReview = { approved: result.ok && closed, summary: parsed.review?.summary ?? "Targeted re-review failed.", findings: context.run.findingRegistry };
      return [
        agentEvidence(context.stage.id, result.source, result.output, result.ok, { agentSucceeded: result.ok, sessionId: result.sessionId, adapterMetadata: result.metadata }),
        evidence({
          kind: "ReviewEvidence", producer: result.source, stageId: context.stage.id, source: result.source,
          result: result.ok && closed ? "pass" : "fail", verification: result.ok ? "verified" : "unverified",
          metadata: { output: result.output.slice(-20_000), blockerCount: parsed.blockerCount, approved: result.ok && closed, validSchema: parsed.validSchema, review: targetedReview, sessionId: result.sessionId },
        }),
      ];
    },
  };
}

function standardStages(): StageDefinition[] {
  return [
    agentStage("reconnaissance", "Reconnaissance", [], "repository reconnaissance",
      "Inspect the repository, project profile, existing conventions, and relevant tests. Record only observed facts, affected areas, constraints, and unknowns in a repository-native reconnaissance note.",
      false, ["read"]),
    agentStage("request-contract", "Request contract", ["reconnaissance"], "product discovery",
      `Convert the request into an evidence-oriented specification. Separate observations, user statements, problems, assumptions, hypotheses, evidence, inferences, decisions, acceptance criteria, and non-goals. Write the specification to a clearly named repository document. Do not claim implementation.`,
      true, ["read", "write"], [
        { id: "spec-file", type: "artifact_exists", blocking: true, description: "A specification artifact exists", config: { path: ".hackon" } },
      ]),
    agentStage("acceptance-criteria", "Acceptance criteria", ["request-contract"], "acceptance test designer",
      "Turn the request contract into observable acceptance criteria, edge cases, negative cases, and regression scenarios. Save the criteria without implementing the change.",
      true, ["read", "write"]),
    agentStage("architecture-impact", "Architecture impact", ["acceptance-criteria"], "architecture analyst",
      "Inspect the acceptance criteria and repository. Record affected modules, interfaces, data flows, compatibility risks, security boundaries, and the smallest reversible architecture change.",
      false, ["read"]),
    agentStage("implementation-plan", "Implementation plan", ["architecture-impact"], "technical planner",
      "Inspect the repository and specification. Produce a concrete implementation plan with files, tests, risks, rollback, and commands. Do not implement yet. Save it as a repository document.",
      true, ["read", "write"]),
    {
      ...agentStage("implementation", "Implement change", ["implementation-plan"], "implementation engineer",
        "Implement the requested change in the repository. Use test-driven development where practical: add or update a regression or acceptance test, implement the smallest root-cause solution, and preserve security boundaries. Do not merely describe code.",
        true, ["read", "write", "execute"], [
          { id: "implementation-diff", type: "diff_exists", blocking: true, description: "Implementation produced a repository diff" },
        ]),
      execute: async (context) => {
        const agent = await askAgent(context,
          "Implement the requested change in the repository. Use test-driven development where practical: add or update a regression or acceptance test, implement the smallest root-cause solution, and preserve security boundaries. Do not merely describe code.",
          "implementation engineer", ["read", "write", "execute"]);
        const status = await context.tools.run({ argv: ["git", "status", "--short"], cwd: context.run.workspace });
        const after = await captureStageBaseline(context.run.workspace, context.stage.id);
        const baseline = context.run.stageBaselines[context.stage.id];
        const changed = Boolean(baseline && baseline.workspaceFingerprint !== after.workspaceFingerprint);
        return [agent, evidence({
          kind: "DiffEvidence",
          producer: "hackon-tool-runner",
          stageId: context.stage.id,
          source: "git status --short",
          result: changed ? "pass" : "fail",
          verification: "verified",
          metadata: { changed, stdout: status.stdout, exitCode: status.exitCode, baseline, after },
        })];
      },
    },
    commandStage("tests", "Run tests", ["implementation"], "test", "TestEvidence", [
      { id: "tests-pass", type: "tests_pass", blocking: true, description: "Project tests exit successfully" },
    ]),
    commandStage("quality-lint", "Run lint", ["tests"], "lint", "CommandEvidence", [
      { id: "lint-optional", type: "optional_command_pass", blocking: true, description: "Lint passes when configured" },
    ]),
    commandStage("quality-typecheck", "Run typecheck", ["quality-lint"], "typecheck", "CommandEvidence", [
      { id: "typecheck-optional", type: "optional_command_pass", blocking: true, description: "Typecheck passes when configured" },
    ]),
    commandStage("quality-security", "Run security checks", ["quality-typecheck"], "security", "CommandEvidence", [
      { id: "security-optional", type: "optional_command_pass", blocking: true, description: "Security command passes when configured" },
    ]),
    reviewStage("code-review", "code", "correctness, maintainability, API compatibility, and test quality"),
    reviewStage("security-review", "security", "injection, secrets, unsafe commands, path traversal, dependency and privilege boundaries"),
    reviewStage("architecture-review", "architecture", "module boundaries, failure handling, concurrency, state, and extensibility"),
    reviewStage("ux-review", "product/UX", "user-facing behavior, acceptance criteria, accessibility, and confusing edge cases"),
    {
      ...agentStage("consolidate", "Consolidate review", ["code-review", "security-review", "architecture-review", "ux-review"], "review lead",
        "Read all review evidence and the diff. Consolidate duplicate findings, rank them by severity and exploitability, and return only valid JSON matching {\"approved\":boolean,\"summary\":string,\"findings\":[{\"id\":string,\"severity\":\"BLOCKER\"|\"MAJOR\"|\"MINOR\"|\"NOTE\",\"category\":string,\"file\":string,\"line\":number,\"finding\":string,\"evidence\":string,\"recommendedFix\":string,\"status\":\"open\"|\"fixed\"|\"invalidated\"|\"accepted-risk\"}]}. Do not use markdown fences.",
        false, ["read"], [
          { id: "review-decision", type: "review_approved", blocking: true, description: "Consolidated review has no blocking findings" },
          { id: "review-no-blockers", type: "no_blocker_findings", blocking: false, description: "All independent reviews have no blockers" },
        ]),
      execute: async (context) => {
        const independentReviews = context.run.evidence
          .filter((item) => item.kind === "ReviewEvidence" && item.stageId !== "consolidate")
          .map((item) => ({ stage: item.stageId, result: item.result, metadata: item.metadata }));
        const result = await context.adapter.run({
          objective: context.run.objective, stageId: "consolidate", role: "review lead",
          prompt: `Read the current diff and consolidate these independently recorded review results:
${JSON.stringify(independentReviews, null, 2)}
Treat the recorded reviewer metadata as evidence, inspect the diff for anything they missed, rank findings by severity and exploitability, and return only the same validated JSON review schema. Do not use markdown fences.`,
          workspace: context.run.workspace, permissions: ["read"], context: context.context,
        });
        recordSession(context, result.sessionId);
        const { blockerCount, approved, validSchema, review } = reviewDecision(result.output, result.ok);
        context.run.findingRegistry = review?.findings ?? [];
        const agent = agentEvidence(context.stage.id, result.source, result.output, result.ok, {
          agentSucceeded: result.ok,
          sessionId: result.sessionId,
          adapterMetadata: result.metadata,
        });
        return [agent, evidence({
          kind: "ReviewEvidence", producer: result.source, stageId: context.stage.id, source: result.source,
          result: approved ? "pass" : "fail",
          verification: result.ok ? "verified" : "unverified",
          metadata: { output: result.output.slice(-20_000), blockerCount, approved, validSchema, review, sessionId: result.sessionId, adapterMetadata: result.metadata },
        })];
      },
    },
    agentStage("fix", "Fix review findings", ["consolidate"], "senior implementation engineer",
      "Apply every blocking or major finding from the consolidated review. Do not dismiss a finding without concrete evidence. Add regression coverage where a finding exposes a behavior risk.",
      true, ["read", "write", "execute"], [
        { id: "fix-diff", type: "diff_exists", blocking: false, description: "Fix stage may produce a diff" },
      ]),
    targetedReReviewStage(),
    commandStage("final-verification", "Final verification", ["targeted-re-review"], "test", "TestEvidence", [
      { id: "final-tests-pass", type: "tests_pass", blocking: true, description: "Final tests exit successfully" },
    ]),
    commandStage("build-verification", "Build verification", ["final-verification"], "build", "BuildEvidence", [
      { id: "build-pass", type: "build_pass", blocking: true, description: "Production build exits successfully" },
    ]),
    {
      ...agentStage("learn", "Compound learning", ["build-verification"], "learning facilitator",
        "Write a durable retrospective in .hackon/learning or another repository-native location. Record decision quality, failures, successful patterns, unresolved uncertainty, and a concrete retrieval cue for future cycles. Do not claim metrics that were not measured.",
        true, ["read", "write"], [
          { id: "learning-artifact", type: "artifact_exists", blocking: true, description: "A durable learning artifact exists" },
        ]),
      execute: async (context) => {
        const item = await askAgent(context,
          "Write a durable retrospective in .hackon/learning. Record decision quality, failures, successful patterns, unresolved uncertainty, and a concrete retrieval cue for future cycles. Do not claim metrics that were not measured.",
          "learning facilitator", ["read", "write"]);
        const artifact = await findArtifact(join(context.run.workspace, ".hackon", "learning"), /.+/);
        const after = await captureStageBaseline(context.run.workspace, context.stage.id);
        const baseline = context.run.stageBaselines[context.stage.id];
        const createdThisStage = Boolean(baseline && baseline.artifactFingerprint !== after.artifactFingerprint && artifact);
        return [item, evidence({
          kind: "FileEvidence",
          producer: "hackon-orchestrator",
          stageId: context.stage.id,
          source: artifact ?? ".hackon/learning",
          result: createdThisStage ? "pass" : "fail",
          verification: "verified",
          metadata: { exists: createdThisStage, path: artifact, createdThisStage, baseline, after },
        })];
      },
    },
  ];
}

const workflowDescriptions: Record<string, { name: string; description: string; prefix: string }> = {
  "idea-to-product": { name: "Idea to Product", description: "Turn an idea into a tested, reviewable product increment.", prefix: "Treat this as an idea-to-product cycle." },
  "zero-to-mvp": { name: "Zero to MVP", description: "Research a product problem and deliver a runnable MVP.", prefix: "Start from the product problem, keep scope minimal, and deliver a runnable MVP." },
  "feature-development": { name: "Feature Development", description: "Specify, implement, test, review, fix, and verify a feature.", prefix: "This is feature development on an existing repository." },
  "bug-fix": { name: "Bug Fix", description: "Reproduce a defect, find its root cause, fix it, and prevent regression.", prefix: "Reproduce the bug before fixing it and add a failing regression test before the fix." },
  "production-incident": { name: "Production Incident", description: "Contain, diagnose, remediate, and learn from an incident.", prefix: "Prioritize safe containment, evidence preservation, and a blameless root-cause analysis." },
  "product-improvement": { name: "Product Improvement", description: "Use user evidence to improve an existing product.", prefix: "Distinguish observation from inference and tie changes to acceptance criteria." },
  "growth-experiment": { name: "Growth Experiment", description: "Diagnose a funnel opportunity and run a measurable experiment.", prefix: "Define baseline, segment, funnel stage, hypothesis, mechanism, primary metric, guardrails, threshold, and interpretation." },
  "launch": { name: "Launch", description: "Prepare and verify a safe product launch.", prefix: "Include release readiness, rollback, observability, and launch verification." },
  "pivot": { name: "Pivot", description: "Evaluate evidence and execute a defensible product pivot.", prefix: "Record the decision, alternatives rejected, evidence, assumptions, and learning agenda." },
  "technical-debt": { name: "Technical Debt", description: "Reduce technical debt with behavior-preserving verification.", prefix: "Preserve behavior with characterization tests and measure risk reduction." },
  "customer-request": { name: "Customer Request", description: "Turn a customer request into validated product work.", prefix: "Separate the literal request from the underlying job and validate scope." },
  "weekly-founder-review": { name: "Weekly Founder Review", description: "Review product, engineering, growth, business, and learning signals.", prefix: "Review leading and lagging indicators, decisions, risks, and the next compounding action." },
};

const specializations: Record<string, { id: string; title: string; role: string; prompt: string }> = {
  "idea-to-product": { id: "customer-discovery", title: "Customer discovery", role: "customer researcher", prompt: "Map the target user, job to be done, alternatives, riskiest assumptions, and the smallest discovery evidence needed before building." },
  "zero-to-mvp": { id: "mvp-scope", title: "MVP scope", role: "MVP product strategist", prompt: "Define the thin vertical slice, explicit non-goals, acceptance tests, and launch constraint that make this MVP learnable rather than merely small." },
  "feature-development": { id: "feature-contract", title: "Feature contract", role: "feature systems designer", prompt: "Turn the feature request into user-visible behavior, API/data contracts, compatibility risks, and regression scenarios." },
  "bug-fix": { id: "root-cause", title: "Root-cause investigation", role: "debugging investigator", prompt: "Trace the failure from observed symptom to root cause, identify a minimal reproducer, and define a regression test before proposing a fix." },
  "production-incident": { id: "incident-command", title: "Incident command", role: "incident commander", prompt: "Establish impact, timeline, containment, communication, rollback, and follow-up actions. Do not trade away evidence preservation for speed." },
  "product-improvement": { id: "product-signal", title: "Product signal analysis", role: "product analyst", prompt: "Connect the requested improvement to a measurable user outcome, baseline, counterfactual, and decision rule." },
  "growth-experiment": { id: "experiment-design", title: "Experiment design", role: "growth scientist", prompt: "Define the growth hypothesis, funnel event, baseline, sample or observation plan, guardrails, and stop/ship criteria." },
  "launch": { id: "launch-readiness", title: "Launch readiness", role: "launch manager", prompt: "Build a launch checklist covering audience, positioning, operational readiness, support, rollback, instrumentation, and post-launch review." },
  "pivot": { id: "pivot-evidence", title: "Pivot evidence", role: "strategy lead", prompt: "Separate signal from noise, compare strategic options, state the falsifying evidence, and protect reversible experiments." },
  "technical-debt": { id: "debt-risk", title: "Debt risk assessment", role: "staff engineer", prompt: "Characterize the debt's failure modes, interest cost, behavior-preserving constraints, migration seams, and measurable risk reduction." },
  "customer-request": { id: "request-triage", title: "Request triage", role: "customer advocate", prompt: "Translate the literal request into the underlying job, affected segment, frequency, workaround, willingness-to-pay signal, and scope decision." },
  "weekly-founder-review": { id: "founder-scorecard", title: "Founder scorecard", role: "founder operating partner", prompt: "Review leading and lagging signals across product, engineering, growth, business, and learning, then select one compounding action with an owner and decision date." },
};

export function builtInWorkflows(): Map<string, WorkflowDefinition> {
  return new Map(Object.entries(workflowDescriptions).map(([id, details]) => {
    const specialization = specializations[id];
    const nonCoding = nonCodingWorkflowStages(id);
    if (nonCoding) {
      return [id, {
        id,
        name: details.name,
        description: details.description,
        stages: nonCoding,
      } satisfies WorkflowDefinition];
    }
    const baseStages = standardStages().map((stage) => stage.id === "request-contract"
      ? { ...stage, execute: async (context: StageContext) => {
        const adjusted = `${details.prefix}\n\n${context.run.objective}`;
        const result = await context.adapter.run({
          objective: adjusted, stageId: context.stage.id, role: "product discovery",
          prompt: "Perform the methodology in the stage instructions and save the specification.",
          workspace: context.run.workspace, permissions: context.stage.permissions, context: context.context,
        });
        recordSession(context, result.sessionId);
        const item = agentEvidence(context.stage.id, result.source, result.output, result.ok, { agentSucceeded: result.ok, sessionId: result.sessionId, adapterMetadata: result.metadata });
        if (result.ok && result.output.trim()) {
          await mkdir(join(context.run.workspace, ".hackon"), { recursive: true });
          await writeFile(join(context.run.workspace, ".hackon", "specification.md"), result.output, "utf8");
        }
        const artifact = await findArtifact(context.run.workspace, /spec|prd|brief/i);
        const after = await captureStageBaseline(context.run.workspace, context.stage.id);
        const baseline = context.run.stageBaselines[context.stage.id];
        const createdThisStage = Boolean(baseline && baseline.artifactFingerprint !== after.artifactFingerprint && artifact);
        return [item, evidence({
          kind: "FileEvidence", producer: "hackon-orchestrator", stageId: context.stage.id, source: ".hackon",
          result: createdThisStage ? "pass" : "fail", verification: "verified",
          metadata: { exists: createdThisStage, path: artifact, schemaValid: createdThisStage, createdThisStage, baseline, after },
        })];
      } } : stage);
    const domainStage = agentStage(specialization.id, specialization.title, ["request-contract"], specialization.role, specialization.prompt, false, ["read"], [
      { id: `${specialization.id}-agent`, type: "agent_succeeded", blocking: true, description: "Specialized domain analysis completed successfully" },
    ]);
    return [id, {
    id,
    name: details.name,
    description: details.description,
    stages: [
      baseStages[0],
      baseStages[1],
      domainStage,
      ...baseStages.slice(2).map((stage) => stage.id === "implementation-plan" ? {
        ...stage,
        dependsOn: [specialization.id],
        execute: async (context: StageContext) => {
          const item = await askAgent(context, `${specialization.prompt}\n\nNow produce the concrete implementation plan with files, tests, risks, rollback, and commands. Save it as a repository document.`, "technical planner", context.stage.permissions);
          return [item];
        },
      } : stage),
    ],
  } satisfies WorkflowDefinition];
}));
}
