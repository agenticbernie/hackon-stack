import { readdir } from "node:fs/promises";
import { join } from "node:path";
import type { Evidence, ReviewResult, StageDefinition, StageContext, WorkflowDefinition } from "./domain.js";
import { evidence } from "./domain.js";
import { agentEvidence, captureStageBaseline } from "./orchestrator.js";

function reviewDecision(output: string, ok: boolean): { blockerCount: number; approved: boolean; review?: ReviewResult; validSchema: boolean } {
  if (!ok) return { blockerCount: 0, approved: false, validSchema: false };
  const start = output.indexOf("{");
  const end = output.lastIndexOf("}");
  if (start < 0 || end <= start) return { blockerCount: 0, approved: false, validSchema: false };
  try {
    const value = JSON.parse(output.slice(start, end + 1)) as Partial<ReviewResult>;
    if (typeof value.approved !== "boolean" || typeof value.summary !== "string" || !Array.isArray(value.findings)) {
      return { blockerCount: 0, approved: false, validSchema: false };
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
  } catch {
    return { blockerCount: 0, approved: false, validSchema: false };
  }
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
      result: "fail",
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

function reviewStage(id: string, role: string, focus: string): StageDefinition {
  return {
    id,
    title: `${role} review`,
    dependsOn: ["tests"],
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

function standardStages(): StageDefinition[] {
  return [
    agentStage("specify", "Specify objective", [], "product discovery",
      `Convert the request into an evidence-oriented specification. Separate observations, user statements, problems, assumptions, hypotheses, evidence, inferences, decisions, acceptance criteria, and non-goals. Write the specification to a clearly named repository document. Do not claim implementation.`,
      true, ["read", "write"], [
        { id: "spec-file", type: "artifact_exists", blocking: true, description: "A specification artifact exists", config: { path: ".hackon" } },
      ]),
    agentStage("plan", "Plan work", ["specify"], "technical planner",
      "Inspect the repository and specification. Produce a concrete implementation plan with files, tests, risks, rollback, and commands. Do not implement yet. Save it as a repository document.",
      true, ["read", "write"]),
    {
      ...agentStage("implement", "Implement change", ["plan"], "implementation engineer",
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
    commandStage("tests", "Run tests", ["implement"], "test", "TestEvidence", [
      { id: "tests-pass", type: "tests_pass", blocking: true, description: "Project tests exit successfully" },
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
    commandStage("final-verification", "Final verification", ["fix"], "test", "TestEvidence", [
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
    const baseStages = standardStages().map((stage) => stage.id === "specify"
      ? { ...stage, execute: async (context: StageContext) => {
        const adjusted = `${details.prefix}\n\n${context.run.objective}`;
        const result = await context.adapter.run({
          objective: adjusted, stageId: context.stage.id, role: "product discovery",
          prompt: "Perform the methodology in the stage instructions and save the specification.",
          workspace: context.run.workspace, permissions: context.stage.permissions, context: context.context,
        });
        recordSession(context, result.sessionId);
        const item = agentEvidence(context.stage.id, result.source, result.output, result.ok, { agentSucceeded: result.ok, sessionId: result.sessionId, adapterMetadata: result.metadata });
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
    const domainStage = agentStage(specialization.id, specialization.title, ["specify"], specialization.role, specialization.prompt, false, ["read"], [
      { id: `${specialization.id}-agent`, type: "agent_succeeded", blocking: true, description: "Specialized domain analysis completed successfully" },
    ]);
    return [id, {
    id,
    name: details.name,
    description: details.description,
    stages: [
      baseStages[0],
      domainStage,
      ...baseStages.slice(1).map((stage) => stage.id === "plan" ? {
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
