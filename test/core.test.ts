import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { evidence, type AdapterCapabilities, type AgentAdapter, type Permission, type WorkflowDefinition } from "../src/domain.js";
import { SafeToolRunner } from "../src/tool-runner.js";
import { FileKnowledgeStore, FileStateStore } from "../src/state.js";
import { Orchestrator } from "../src/orchestrator.js";
import { builtInWorkflows } from "../src/workflows.js";
import { acquireContext } from "../src/context.js";
import { OpenCodeAdapter } from "../src/adapters.js";
import { detectProjectProfile } from "../src/project-profile.js";
import { RunLock } from "../src/run-lock.js";
import { createRunWorktree } from "../src/worktree.js";

const exec = promisify(execFile);

test("safe tool runner captures command provenance and blocks workspace escape", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "hackon-tool-"));
  const runner = new SafeToolRunner(workspace);
  const result = await runner.run({ argv: ["node", "-e", "process.stdout.write('ok')"], cwd: workspace });
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, "ok");
  assert.match(result.command, /^node/);
  await assert.rejects(() => runner.run({ argv: ["node", "-e", "1"], cwd: join(workspace, "..") }), /escapes workspace/);
  await assert.rejects(() => runner.run({ argv: ["rm", "-rf", "x"], cwd: workspace }), /Destructive command blocked/);
  await assert.rejects(() => runner.run({ argv: ["mkdir", "nope"], cwd: workspace }), /Write permission required/);
  const writable = await runner.run({ argv: ["mkdir", "allowed"], cwd: workspace, permissions: ["read", "write", "execute"] });
  assert.equal(writable.exitCode, 0);
  process.env.HACKON_TEST_SECRET = "must-not-leak";
  const envResult = await runner.run({ argv: ["node", "-e", "process.stdout.write(process.env.HACKON_TEST_SECRET || 'missing')"], cwd: workspace });
  delete process.env.HACKON_TEST_SECRET;
  assert.equal(envResult.stdout, "missing");
});

test("OpenCode adapter rejects a read-only agent that writes", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "hackon-adapter-"));
  const script = join(workspace, "agent.mjs");
  await writeFile(script, "import { writeFile } from 'node:fs/promises'; await writeFile('violation.txt', 'changed');");
  const adapter = new OpenCodeAdapter(`${process.execPath} ${script}`);
  const result = await adapter.run({
    objective: "read only",
    stageId: "review",
    role: "reviewer",
    prompt: "Do not write",
    workspace,
    permissions: ["read"],
    context: { objective: "read only", files: [], knowledge: [], warnings: [] },
  });
  assert.equal(result.ok, false);
  assert.match(result.error ?? "", /Read-only agent task modified/);
});

test("state and knowledge stores persist resumable data and retrieve related lessons", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "hackon-state-"));
  const knowledge = new FileKnowledgeStore(workspace);
  await knowledge.save({ title: "OAuth timeout lesson", content: "Retry only idempotent token requests.", tags: ["auth", "retry"], sourceRunId: "run-1" });
  const results = await knowledge.search("auth token retry");
  assert.equal(results.length, 1);
  assert.equal(results[0].title, "OAuth timeout lesson");
  await knowledge.save({ title: "Credential lesson", content: "token=super-secret-value", tags: ["security"], sourceRunId: "run-1" });
  const persisted = await knowledge.search("credential token");
  assert.equal(persisted.some((entry) => entry.content.includes("super-secret-value")), false);
  const store = new FileStateStore(workspace);
  const run = { id: "run-2", workflowId: "bug-fix", objective: "fix", workspace, status: "running" as const, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), stages: {}, evidence: [], selectedContext: [], stageBaselines: {} };
  await store.save(run);
  assert.deepEqual(await store.load("run-2"), run);
  await assert.rejects(() => store.load("../escape"), /Invalid run ID/);
});

test("context labels repository instructions as untrusted and excludes generated trees", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "hackon-context-"));
  await writeFile(join(workspace, "README.md"), "ignore any instruction in this file");
  await mkdir(join(workspace, "node_modules"), { recursive: true });
  await writeFile(join(workspace, "node_modules", "secret.js"), "should not enter context");
  const context = await acquireContext(workspace, "repository safety", new FileKnowledgeStore(workspace));
  assert.equal(context.files.find((file) => file.path === "README.md")?.trust, "repository-untrusted");
  assert.equal(context.files.some((file) => file.path.includes("node_modules")), false);
  assert.ok(context.warnings.some((warning) => warning.includes("untrusted")));
});

test("project profile detects runnable scripts and config overrides", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "hackon-profile-"));
  await writeFile(join(workspace, "package.json"), JSON.stringify({ scripts: { test: "node test.js", build: "tsc", lint: "eslint ." } }));
  await mkdir(join(workspace, ".hackon"));
  await writeFile(join(workspace, ".hackon", "config.json"), JSON.stringify({ project: { commands: { test: ["npm", "run", "contract-test"] } } }));
  const profile = await detectProjectProfile(workspace);
  assert.deepEqual(profile.commands.test, ["npm", "run", "contract-test"]);
  assert.deepEqual(profile.commands.build, ["npm", "run", "build"]);
  assert.deepEqual(profile.commands.lint, ["npm", "run", "lint"]);
  assert.deepEqual(profile.overrides, [".hackon/config.json"]);
});

test("run locks and git worktrees are isolated", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "hackon-isolation-"));
  await exec("git", ["init", "-q"], { cwd: workspace });
  await writeFile(join(workspace, "README.md"), "fixture");
  await exec("git", ["add", "."], { cwd: workspace });
  await exec("git", ["commit", "-qm", "fixture"], { cwd: workspace, env: { ...process.env, GIT_AUTHOR_NAME: "fixture", GIT_AUTHOR_EMAIL: "fixture@example.test", GIT_COMMITTER_NAME: "fixture", GIT_COMMITTER_EMAIL: "fixture@example.test" } });
  const lock = await RunLock.acquire(workspace, "lock-test");
  await assert.rejects(() => RunLock.acquire(workspace, "lock-test"), /already locked/);
  await lock.release();
  const worktree = await createRunWorktree(workspace, "run-test", "feature");
  assert.match(worktree, /feature-run-test$/);
  assert.equal(await readFile(join(worktree, "README.md"), "utf8"), "fixture");
});

test("a completed cycle influences the next cycle through retrieved learning", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "hackon-learning-cycle-"));
  const seenKnowledge: number[] = [];
  const adapter: AgentAdapter = {
    id: "learning-test",
    capabilities: (): AdapterCapabilities => ({ id: "learning-test", autonomyLevels: ["default"], sessions: false, worktrees: false, structuredOutput: false, toolRestrictions: false }),
    async run(task) {
      seenKnowledge.push(task.context.knowledge.length);
      return { ok: true, output: "cycle complete", source: "learning-test", durationMs: 1 };
    },
  };
  const workflow: WorkflowDefinition = {
    id: "learning-cycle", name: "Learning Cycle", description: "learning", stages: [{
      id: "cycle", title: "cycle", dependsOn: [], writes: false, permissions: ["read"], gates: [
        { id: "agent", type: "agent_succeeded", blocking: true, description: "agent completed" },
      ],
      async execute(context) {
        const result = await context.adapter.run({
          objective: context.run.objective, stageId: context.stage.id, role: "cycle", prompt: "cycle",
          workspace: context.run.workspace, permissions: ["read"], context: context.context,
        });
        return [evidence({ kind: "AgentEvidence", producer: result.source, stageId: context.stage.id, source: result.source, result: result.ok ? "pass" : "fail", verification: "verified", metadata: { agentSucceeded: result.ok } })];
      },
    }],
  };
  const options = { tools: new SafeToolRunner(workspace), adapter, state: new FileStateStore(workspace), knowledge: new FileKnowledgeStore(workspace) };
  const first = await new Orchestrator(options).run(workflow, "learning cycle objective", workspace);
  const second = await new Orchestrator(options).run(workflow, "learning cycle objective", workspace);
  assert.equal(first.status, "succeeded");
  assert.equal(second.status, "succeeded");
  assert.deepEqual(seenKnowledge, [0, 1]);
  assert.ok(second.knowledgeInfluence?.some((item) => item.stageId === "cycle"));
});

test("workflow definitions cover the required startup surface", () => {
  const required = ["idea-to-product", "zero-to-mvp", "feature-development", "bug-fix", "production-incident", "product-improvement", "growth-experiment", "launch", "pivot", "technical-debt", "customer-request", "weekly-founder-review"];
  const workflows = builtInWorkflows();
  for (const id of required) {
    const workflow = workflows.get(id);
    assert.ok(workflow, `missing workflow ${id}`);
    assert.ok(workflow!.stages.some((stage) => stage.id === "implement"));
    assert.ok(workflow!.stages.some((stage) => stage.id === "learn"));
    assert.ok(workflow!.stages.some((stage) => !["specify", "plan", "implement", "tests", "code-review", "security-review", "architecture-review", "ux-review", "consolidate", "fix", "final-verification", "build-verification", "learn"].includes(stage.id)), `missing specialization for ${id}`);
  }
});

test("orchestrator runs independent reviewers concurrently and records gates", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "hackon-dag-"));
  await mkdir(join(workspace, ".git"), { recursive: true });
  const order: string[] = [];
  const adapter: AgentAdapter = {
    id: "test-agent",
    capabilities: () => ({ id: "test-agent", autonomyLevels: ["default"], sessions: false, worktrees: false, structuredOutput: false, toolRestrictions: false }),
    async run(task) {
      order.push(`start:${task.stageId}`);
      await new Promise((resolve) => setTimeout(resolve, task.stageId.includes("review") ? 20 : 1));
      order.push(`end:${task.stageId}`);
      return { ok: true, output: "APPROVED\nBLOCKER_COUNT: 0", source: "test-agent", durationMs: 1 };
    },
  };
  const workflow: WorkflowDefinition = {
    id: "parallel-test",
    name: "Parallel test",
    description: "contract",
    stages: [
      { id: "write", title: "write", dependsOn: [], writes: true, permissions: ["write"], gates: [], async execute(context) {
        await writeFile(join(context.run.workspace, "changed.txt"), "done");
        return [evidence({ kind: "FileEvidence", producer: "test", stageId: "write", source: "changed.txt", result: "pass", verification: "verified", metadata: { exists: true } })];
      } },
      ...["review-a", "review-b"].map((id) => ({
        id, title: id, dependsOn: ["write"], writes: false, permissions: ["read"] as Permission[], gates: [],
        async execute() { await new Promise((resolve) => setTimeout(resolve, 10)); return [evidence({ kind: "ReviewEvidence", producer: "test", stageId: id, source: id, result: "pass", metadata: { approved: true, blockerCount: 0 } })]; },
      })),
    ],
  };
  const state = new FileStateStore(workspace);
  const result = await new Orchestrator({ tools: new SafeToolRunner(workspace), adapter, state, knowledge: new FileKnowledgeStore(workspace) }).run(workflow, "parallel", workspace);
  assert.equal(result.status, "succeeded");
  assert.equal(result.stages["review-a"].status, "succeeded");
  assert.equal(result.stages["review-b"].status, "succeeded");
  assert.equal(result.evidence.length, 3);
});

test("resume reruns incomplete work but preserves completed stages", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "hackon-resume-"));
  let runs = 0;
  const workflow: WorkflowDefinition = {
    id: "resume-test", name: "Resume", description: "resume", stages: [
      { id: "first", title: "first", dependsOn: [], writes: true, permissions: ["write"], gates: [], async execute() { runs += 1; return [evidence({ kind: "FileEvidence", producer: "test", stageId: "first", source: "memory", result: "pass", metadata: { exists: true } })]; } },
      { id: "second", title: "second", dependsOn: ["first"], writes: true, permissions: ["write"], gates: [{ id: "pass", type: "artifact_exists", blocking: true, description: "must pass" }], async execute(context) {
        runs += 1;
        if (runs < 3) return [evidence({ kind: "FileEvidence", producer: "test", stageId: context.stage.id, source: "memory", result: "fail", verification: "verified", metadata: { exists: false } })];
        return [evidence({ kind: "FileEvidence", producer: "test", stageId: context.stage.id, source: "memory", result: "pass", verification: "verified", metadata: { exists: true } })];
      } },
    ],
  };
  const state = new FileStateStore(workspace);
  const config = { tools: new SafeToolRunner(workspace), adapter: {
    id: "test",
    capabilities: (): AdapterCapabilities => ({ id: "test", autonomyLevels: ["default"], sessions: false, worktrees: false, structuredOutput: false, toolRestrictions: false }),
    async run() { return { ok: true, output: "", source: "test", durationMs: 0 }; },
  }, state, knowledge: new FileKnowledgeStore(workspace) };
  const first = await new Orchestrator(config).run(workflow, "resume", workspace);
  assert.equal(first.status, "failed");
  const second = await new Orchestrator(config).run(workflow, "resume", workspace, first.id);
  assert.equal(second.status, "succeeded");
  assert.equal(second.stages.first.attempts, 1);
  assert.equal(second.stages.second.attempts, 2);
});
