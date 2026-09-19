#!/usr/bin/env node
import { access, constants, mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { builtInWorkflows } from "./workflows.js";
import { FileKnowledgeStore, FileStateStore } from "./state.js";
import { OpenCodeAdapter } from "./adapters.js";
import { SafeToolRunner } from "./tool-runner.js";
import { Orchestrator } from "./orchestrator.js";

const version = "0.1.0";
const workflows = builtInWorkflows();

function help(): void {
  console.log(`HackOn Stack ${version}

Usage:
  hackon init
  hackon doctor
  hackon status
  hackon run <workflow> --objective "..."
  hackon run <workflow> --objective "..." --resume <run-id>
  hackon discover|research|product|plan|build|review|ship|grow|learn --objective "..."

Options:
  --workspace <path>       Workspace to operate on (default: current directory)
  --objective <text>       Natural-language objective
  --resume <run-id>        Resume a persisted run
  --json                   Emit machine-readable output
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
    adapter: "opencode",
    command: process.env.HACKON_OPENCODE_COMMAND ?? "opencode",
    permissions: { read: true, write: true, execute: true, network: false, external: false },
  }, null, 2));
  console.log(`Initialized HackOn in ${workspace}`);
}

async function doctor(workspace: string): Promise<number> {
  const executableOnPath = async (command: string): Promise<boolean> => {
    for (const directory of (process.env.PATH ?? "").split(":")) {
      if (!directory) continue;
      if (await access(join(directory, command), constants.X_OK).then(() => true).catch(() => false)) return true;
    }
    return false;
  };
  const checks: Record<string, string | boolean> = {
    node: process.versions.node,
    package: await access(join(workspace, "package.json")).then(() => true).catch(() => false),
    hackonConfig: await access(join(workspace, ".hackon", "config.json")).then(() => true).catch(() => false),
    opencode: await executableOnPath("opencode"),
  };
  console.log(JSON.stringify(checks, null, 2));
  return checks.hackonConfig === true ? 0 : 1;
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

  const aliases: Record<string, string> = {
    discover: "idea-to-product", research: "idea-to-product", product: "product-improvement",
    plan: "feature-development", build: "feature-development", review: "feature-development",
    ship: "launch", grow: "growth-experiment", learn: "weekly-founder-review",
  };
  const workflowId = command === "run" ? args[1] : aliases[command];
  if (!workflowId || !workflows.has(workflowId)) {
    console.error(`Unknown command or workflow: ${command}`);
    help();
    return 2;
  }
  const objective = option(args, "--objective") ?? (command === "run" ? undefined : args.slice(1).filter((arg) => !arg.startsWith("--")).join(" "));
  if (!objective) {
    console.error("Missing --objective. A natural-language objective is required.");
    return 2;
  }
  const adapter = new OpenCodeAdapter(option(args, "--adapter-command"));
  const orchestrator = new Orchestrator({
    tools: new SafeToolRunner(workspace),
    adapter,
    state: new FileStateStore(workspace),
    knowledge: new FileKnowledgeStore(workspace),
    onEvent: (event) => {
      if (!args.includes("--json")) console.error(`[${event.type}]${event.stageId ? ` ${event.stageId}` : ""}${event.message ? ` ${event.message}` : ""}`);
    },
  });
  const result = await orchestrator.run(workflows.get(workflowId)!, objective, workspace, option(args, "--resume"));
  console.log(args.includes("--json") ? JSON.stringify(result, null, 2) : `Run ${result.id}: ${result.status}`);
  return result.status === "succeeded" ? 0 : 1;
}

main().then((code) => process.exitCode = code).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
