import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { FileKnowledgeStore, FileStateStore } from "../src/state.js";
import { SafeToolRunner } from "../src/tool-runner.js";
import { OpenCodeAdapter } from "../src/adapters.js";
import { Orchestrator } from "../src/orchestrator.js";
import { builtInWorkflows } from "../src/workflows.js";

const exec = promisify(execFile);

test("real OpenCode feature path modifies and verifies a fixture when enabled", { timeout: 15 * 60_000 }, async (t) => {
  if (process.env.HACKON_REAL_E2E !== "1") {
    t.skip("set HACKON_REAL_E2E=1 to spend a real model call");
    return;
  }
  const workspace = await mkdtemp(join(tmpdir(), "hackon-real-feature-"));
  await exec("git", ["init", "-q"], { cwd: workspace });
  await writeFile(join(workspace, "package.json"), JSON.stringify({
    name: "fixture", type: "module", scripts: { test: "node --test", build: "node --check app.js" },
  }, null, 2));
  await writeFile(join(workspace, "app.js"), "export function slugify(value) { return value.trim().toLowerCase().replaceAll(' ', '-'); }\n");
  await writeFile(join(workspace, "app.test.js"), "import test from 'node:test'; import assert from 'node:assert/strict'; import { slugify } from './app.js'; test('slugify', () => assert.equal(slugify('Hello World'), 'hello-world'));\n");
  await exec("git", ["add", "."], { cwd: workspace });
  await exec("git", ["commit", "-qm", "fixture"], { cwd: workspace, env: { ...process.env, GIT_AUTHOR_NAME: "fixture", GIT_AUTHOR_EMAIL: "fixture@example.test", GIT_COMMITTER_NAME: "fixture", GIT_COMMITTER_EMAIL: "fixture@example.test" } });
  const result = await new Orchestrator({
    tools: new SafeToolRunner(workspace, 180_000),
    adapter: new OpenCodeAdapter(),
    state: new FileStateStore(workspace),
    knowledge: new FileKnowledgeStore(workspace),
  }).run(builtInWorkflows().get("feature-development")!, "Add a function named reverseWords that reverses the order of whitespace-separated words, with tests for empty input and multiple spaces.", workspace);
  assert.equal(result.status, "succeeded", JSON.stringify(result, null, 2));
  await exec("npm", ["test"], { cwd: workspace });
  assert.ok(result.evidence.some((item) => item.kind === "TestEvidence" && item.result === "pass"));
});
