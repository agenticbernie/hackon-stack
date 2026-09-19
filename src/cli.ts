#!/usr/bin/env node
import { access, constants, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { builtInWorkflows } from "./workflows.js";
import { FileKnowledgeStore, FileStateStore } from "./state.js";
import { FactoryDroidAdapter, OpenCodeAdapter } from "./adapters.js";
import { SafeToolRunner } from "./tool-runner.js";
import { Orchestrator } from "./orchestrator.js";
import { detectProjectProfile } from "./project-profile.js";
import { RunCancellation } from "./cancellation.js";
import { cleanupRunWorktree } from "./worktree.js";
import type { AgentAdapter } from "./domain.js";

const version = "0.1.0";
const supportedDroidVersion = "0.222.0";
const workflows = builtInWorkflows();
const execFileAsync = promisify(execFile);

function help(): void {
  console.log(`HackOn Stack ${version}

Usage:
  hackon init
  hackon doctor
  hackon status
  hackon inspect <run-id>
  hackon evidence <run-id>
  hackon resume <run-id>
  hackon cancel <run-id>
  hackon cleanup <run-id>
  hackon workflows
  hackon skills
  hackon knowledge search <query>
  hackon run <workflow> --objective "..."
  hackon run <workflow> --objective "..." --resume <run-id>
  hackon discover|research|product|plan|build|review|ship|grow|learn --objective "..."

Options:
  --workspace <path>       Workspace to operate on (default: current directory)
  --objective <text>       Natural-language objective
  --resume <run-id>        Resume a persisted run
  --json                   Emit machine-readable output
  --adapter <id>           factory-droid (default) or opencode
  --adapter-command <cmd>  Override the selected adapter executable
  --model <id>             Factory Droid model or configured BYOK model
  --worktree <name>        Run in an isolated Droid/Git worktree
  --in-place               Explicitly allow modifying the canonical checkout
  --dry-run                Show the selected workflow and profile without executing
  --help, --version

Workflows:
  ${[...workflows.keys()].join(", ")}
`);
}

function option(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

async function init(workspace: string): Promise<void> {
  const dir = join(workspace, ".hackon");
  await mkdir(join(dir, "runs"), { recursive: true });
  await mkdir(join(dir, "learning"), { recursive: true });
  await writeFile(join(dir, "config.json"), JSON.stringify({
    schemaVersion: 1,
    adapter: "factory-droid",
    command: process.env.HACKON_DROID_COMMAND ?? "droid",
    model: process.env.HACKON_DROID_MODEL,
    auth: { factoryEnv: "FACTORY_API_KEY", byokEnv: "OPENAI_API_KEY" },
    permissions: { read: true, write: true, execute: true, network: false, external: false },
  }, null, 2));
  console.log(`Initialized HackOn in ${workspace}`);
}

async function skillsDirectory(): Promise<string> {
  const candidates = [
    fileURLToPath(new URL("../skills", import.meta.url)),
    fileURLToPath(new URL("../../skills", import.meta.url)),
  ];
  for (const candidate of candidates) {
    if (await access(candidate).then(() => true).catch(() => false)) return candidate;
  }
  throw new Error("Packaged skills directory was not found");
}

async function doctor(workspace: string): Promise<number> {
  const executableVersion = async (command: string): Promise<string | false> => {
    for (const directory of (process.env.PATH ?? "").split(":")) {
      if (!directory) continue;
      const path = join(directory, command);
      if (await access(path, constants.X_OK).then(() => true).catch(() => false)) {
        try {
          const result = await execFileAsync(path, ["--version"], { env: process.env });
          return result.stdout.trim().slice(0, 200);
        } catch {
          return "installed (version unavailable)";
        }
      }
    }
    return false;
  };
  const profile = await detectProjectProfile(workspace);
  const config = await readFile(join(workspace, ".hackon", "config.json"), "utf8").then((value) => JSON.parse(value) as Record<string, unknown>).catch(() => undefined);
  const droidVersion = await executableVersion("droid");
  const expectedDroidVersion = process.env.HACKON_EXPECTED_DROID_VERSION ?? supportedDroidVersion;
  const factoryAuthFile = await access(join(process.env.HOME ?? "", ".factory", "auth.v2.file")).then(() => true).catch(() => false);
  const factoryAuthKey = await access(join(process.env.HOME ?? "", ".factory", "auth.v2.keyring")).then(() => true).catch(() => false);
  const configuredModel = String(config?.model ?? process.env.HACKON_DROID_MODEL ?? "factory-default");
  const settings = await readFile(join(process.env.HOME ?? "", ".factory", "settings.json"), "utf8")
    .then((value) => JSON.parse(value) as { customModels?: Array<{ id?: string; model?: string; provider?: string }> })
    .catch((): { customModels?: Array<{ id?: string; model?: string; provider?: string }> } => ({}));
  const customModel = settings.customModels?.find((model) => model.id === configuredModel || model.model === configuredModel);
  const byokProvider = customModel?.provider;
  const byokConfigured = byokProvider === "openai" ? Boolean(process.env.OPENAI_API_KEY) :
    byokProvider === "anthropic" ? Boolean(process.env.ANTHROPIC_API_KEY) : undefined;
  const result = (pass: boolean, warning = false): "PASS" | "WARN" | "FAIL" => pass ? "PASS" : warning ? "WARN" : "FAIL";
  const checks: Record<string, unknown> = {
    node: process.versions.node,
    factoryDroid: { status: result(droidVersion !== false && String(droidVersion).includes(expectedDroidVersion)), version: droidVersion, expectedVersion: expectedDroidVersion },
    factoryAuthentication: { status: result(Boolean(process.env.FACTORY_API_KEY || factoryAuthFile || factoryAuthKey)), source: process.env.FACTORY_API_KEY ? "FACTORY_API_KEY" : factoryAuthFile || factoryAuthKey ? "Droid login/session" : "missing" },
    byok: { status: byokConfigured === undefined ? "WARN" : result(byokConfigured, true), provider: byokProvider ?? "none", configuredModel },
    git: { status: result((await executableVersion("git")) !== false) },
    projectProfile: profile,
    worktreeCapability: { status: result(profile.monorepo !== undefined, true), availableForGitRepositories: true },
    hackonConfig: { status: result(await access(join(workspace, ".hackon", "config.json")).then(() => true).catch(() => false)) },
    adapter: String(config?.adapter ?? "factory-droid"),
  };
  console.log(JSON.stringify(checks, null, 2));
  const statuses = JSON.stringify(checks);
  return statuses.includes('"status": "FAIL"') ? 1 : 0;
}

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.length === 0) {
    help();
    return 0;
  }
  if (args.includes("--version")) {
    console.log(version);
    return 0;
  }
  const workspace = resolve(option(args, "--workspace") ?? process.cwd());
  const command = args[0];
  if (command === "init") {
    await init(workspace);
    return 0;
  }
  if (command === "doctor") return doctor(workspace);
  if (command === "status") {
    const runs = await new FileStateStore(workspace).list();
    const output = args.includes("--json") ? JSON.stringify(runs, null, 2) :
      runs.map((run) => `${run.id} ${run.workflowId} ${run.status} ${run.objective}`).join("\n");
    console.log(output || "No HackOn runs found.");
    return 0;
  }
  if (command === "workflows") {
    console.log(args.includes("--json") ? JSON.stringify([...workflows.values()], null, 2) :
      [...workflows.values()].map((workflow) => `${workflow.id}: ${workflow.description}`).join("\n"));
    return 0;
  }
  if (command === "skills") {
    const skillsRoot = await skillsDirectory();
    const skills = (await readdir(skillsRoot, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    console.log(args.includes("--json") ? JSON.stringify(skills) : skills.join("\n"));
    return 0;
  }
  if (command === "inspect" || command === "evidence") {
    const runId = args[1];
    if (!runId) {
      console.error(`Missing run ID for ${command}`);
      return 2;
    }
    const run = await new FileStateStore(workspace).load(runId);
    if (!run) {
      console.error(`Run not found: ${runId}`);
      return 1;
    }
    const value = command === "evidence" ? run.evidence : run;
    console.log(args.includes("--json") ? JSON.stringify(value, null, 2) : JSON.stringify(value, null, 2));
    return 0;
  }
  if (command === "knowledge" && args[1] === "search") {
    const query = args.slice(2).join(" ");
    const results = await new FileKnowledgeStore(workspace).search(query);
    console.log(args.includes("--json") ? JSON.stringify(results, null, 2) : results.map((result) => `${result.score} ${result.title}`).join("\n"));
    return 0;
  }
  if (command === "cancel") {
    const runId = args[1];
    if (!runId) return 2;
    const store = new FileStateStore(workspace);
    const run = await store.load(runId);
    if (!run) return 1;
    await RunCancellation.request(workspace, runId, option(args, "--reason") ?? "cancelled by operator");
    if (run.status !== "running") {
      run.status = "cancelled";
      run.cancellation = { requestedAt: new Date().toISOString(), reason: option(args, "--reason") ?? "cancelled by operator" };
      run.updatedAt = new Date().toISOString();
      await store.save(run);
    }
    console.log(run.status === "running" ? `Cancellation requested for ${runId}` : `Cancelled ${runId}`);
    return 0;
  }
  if (command === "cleanup") {
    const runId = args[1];
    if (!runId) return 2;
    const store = new FileStateStore(workspace);
    const run = await store.load(runId);
    if (!run) return 1;
    await cleanupRunWorktree(workspace, run, args.includes("--force"));
    console.log(`Cleaned up worktree for ${runId}`);
    return 0;
  }

  const aliases: Record<string, string> = {
    discover: "idea-to-product", research: "idea-to-product", product: "product-improvement",
    plan: "feature-development", build: "feature-development", review: "feature-development",
    ship: "launch", grow: "growth-experiment", learn: "weekly-founder-review",
  };
  const workflowId = command === "resume" ? undefined : command === "run" ? args[1] : aliases[command];
  const resumeId = option(args, "--resume") ?? (command === "resume" ? args[1] : undefined);
  const resumeRun = resumeId ? await new FileStateStore(workspace).load(resumeId) : undefined;
  const resolvedWorkflowId = resumeRun?.workflowId ?? workflowId;
  if (!resolvedWorkflowId || !workflows.has(resolvedWorkflowId)) {
    console.error(`Unknown command or workflow: ${command}`);
    help();
    return 2;
  }
  const objective = option(args, "--objective") ?? resumeRun?.objective ?? (command === "run" ? undefined : args.slice(1).filter((arg) => !arg.startsWith("--")).join(" "));
  if (!objective) {
    console.error("Missing --objective. A natural-language objective is required.");
    return 2;
  }
  if (args.includes("--dry-run")) {
    console.log(JSON.stringify({ workflow: resolvedWorkflowId, objective, projectProfile: await detectProjectProfile(workspace) }, null, 2));
    return 0;
  }
  const adapterId = option(args, "--adapter") ?? "factory-droid";
  const runtimeConfig = await readFile(join(workspace, ".hackon", "config.json"), "utf8")
    .then((value) => JSON.parse(value) as { adapter?: string; command?: string; model?: string })
    .catch((): { adapter?: string; command?: string; model?: string } => ({}));
  const configuredAdapter = option(args, "--adapter") ?? runtimeConfig.adapter ?? adapterId;
  const configuredCommand = option(args, "--adapter-command") ?? runtimeConfig.command;
  const configuredModel = option(args, "--model") ?? runtimeConfig.model;
  let adapter: AgentAdapter;
  if (configuredAdapter === "opencode") adapter = new OpenCodeAdapter(configuredCommand);
  else if (configuredAdapter === "factory-droid") adapter = new FactoryDroidAdapter(configuredCommand, configuredModel);
  else {
    console.error(`Unknown adapter: ${configuredAdapter}`);
    return 2;
  }
  const orchestrator = new Orchestrator({
    tools: new SafeToolRunner(workspace),
    adapter,
    state: new FileStateStore(workspace),
    knowledge: new FileKnowledgeStore(workspace),
    onEvent: (event) => {
      if (!args.includes("--json")) console.error(`[${event.type}]${event.stageId ? ` ${event.stageId}` : ""}${event.message ? ` ${event.message}` : ""}`);
    },
  });
  const result = await orchestrator.run(workflows.get(resolvedWorkflowId)!, objective, workspace, resumeId, {
    worktree: option(args, "--worktree"),
    inPlace: args.includes("--in-place"),
  });
  console.log(args.includes("--json") ? JSON.stringify(result, null, 2) : `Run ${result.id}: ${result.status}`);
  return result.status === "succeeded" ? 0 : 1;
}

main().then((code) => process.exitCode = code).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
