import { spawn } from "node:child_process";
import { resolve, relative } from "node:path";
import type { ToolExecutor, ToolRequest, ToolResult } from "./domain.js";

const blocked = new Set(["rm", "rmdir", "del", "shutdown", "reboot", "mkfs", "dd", "git reset", "git clean"]);

export class SafeToolRunner implements ToolExecutor {
  constructor(private readonly workspace: string, private readonly defaultTimeoutMs = 120_000) {}

  async run(request: ToolRequest): Promise<ToolResult> {
    if (request.argv.length === 0 || request.argv.some((part) => part.includes("\0"))) {
      throw new Error("A non-empty, NUL-free argv is required");
    }
    const cwd = resolve(request.cwd);
    const root = resolve(this.workspace);
    const rel = relative(root, cwd);
    if (rel.startsWith("..") || rel.includes(`${process.platform === "win32" ? "\\" : "/"}..`)) {
      throw new Error(`Working directory escapes workspace: ${cwd}`);
    }
    const command = request.argv.join(" ");
    const normalized = request.argv.slice(0, 2).join(" ");
    if (blocked.has(request.argv[0]) || blocked.has(normalized) || request.argv.includes("--hard")) {
      throw new Error(`Destructive command blocked: ${command}`);
    }
    const started = Date.now();
    const timestamp = new Date().toISOString();
    return await new Promise<ToolResult>((resolveResult, reject) => {
      const child = spawn(request.argv[0], request.argv.slice(1), {
        cwd,
        env: { ...process.env, ...request.env },
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk: Buffer) => {
        stdout += chunk.toString();
      });
      child.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString();
      });
      let timedOut = false;
      const timeout = setTimeout(() => {
        timedOut = true;
        child.kill("SIGTERM");
      }, request.timeoutMs ?? this.defaultTimeoutMs);
      child.once("error", (error) => {
        clearTimeout(timeout);
        reject(error);
      });
      child.once("close", (exitCode) => {
        clearTimeout(timeout);
        resolveResult({
          command,
          cwd,
          exitCode,
          stdout: stdout.slice(-200_000),
          stderr: stderr.slice(-200_000),
          durationMs: Date.now() - started,
          timestamp,
          timedOut,
        });
      });
    });
  }
}
