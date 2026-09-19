import { randomUUID } from "node:crypto";

export type Permission = "read" | "write" | "execute" | "network" | "external";
export type StageStatus = "pending" | "running" | "succeeded" | "failed" | "blocked" | "cancelled";
export type EvidenceKind =
  | "FileEvidence"
  | "DiffEvidence"
  | "CommandEvidence"
  | "TestEvidence"
  | "BuildEvidence"
  | "ReviewEvidence"
  | "MetricEvidence"
  | "HumanApprovalEvidence"
  | "AgentEvidence";

export type Evidence = {
  id: string;
  kind: EvidenceKind;
  producer: string;
  stageId: string;
  timestamp: string;
  source: string;
  result: "pass" | "fail" | "informational";
  verification: "unverified" | "verified";
  metadata: Record<string, unknown>;
};

export type GateType =
  | "artifact_exists"
  | "schema_valid"
  | "diff_exists"
  | "command_exit_zero"
  | "tests_pass"
  | "build_pass"
  | "lint_pass"
  | "typecheck_pass"
  | "review_approved"
  | "no_blocker_findings"
  | "human_approval"
  | "metric_threshold"
  | "coverage_threshold"
  | "security_scan";

export type QualityGate = {
  id: string;
  type: GateType;
  blocking: boolean;
  description: string;
  config?: Record<string, unknown>;
};

export type AgentTask = {
  objective: string;
  stageId: string;
  role: string;
  prompt: string;
  workspace: string;
  permissions: Permission[];
  context: ContextBundle;
};

export type AgentResult = {
  ok: boolean;
  output: string;
  error?: string;
  source: string;
  durationMs: number;
};

export type StageDefinition = {
  id: string;
  title: string;
  dependsOn: string[];
  writes: boolean;
  permissions: Permission[];
  retry?: { maxAttempts: number; backoffMs: number };
  gates: QualityGate[];
  execute: (context: StageContext) => Promise<Evidence[]>;
};

export type WorkflowDefinition = {
  id: string;
  name: string;
  description: string;
  stages: StageDefinition[];
};

export type StageState = {
  id: string;
  status: StageStatus;
  attempts: number;
  startedAt?: string;
  completedAt?: string;
  error?: string;
  gateResults?: GateResult[];
};

export type GateResult = {
  gateId: string;
  type: GateType;
  passed: boolean;
  blocking: boolean;
  message: string;
};

export type RunState = {
  id: string;
  workflowId: string;
  objective: string;
  workspace: string;
  status: "running" | "succeeded" | "failed" | "cancelled";
  createdAt: string;
  updatedAt: string;
  stages: Record<string, StageState>;
  evidence: Evidence[];
  selectedContext: string[];
  error?: string;
};

export type ContextBundle = {
  objective: string;
  files: Array<{ path: string; content: string; trust: "repository-untrusted" | "system-generated" }>;
  knowledge: Array<{ id: string; title: string; content: string; score: number }>;
  warnings: string[];
};

export type StageContext = {
  run: RunState;
  stage: StageDefinition;
  workflow: WorkflowDefinition;
  tools: ToolExecutor;
  adapter: AgentAdapter;
  context: ContextBundle;
  knowledge: KnowledgeStore;
};

export type ToolRequest = {
  argv: string[];
  cwd: string;
  timeoutMs?: number;
  env?: Record<string, string>;
};

export type ToolResult = {
  command: string;
  cwd: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  timestamp: string;
  timedOut: boolean;
};

export interface ToolExecutor {
  run(request: ToolRequest): Promise<ToolResult>;
}

export interface AgentAdapter {
  readonly id: string;
  run(task: AgentTask): Promise<AgentResult>;
}

export interface StateStore {
  load(runId: string): Promise<RunState | undefined>;
  save(run: RunState): Promise<void>;
  list(): Promise<RunState[]>;
}

export interface KnowledgeStore {
  save(entry: { title: string; content: string; tags: string[]; sourceRunId: string }): Promise<void>;
  search(query: string, limit?: number): Promise<Array<{ id: string; title: string; content: string; score: number }>>;
}

export function evidence(
  input: Omit<Evidence, "id" | "timestamp" | "verification"> & { verification?: Evidence["verification"] },
): Evidence {
  return {
    id: randomUUID(),
    timestamp: new Date().toISOString(),
    verification: input.verification ?? "unverified",
    ...input,
  };
}

export function initialRun(workflow: WorkflowDefinition, objective: string, workspace: string): RunState {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    workflowId: workflow.id,
    objective,
    workspace,
    status: "running",
    createdAt: now,
    updatedAt: now,
    stages: Object.fromEntries(workflow.stages.map((stage) => [stage.id, { id: stage.id, status: "pending", attempts: 0 }])),
    evidence: [],
    selectedContext: [],
  };
}
