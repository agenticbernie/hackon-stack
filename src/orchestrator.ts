import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import type { AgentAdapter, ContextBundle, Evidence, KnowledgeStore, RunState, StageContext, StateStore, ToolExecutor, WorkflowDefinition } from "./domain.js";
import { evidence, initialRun } from "./domain.js";
import { acquireContext } from "./context.js";
import { evaluateGates } from "./gates.js";
import { detectProjectProfile } from "./project-profile.js";
import { RunLock } from "./run-lock.js";
import { createRunWorktree } from "./worktree.js";
import { RunCancellation } from "./cancellation.js";

export type OrchestratorOptions = {
  tools: ToolExecutor;
  adapter: AgentAdapter;
  state: StateStore;
  knowledge: KnowledgeStore;
  onEvent?: (event: { type: string; runId: string; stageId?: string; message?: string }) => void;
};

async function fileMetadata(root: string, current: string, output: string[], depth = 0): Promise<void> {
  if (depth > 8 || output.length >= 5_000) return;
  let entries;
  try {
    entries = await readdir(current, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if ([".git", ".hackon", "node_modules", "dist", "coverage"].includes(entry.name)) continue;
    if (entry.isSymbolicLink()) continue;
    const path = join(current, entry.name);
    if (entry.isDirectory()) {
      await fileMetadata(root, path, output, depth + 1);
    } else {
      try {
        const content = await readFile(path);
        output.push(`${relative(root, path)}:${createHash("sha256").update(content).digest("hex")}`);
      } catch {
        // A concurrent agent may remove a file between directory listing and stat.
      }
    }
  }
}

async function artifactMetadata(workspace: string, stageId: string): Promise<string[]> {
  const output: string[] = [];
  const patterns = stageId === "learn" ? [/./] : [/spec|prd|brief/i];
  const visit = async (current: string, depth = 0): Promise<void> => {
    if (depth > 8 || output.length >= 1_000) return;
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if ([".git", "node_modules", "dist", "coverage"].includes(entry.name)) continue;
      if (entry.isSymbolicLink()) continue;
      const path = join(current, entry.name);
      if (entry.isDirectory()) await visit(path, depth + 1);
      else if (stageId === "learn" ? current.includes(`${".hackon"}${"/learning"}`) : patterns.some((pattern) => pattern.test(entry.name))) {
        const content = await readFile(path).catch(() => undefined);
        if (content) output.push(`${relative(workspace, path)}:${createHash("sha256").update(content).digest("hex")}`);
      }
    }
  };
  await visit(workspace);
  return output.sort();
}

export async function captureStageBaseline(workspace: string, stageId: string): Promise<{ workspaceFingerprint: string; artifactFingerprint: string; capturedAt: string }> {
  const files: string[] = [];
  await fileMetadata(workspace, workspace, files);
  const artifacts = await artifactMetadata(workspace, stageId);
  return {
    workspaceFingerprint: createHash("sha256").update(files.join("\n")).digest("hex"),
    artifactFingerprint: createHash("sha256").update(artifacts.join("\n")).digest("hex"),
    capturedAt: new Date().toISOString(),
  };
}

export class Orchestrator {
  constructor(private readonly options: OrchestratorOptions) {}

  async run(workflow: WorkflowDefinition, objective: string, workspace: string, resumeId?: string, options: { worktree?: string; inPlace?: boolean } = {}): Promise<RunState> {
    const run = resumeId ? await this.options.state.load(resumeId) : undefined;
    if (resumeId && !run) throw new Error(`Run not found: ${resumeId}`);
    const current = run ?? initialRun(workflow, objective, workspace);
    const baseWorkspace = current.baseWorkspace ?? workspace;
    const lock = await RunLock.acquire(baseWorkspace, current.id);
    const controller = new AbortController();
    RunCancellation.register(current.id, controller);
    const stopCancellationWatch = RunCancellation.watch(baseWorkspace, current.id, controller);
    try {
      const cancellation = await RunCancellation.read(baseWorkspace, current.id);
      if (cancellation) controller.abort(cancellation.reason);
      if (!run && !options.inPlace && workflow.stages.some((stage) => stage.writes)) {
        current.worktreePath = await createRunWorktree(workspace, current.id, options.worktree ?? "run");
        current.workspace = current.worktreePath;
        current.baseWorkspace = workspace;
        current.baseCommit = (await this.options.tools.run({ argv: ["git", "rev-parse", "HEAD"], cwd: workspace })).stdout.trim();
      }
      current.stageBaselines ??= {};
      current.projectProfile ??= await detectProjectProfile(current.workspace);
      if (run && !controller.signal.aborted) {
        for (const stage of Object.values(current.stages)) {
          if (stage.status === "running" || stage.status === "failed" || stage.status === "blocked") {
            stage.status = "pending";
            delete stage.error;
          }
        }
        current.status = "running";
        current.error = undefined;
      }
      if (controller.signal.aborted) {
        this.markCancelled(current, await RunCancellation.read(baseWorkspace, current.id));
        current.updatedAt = new Date().toISOString();
        await this.options.state.save(current);
        return current;
      }
      const context = await acquireContext(current.workspace, current.objective, this.options.knowledge, { stageId: "run", role: workflow.name, profile: current.projectProfile });
      current.contextSelections = [...(current.contextSelections ?? []), ...(context.selections ?? [])];
      current.selectedContext = [...context.files.map((file) => file.path), ...context.knowledge.map((item) => `knowledge:${item.id}`)];
      await this.options.state.save(current);
      this.emit({ type: "context.selected", runId: current.id, message: `${current.selectedContext.length} context items selected` });

      try {
        while (Object.values(current.stages).some((stage) => stage.status === "pending" || stage.status === "running")) {
          if (controller.signal.aborted) throw new Error("Run cancelled");
          const ready = workflow.stages.filter((stage) =>
            current.stages[stage.id].status === "pending" &&
            stage.dependsOn.every((dependency) => current.stages[dependency].status === "succeeded"));
          const blocked = workflow.stages.filter((stage) =>
            current.stages[stage.id].status === "pending" &&
            stage.dependsOn.some((dependency) => ["failed", "blocked", "cancelled"].includes(current.stages[dependency].status)));
          for (const stage of blocked) {
            current.stages[stage.id] = { ...current.stages[stage.id], status: "blocked", error: "Dependency failed" };
          }
          if (blocked.length) await this.options.state.save(current);
          if (ready.length === 0) {
            if (Object.values(current.stages).some((stage) => stage.status === "pending")) throw new Error("Workflow graph is invalid or contains an unresolved dependency");
            break;
          }
          const parallel = ready.filter((stage) => !stage.writes);
          const batch = parallel.length > 0 ? parallel : [ready[0]];
          const results = await Promise.allSettled(batch.map((stage) => this.executeStage(current, workflow, stage, context, controller.signal)));
          if (controller.signal.aborted) throw new Error("Run cancelled");
          const rejected = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
          if (rejected) throw rejected.reason;
        }
        const cancellation = await RunCancellation.read(baseWorkspace, current.id);
        if (controller.signal.aborted || cancellation) this.markCancelled(current, cancellation);
        else current.status = Object.values(current.stages).every((stage) => stage.status === "succeeded") ? "succeeded" : "failed";
      } catch (error) {
        const cancellation = await RunCancellation.read(baseWorkspace, current.id);
        if (controller.signal.aborted || cancellation) this.markCancelled(current, cancellation);
        else {
          current.status = "failed";
          current.error = error instanceof Error ? error.message : String(error);
        }
      }
      current.updatedAt = new Date().toISOString();
      await this.options.state.save(current);
      if (current.status === "succeeded") {
        await this.options.knowledge.save({
          title: `${workflow.name}: completed cycle`,
          content: `Objective: ${objective}\nEvidence: ${current.evidence.filter((item) => item.verification === "verified").length} verified items.\nStages: ${Object.keys(current.stages).join(", ")}.`,
          tags: [workflow.id, "cycle", "verified"],
          sourceRunId: current.id,
        });
      }
      return current;
    } finally {
      RunCancellation.unregister(current.id);
      stopCancellationWatch();
      if (current.status !== "cancelled") await RunCancellation.clear(baseWorkspace, current.id);
      await lock.release();
    }
  }

  private async executeStage(run: RunState, workflow: WorkflowDefinition, stage: WorkflowDefinition["stages"][number], context: ContextBundle, signal: AbortSignal): Promise<void> {
    if (signal.aborted) {
      run.stages[stage.id].status = "cancelled";
      return;
    }
    const state = run.stages[stage.id];
    run.stageBaselines[stage.id] = await captureStageBaseline(run.workspace, stage.id);
    state.status = "running";
    state.attempts += 1;
    state.startedAt = new Date().toISOString();
    await this.options.state.save(run);
    this.emit({ type: "stage.started", runId: run.id, stageId: stage.id });
    const maxAttempts = stage.retry?.maxAttempts ?? 1;
    let lastError: unknown;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const stageContext: StageContext = {
          run,
          stage,
          workflow,
          tools: this.options.tools,
          adapter: this.options.adapter,
          context: await acquireContext(run.workspace, run.objective, this.options.knowledge, {
            stageId: stage.id,
            role: stage.title,
            profile: run.projectProfile,
          }),
          knowledge: this.options.knowledge,
          signal,
        };
        run.contextSelections = [...(run.contextSelections ?? []), ...(stageContext.context.selections ?? [])];
        const influenceStart = run.knowledgeInfluence?.length ?? 0;
        run.knowledgeInfluence = [
          ...(run.knowledgeInfluence ?? []),
          ...stageContext.context.knowledge.map((item) => ({
            knowledgeId: item.id,
            stageId: stage.id,
            selectionReason: `retrieved score ${item.score} for ${stage.title}`,
            influence: "Provided to the stage agent as prior learning; stage output remains subject to independent evidence gates.",
            recordedAt: new Date().toISOString(),
          })),
        ];
        await this.options.state.save(run);
        const results = await stage.execute(stageContext);
        if (signal.aborted || await RunCancellation.read(run.baseWorkspace ?? run.workspace, run.id)) throw new Error("Run cancelled");
        run.evidence.push(...results);
        for (const influence of (run.knowledgeInfluence ?? []).slice(influenceStart)) {
          const linkedEvidence = results.map((item) => `${item.kind}:${item.result}:${item.verification ?? "unverified"}`).join(", ");
          influence.decisionBefore = `Knowledge ${influence.knowledgeId} was supplied before stage ${stage.id}.`;
          influence.decisionAfter = `Stage ${stage.id} produced ${linkedEvidence || "no evidence"}.`;
          influence.evidenceOfInfluence = linkedEvidence || "No stage evidence was produced; influence is unproven.";
        }
        const gateResults = evaluateGates(stage.gates, run, stage.id);
        state.gateResults = gateResults;
        const failedBlocking = gateResults.filter((result) => result.blocking && !result.passed);
        if (failedBlocking.length > 0) throw new Error(`Blocking gates failed: ${failedBlocking.map((result) => result.gateId).join(", ")}`);
        state.status = "succeeded";
        state.completedAt = new Date().toISOString();
        await this.options.state.save(run);
        this.emit({ type: "stage.succeeded", runId: run.id, stageId: stage.id });
        return;
      } catch (error) {
        lastError = error;
        if (attempt < maxAttempts) {
          state.attempts += 1;
          await new Promise((resolve) => setTimeout(resolve, stage.retry?.backoffMs ?? 100));
        }
      }
    }
    state.status = "failed";
    state.error = lastError instanceof Error ? lastError.message : String(lastError);
    await this.options.state.save(run);
    this.emit({ type: "stage.failed", runId: run.id, stageId: stage.id, message: state.error });
    throw lastError;
  }

  private emit(event: { type: string; runId: string; stageId?: string; message?: string }): void {
    this.options.onEvent?.(event);
  }

  private markCancelled(run: RunState, cancellation: { requestedAt: string; reason?: string } | undefined): void {
    run.status = "cancelled";
    run.cancellation = {
      requestedAt: cancellation?.requestedAt ?? new Date().toISOString(),
      reason: cancellation?.reason,
    };
    for (const stage of Object.values(run.stages)) {
      if (stage.status === "running" || stage.status === "failed") stage.status = "cancelled";
      else if (stage.status === "pending") stage.status = "blocked";
    }
    run.error = "Run cancelled";
  }
}

export function agentEvidence(stageId: string, adapterId: string, output: string, ok: boolean, metadata: Record<string, unknown> = {}): Evidence {
  return evidence({
    kind: "AgentEvidence",
    producer: adapterId,
    stageId,
    source: adapterId,
    result: ok ? "pass" : "fail",
    verification: ok ? "verified" : "unverified",
    metadata: { output: output.slice(-20_000), ...metadata },
  });
}
