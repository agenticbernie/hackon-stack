import { readdir } from "node:fs/promises";
import { join } from "node:path";
import type { Evidence, StageDefinition, StageContext, WorkflowDefinition } from "./domain.js";
import { evidence } from "./domain.js";
import { agentEvidence } from "./orchestrator.js";

function reviewDecision(output: string, ok: boolean): { blockerCount: number; approved: boolean } {
  const tail = output.slice(-8_000);
  const explicitCount = tail.match(/BLOCKER_COUNT\s*:\s*(\d+)/i);
  const noBlockers = /(?:NO\s+(?:BLOCKER|BLOCKING)\s+FINDINGS?|NONE\s+AT\s+BLOCKER|FINDINGS\s*:\s*NONE\s+AT\s+BLOCKER)/i.test(tail);
  const blockerCount = explicitCount ? Number(explicitCount[1]) : noBlockers ? 0 : /\bBLOCKER\b/i.test(tail) ? 1 : 0;
  return { blockerCount, approved: ok && blockerCount === 0 && /APPROVED/i.test(tail) };
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
  return agentEvidence(context.stage.id, result.source, result.output, result.ok, {
    agentSucceeded: result.ok,
    error: result.error,
  });
}

async function runNpm(context: StageContext, command: string, kind: Evidence["kind"]): Promise<Evidence> {
  const result = await context.tools.run({ argv: ["npm", ...command.split(" ")], cwd: context.run.workspace });
  return commandEvidence(context.stage.id, kind, result);
}

function agentStage(id: string, title: string, dependsOn: string[], role: string, prompt: string, writes: boolean, permissions: StageDefinition["permissions"], gates: StageDefinition["gates"] = []): StageDefinition {
  return {
    id,
    title,
    dependsOn,
    writes,
    permissions,
    gates,
    retry: { maxAttempts: 2, backoffMs: 250 },
    async execute(context) {
      const item = await askAgent(context, prompt, role, permissions);
      if (item.metadata.agentSucceeded !== true) throw new Error(`Agent failed in ${id}`);
      return [item];
    },
  };
}

function commandStage(id: string, title: string, dependsOn: string[], command: string, kind: Evidence["kind"], gates: StageDefinition["gates"]): StageDefinition {
  return {
    id,
    title,
    dependsOn,
    writes: false,
    permissions: ["read", "execute"],
    gates,
    async execute(context) {
      return [await runNpm(context, command, kind)];
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
        prompt: `Review the current diff and relevant tests for ${focus}. Do not modify files. Identify concrete findings with severity BLOCKER, MAJOR, MINOR, or NOTE. End with exactly one line: APPROVED or BLOCKER_COUNT: <number>.`,
        workspace: context.run.workspace,
        permissions: ["read"],
        context: context.context,
      });
      const { blockerCount, approved } = reviewDecision(result.output, result.ok);
      return [evidence({
        kind: "ReviewEvidence",
        producer: result.source,
        stageId: id,
        source: result.source,
        result: approved ? "pass" : "fail",
        metadata: { output: result.output.slice(-20_000), blockerCount, approved, agentSucceeded: result.ok },
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
        if (agent.metadata.agentSucceeded !== true) throw new Error("Implementation agent failed");
        const status = await context.tools.run({ argv: ["git", "status", "--short"], cwd: context.run.workspace });
        return [agent, evidence({
          kind: "DiffEvidence",
          producer: "hackon-tool-runner",
          stageId: context.stage.id,
          source: "git status --short",
          result: status.exitCode === 0 && status.stdout.trim().length > 0 ? "pass" : "fail",
          verification: "verified",
          metadata: { changed: status.exitCode === 0 && status.stdout.trim().length > 0, stdout: status.stdout, exitCode: status.exitCode },
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
        "Read all review evidence and the diff. Consolidate duplicate findings, rank them by severity and exploitability, and state which findings must be fixed before release. End with APPROVED or BLOCKER_COUNT: <number>.",
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
Treat the recorded reviewer metadata as evidence, inspect the diff for anything they missed, rank findings by severity and exploitability, state which findings must be fixed before release, and end with exactly APPROVED or BLOCKER_COUNT: 0 (or the actual number).`,
          workspace: context.run.workspace, permissions: ["read"], context: context.context,
        });
        const { blockerCount, approved } = reviewDecision(result.output, result.ok);
        return [evidence({
          kind: "ReviewEvidence", producer: result.source, stageId: context.stage.id, source: result.source,
          result: approved ? "pass" : "fail",
          metadata: { output: result.output.slice(-20_000), blockerCount, approved },
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
    commandStage("build-verification", "Build verification", ["final-verification"], "run build", "BuildEvidence", [
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
        if (item.metadata.agentSucceeded !== true) throw new Error("Learning agent failed");
        const artifact = await findArtifact(join(context.run.workspace, ".hackon", "learning"), /.+/);
        return [item, evidence({
          kind: "FileEvidence",
          producer: "hackon-orchestrator",
          stageId: context.stage.id,
          source: artifact ?? ".hackon/learning",
          result: artifact ? "pass" : "fail",
          verification: "verified",
          metadata: { exists: Boolean(artifact), path: artifact },
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

export function builtInWorkflows(): Map<string, WorkflowDefinition> {
  return new Map(Object.entries(workflowDescriptions).map(([id, details]) => [id, {
    id,
    name: details.name,
    description: details.description,
    stages: standardStages().map((stage) => stage.id === "specify"
      ? { ...stage, execute: async (context) => {
        const adjusted = `${details.prefix}\n\n${context.run.objective}`;
        const result = await context.adapter.run({
          objective: adjusted, stageId: context.stage.id, role: "product discovery",
          prompt: "Perform the methodology in the stage instructions and save the specification.",
          workspace: context.run.workspace, permissions: context.stage.permissions, context: context.context,
        });
        const item = agentEvidence(context.stage.id, result.source, result.output, result.ok, { agentSucceeded: result.ok });
        if (!result.ok) throw new Error(result.error ?? "specification agent failed");
        const artifact = await findArtifact(context.run.workspace, /spec|prd|brief/i);
        return [item, evidence({
          kind: "FileEvidence", producer: "hackon-orchestrator", stageId: context.stage.id, source: ".hackon",
          result: artifact ? "pass" : "fail", verification: "verified", metadata: { exists: Boolean(artifact), path: artifact, schemaValid: Boolean(artifact) },
        })];
      } } : stage),
  }]));
}
