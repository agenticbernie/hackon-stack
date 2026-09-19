import { execFile } from "node:child_process";
import { mkdir, realpath } from "node:fs/promises";
import { promisify } from "node:util";
import { join } from "node:path";
import type { RunState } from "./domain.js";

const execFileAsync = promisify(execFile);

export async function createRunWorktree(root: string, runId: string, requestedName = "run"): Promise<string> {
  if (!/^[a-zA-Z0-9._-]+$/.test(requestedName)) throw new Error("Invalid worktree name");
  const path = join(root, ".hackon", "worktrees", `${requestedName}-${runId}`);
  await mkdir(join(root, ".hackon", "worktrees"), { recursive: true });
  try {
    await execFileAsync("git", ["rev-parse", "--show-toplevel"], { cwd: root });
    await execFileAsync("git", ["worktree", "add", "--detach", path, "HEAD"], { cwd: root });
    return path;
  } catch (error) {
    throw new Error(`Unable to create isolated git worktree: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function cleanupRunWorktree(root: string, run: RunState, force = false): Promise<void> {
  if (!run.worktreePath) return;
  const rootReal = await realpath(root);
  const target = join(rootReal, ".hackon", "worktrees", `${run.worktreePath.split("/").pop() ?? ""}`);
  const targetReal = await realpath(run.worktreePath).catch(() => undefined);
  if (!targetReal || targetReal !== target || !targetReal.startsWith(`${join(rootReal, ".hackon", "worktrees")}/`)) {
    throw new Error("Refusing to clean an unexpected worktree path");
  }
  const status = await execFileAsync("git", ["status", "--porcelain"], { cwd: targetReal });
  if (status.stdout.trim() && !force) throw new Error("Worktree has unapplied changes; use --force only after reviewing the diff");
  await execFileAsync("git", ["worktree", "remove", ...(force ? ["--force"] : []), targetReal], { cwd: rootReal });
  await execFileAsync("git", ["worktree", "prune"], { cwd: rootReal });
}
