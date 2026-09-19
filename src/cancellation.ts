import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

type CancellationRecord = { runId: string; requestedAt: string; reason?: string };

function markerPath(workspace: string, runId: string): string {
  if (!/^[a-zA-Z0-9-]+$/.test(runId)) throw new Error("Invalid run ID");
  return join(workspace, ".hackon", "cancellation", `${runId}.json`);
}

export class RunCancellation {
  private static readonly active = new Map<string, AbortController>();

  static register(runId: string, controller: AbortController): void {
    this.active.set(runId, controller);
  }

  static unregister(runId: string): void {
    this.active.delete(runId);
  }

  static watch(workspace: string, runId: string, controller: AbortController, intervalMs = 250): () => void {
    const timer = setInterval(() => {
      void this.read(workspace, runId).then((record) => {
        if (record && !controller.signal.aborted) controller.abort(record.reason);
      }).catch(() => undefined);
    }, intervalMs);
    timer.unref();
    return () => clearInterval(timer);
  }

  static async request(workspace: string, runId: string, reason = "cancelled by operator"): Promise<void> {
    const record: CancellationRecord = { runId, requestedAt: new Date().toISOString(), reason };
    const path = markerPath(workspace, runId);
    await mkdir(join(workspace, ".hackon", "cancellation"), { recursive: true });
    await writeFile(path, JSON.stringify(record, null, 2), { encoding: "utf8", flag: "w" });
    this.active.get(runId)?.abort(reason);
  }

  static async read(workspace: string, runId: string): Promise<CancellationRecord | undefined> {
    try {
      return JSON.parse(await readFile(markerPath(workspace, runId), "utf8")) as CancellationRecord;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
  }

  static async clear(workspace: string, runId: string): Promise<void> {
    await unlink(markerPath(workspace, runId)).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
    });
  }
}
