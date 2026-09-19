import test from "node:test";
import assert from "node:assert/strict";
import { builtInWorkflows } from "../src/workflows.js";

test("workflow contract has unique ids, valid dependencies, and blocking gates", () => {
  for (const workflow of builtInWorkflows().values()) {
    const ids = new Set(workflow.stages.map((stage) => stage.id));
    assert.equal(ids.size, workflow.stages.length, workflow.id);
    for (const stage of workflow.stages) {
      for (const dependency of stage.dependsOn) assert.ok(ids.has(dependency), `${workflow.id}:${stage.id} -> ${dependency}`);
      for (const gate of stage.gates) assert.ok(gate.id && gate.description && gate.type, `${workflow.id}:${stage.id}`);
    }
  }
});
