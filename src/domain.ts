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
  | "security_scan"
  | "agent_succeeded"
  | "optional_command_pass"
  | "finding_lifecycle"
  | "tests_fail"
  | "metric_valid";

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
  autonomy?: "default" | "low" | "medium" | "high";
  sessionId?: string;
  worktree?: string;
  toolRestrictions?: string[];
  signal?: AbortSignal;
};

export type AgentResult = {
  ok: boolean;
  output: string;
  error?: string;
  source: string;
  durationMs: number;
  sessionId?: string;
  metadata?: Record<string, unknown>;
};

export type AdapterCapabilities = {
  id: string;
  version?: string;
  autonomyLevels: Array<"default" | "low" | "medium" | "high">;
  sessions: boolean;
  worktrees: boolean;
  structuredOutput: boolean;
  toolRestrictions: boolean;
};

export type ReviewFinding = {
  id: string;
  severity: "BLOCKER" | "MAJOR" | "MINOR" | "NOTE";
  category: string;
  file?: string;
  line?: number;
  finding: string;
  evidence: string;
  recommendedFix: string;
  status?: "open" | "fixed" | "invalidated" | "accepted-risk";
};

export type ReviewResult = {
  approved: boolean;
  summary: string;
  findings: ReviewFinding[];
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
  baseWorkspace?: string;
  status: "running" | "succeeded" | "failed" | "cancelled";
  createdAt: string;
  updatedAt: string;
  stages: Record<string, StageState>;
  evidence: Evidence[];
  selectedContext: string[];
  stageBaselines: Record<string, { workspaceFingerprint: string; artifactFingerprint: string; capturedAt: string }>;
  contextSelections?: ContextSelection[];
  knowledgeInfluence?: KnowledgeInfluence[];
  adapterSessions?: Record<string, { adapter: string; sessionId: string; stageId: string; createdAt: string; resumedFrom?: string }>;
  projectProfile?: ProjectProfile;
  worktreePath?: string;
  baseCommit?: string;
  cancellation?: { requestedAt: string; requestedBy?: string; reason?: string };
  findingRegistry?: ReviewFinding[];
  error?: string;
};

export type ContextBundle = {
  objective: string;
  files: Array<{ path: string; content: string; trust: "repository-untrusted" | "system-generated" }>;
  knowledge: Array<{ id: string; title: string; content: string; score: number }>;
  warnings: string[];
  selections?: ContextSelection[];
  candidateCount?: number;
  selectedCount?: number;
  budget?: number;
  budgetConsumed?: number;
  omittedCandidates?: Array<{ path: string; score: number; reason: string }>;
};

export type ContextSelection = {
  path: string;
  source: "repository" | "knowledge";
  trust: "repository-untrusted" | "system-generated";
  reason: string;
  relevanceScore: number;
  approximateSize: number;
  stageId?: string;
  selected?: boolean;
};

export type KnowledgeInfluence = {
  knowledgeId: string;
  stageId?: string;
  selectionReason: string;
  influence: string;
  decisionBefore?: string;
  decisionAfter?: string;
  evidenceOfInfluence?: string;
  recordedAt: string;
};

export type ProjectProfile = {
  root: string;
  languages: string[];
  frameworks: string[];
  packageManager?: "npm" | "pnpm" | "yarn" | "bun";
  monorepo: boolean;
  commands: {
    test?: string[];
    build?: string[];
    lint?: string[];
    typecheck?: string[];
    security?: string[];
  };
  workingDirectories: string[];
  detectedFrom: string[];
  overrides: string[];
};

export type StageContext = {
  run: RunState;
  stage: StageDefinition;
  workflow: WorkflowDefinition;
  tools: ToolExecutor;
  adapter: AgentAdapter;
  context: ContextBundle;
  knowledge: KnowledgeStore;
  signal?: AbortSignal;
};

export type ToolRequest = {
  argv: string[];
  cwd: string;
  timeoutMs?: number;
  env?: Record<string, string>;
  permissions?: Permission[];
  signal?: AbortSignal;
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
  cancelled: boolean;
};

export interface ToolExecutor {
  run(request: ToolRequest): Promise<ToolResult>;
}

export interface AgentAdapter {
  readonly id: string;
  run(task: AgentTask): Promise<AgentResult>;
  resume?(sessionId: string, task: AgentTask): Promise<AgentResult>;
  capabilities(): AdapterCapabilities;
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
    baseWorkspace: workspace,
    status: "running",
    createdAt: now,
    updatedAt: now,
    stages: Object.fromEntries(workflow.stages.map((stage) => [stage.id, { id: stage.id, status: "pending", attempts: 0 }])),
    evidence: [],
    selectedContext: [],
    stageBaselines: {},
    contextSelections: [],
    knowledgeInfluence: [],
    adapterSessions: {},
  };
}
