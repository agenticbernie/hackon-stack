import { execFile } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { promisify } from "node:util";
import { join } from "node:path";

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
