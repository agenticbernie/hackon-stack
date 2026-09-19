import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FactoryDroidAdapter } from "../src/adapters.js";
import type { AgentTask } from "../src/domain.js";

function task(workspace: string, permissions: AgentTask["permissions"], prompt = "inspect"): AgentTask {
  return {
    objective: "adapter contract",
    stageId: "contract",
    role: "test agent",
    prompt,
    workspace,
    permissions,
    context: { objective: "adapter contract", files: [], knowledge: [], warnings: [] },
  };
}

async function fakeDroid(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "hackon-fake-droid-"));
  const script = join(directory, "droid.mjs");
  await writeFile(script, `
    import { appendFileSync } from "node:fs";
    const args = process.argv.slice(2);
    if (args.includes("--version")) { console.log("droid 0.222.0-test"); process.exit(0); }
    const cwd = args[args.indexOf("--cwd") + 1];
    if (args.some((arg) => arg.includes("MUTATE"))) appendFileSync(cwd + "/changed.txt", "mutation");
    if (args.some((arg) => arg.includes("SLEEP"))) setTimeout(() => {}, 30000);
    console.log(JSON.stringify({ result: "approved openai-key-present=" + Boolean(process.env.OPENAI_API_KEY) + " OPENAI_API_KEY=secret-value", session_id: "session-contract", status: "completed" }));
  `);
  return `node ${script}`;
}

test("Factory Droid adapter uses structured sessions and enforced tool restrictions", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "hackon-adapter-"));
  const adapter = new FactoryDroidAdapter(await fakeDroid(), "hackon-openai");
  const previousKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "test-openai-key";
  const result = await adapter.run(task(workspace, ["read"]));
  if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = previousKey;
  assert.equal(result.ok, true);
  assert.equal(result.sessionId, "session-contract");
  assert.equal(result.metadata?.cliVersion, "droid 0.222.0-test");
  assert.equal(result.metadata?.model, "hackon-openai");
  assert.match(result.output, /openai-key-present=true/);
  assert.match(result.output, /\[REDACTED\]/);
  const resumed = await adapter.resume!("session-contract", task(workspace, ["read"]));
  assert.equal(resumed.ok, true);
});

test("Factory Droid adapter maps writes to bounded autonomy", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "hackon-adapter-write-"));
  const adapter = new FactoryDroidAdapter(await fakeDroid());
  const result = await adapter.run(task(workspace, ["read", "write", "execute"]));
  assert.equal(result.ok, true);
  assert.equal(result.metadata?.autonomy, "medium");
  assert.ok((result.metadata?.toolRestrictions as string[]).includes("ApplyPatch"));
});

test("Factory Droid adapter rejects read-only mutation", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "hackon-adapter-mutation-"));
  const adapter = new FactoryDroidAdapter(await fakeDroid());
  const result = await adapter.run(task(workspace, ["read"], "MUTATE"));
  assert.equal(result.ok, false);
  assert.equal(result.error, "Read-only agent task modified the workspace");
});

test("Factory Droid adapter terminates timed out processes", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "hackon-adapter-timeout-"));
  const adapter = new FactoryDroidAdapter(await fakeDroid());
  const previous = process.env.HACKON_AGENT_TIMEOUT_MS;
  process.env.HACKON_AGENT_TIMEOUT_MS = "1000";
  const result = await adapter.run(task(workspace, ["read"], "SLEEP"));
  if (previous === undefined) delete process.env.HACKON_AGENT_TIMEOUT_MS;
  else process.env.HACKON_AGENT_TIMEOUT_MS = previous;
  assert.equal(result.ok, false);
  assert.equal(result.metadata?.timedOut, true);
});
