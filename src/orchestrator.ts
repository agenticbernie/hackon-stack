import type { AgentAdapter, ContextBundle, Evidence, KnowledgeStore, RunState, StageContext, StateStore, ToolExecutor, WorkflowDefinition } from "./domain.js";
import { evidence, initialRun } from "./domain.js";
import { acquireContext } from "./context.js";
import { evaluateGates } from "./gates.js";

export type OrchestratorOptions = {
  tools: ToolExecutor;
  adapter: AgentAdapter;
  state: StateStore;
  knowledge: KnowledgeStore;
  onEvent?: (event: { type: string; runId: string; stageId?: string; message?: string }) => void;
};

export class Orchestrator {
  constructor(private readonly options: OrchestratorOptions) {}

  async run(workflow: WorkflowDefinition, objective: string, workspace: string, resumeId?: string): Promise<RunState> {
    const run = resumeId ? await this.options.state.load(resumeId) : undefined;
    if (resumeId && !run) throw new Error(`Run not found: ${resumeId}`);
    const current = run ?? initialRun(workflow, objective, workspace);
    if (run) {
      for (const stage of Object.values(current.stages)) {
        if (stage.status === "running" || stage.status === "failed" || stage.status === "blocked") {
          stage.status = "pending";
          delete stage.error;
        }
      }
      current.status = "running";
      current.error = undefined;
    }
    const context = await acquireContext(workspace, current.objective, this.options.knowledge);
    current.selectedContext = [...context.files.map((file) => file.path), ...context.knowledge.map((item) => `knowledge:${item.id}`)];
    await this.options.state.save(current);
    this.emit({ type: "context.selected", runId: current.id, message: `${current.selectedContext.length} context items selected` });

    try {
      while (Object.values(current.stages).some((stage) => stage.status === "pending" || stage.status === "running")) {
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
        const results = await Promise.allSettled(batch.map((stage) => this.executeStage(current, workflow, stage, context)));
        const rejected = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
        if (rejected) throw rejected.reason;
      }
      current.status = Object.values(current.stages).every((stage) => stage.status === "succeeded") ? "succeeded" : "failed";
    } catch (error) {
      current.status = "failed";
      current.error = error instanceof Error ? error.message : String(error);
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
  }

  private async executeStage(run: RunState, workflow: WorkflowDefinition, stage: WorkflowDefinition["stages"][number], context: ContextBundle): Promise<void> {
    const state = run.stages[stage.id];
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
          context,
          knowledge: this.options.knowledge,
        };
        const results = await stage.execute(stageContext);
        run.evidence.push(...results);
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
}

export function agentEvidence(stageId: string, adapterId: string, output: string, ok: boolean, metadata: Record<string, unknown> = {}): Evidence {
  return evidence({
    kind: "AgentEvidence",
    producer: adapterId,
    stageId,
    source: adapterId,
    result: ok ? "pass" : "fail",
    metadata: { output: output.slice(-20_000), ...metadata },
  });
}
