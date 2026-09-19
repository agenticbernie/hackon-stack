import { spawn } from "node:child_process";
import { resolve, relative } from "node:path";
import { realpath } from "node:fs/promises";
import type { Permission, ToolExecutor, ToolRequest, ToolResult } from "./domain.js";

const blocked = new Set(["rm", "rmdir", "del", "shutdown", "reboot", "mkfs", "dd", "git reset", "git clean"]);
const networkCommands = new Set(["curl", "wget", "nc", "ssh", "scp", "npm publish", "git fetch", "git pull", "git push"]);
const writeCommands = new Set(["touch", "mkdir", "rmdir", "del", "git add", "git commit", "git checkout", "git restore", "npm install", "npm ci"]);

function allowedEnvironment(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const names = ["PATH", "HOME", "USER", "LANG", "LANGUAGE", "TERM", "TMPDIR", "XDG_CONFIG_HOME", "XDG_DATA_HOME", "HACKON_OPENCODE_COMMAND", "HACKON_OPENCODE_AUTO_APPROVE"];
  return Object.fromEntries(names.filter((name) => process.env[name] !== undefined).map((name) => [name, process.env[name]]).concat(Object.entries(extra)));
}

function hasCommand(argv: string[], commands: Set<string>): boolean {
  return commands.has(argv[0]) || commands.has(argv.slice(0, 2).join(" "));
}

export class SafeToolRunner implements ToolExecutor {
  constructor(private readonly workspace: string, private readonly defaultTimeoutMs = 120_000) {}

  async run(request: ToolRequest): Promise<ToolResult> {
    if (request.argv.length === 0 || request.argv.some((part) => part.includes("\0"))) {
      throw new Error("A non-empty, NUL-free argv is required");
    }
    const cwd = await realpath(resolve(request.cwd));
    const root = await realpath(resolve(this.workspace));
    const rel = relative(root, cwd);
    if (rel.startsWith("..") || rel.includes(`${process.platform === "win32" ? "\\" : "/"}..`)) {
      throw new Error(`Working directory escapes workspace: ${cwd}`);
    }
    const command = request.argv.join(" ");
    const normalized = request.argv.slice(0, 2).join(" ");
    const permissions = new Set<Permission>(request.permissions ?? ["read", "execute"]);
    if (!permissions.has("execute")) throw new Error(`Execute permission required: ${command}`);
    if (hasCommand(request.argv, networkCommands) && !permissions.has("network")) {
      throw new Error(`Network permission required: ${command}`);
    }
    if (hasCommand(request.argv, writeCommands) && !permissions.has("write")) {
      throw new Error(`Write permission required: ${command}`);
    }
    if (blocked.has(request.argv[0]) || blocked.has(normalized) || request.argv.includes("--hard")) {
      throw new Error(`Destructive command blocked: ${command}`);
    }
    const started = Date.now();
    const timestamp = new Date().toISOString();
    return await new Promise<ToolResult>((resolveResult, reject) => {
      const child = spawn(request.argv[0], request.argv.slice(1), {
        cwd,
        env: allowedEnvironment(request.env),
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
