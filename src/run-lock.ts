import { mkdir, open, readFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { rename } from "node:fs/promises";

type LockRecord = { token: string; pid: number; startedAt: string };

export class RunLock {
  private constructor(private readonly path: string, private readonly token: string) {}

  static async acquire(workspace: string, runId: string, staleAfterMs = 60 * 60 * 1000): Promise<RunLock> {
    const directory = join(workspace, ".hackon", "locks");
    await mkdir(directory, { recursive: true });
    const path = join(directory, `${runId}.lock`);
    const record: LockRecord = { token: randomUUID(), pid: process.pid, startedAt: new Date().toISOString() };
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const handle = await open(path, "wx");
        await handle.writeFile(JSON.stringify(record));
        await handle.close();
        return new RunLock(path, record.token);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        const stale = await RunLock.isStale(path, staleAfterMs);
        if (!stale || attempt > 0) throw new Error(`Run is already locked: ${runId}`);
        const stalePath = `${path}.${randomUUID()}.stale`;
        await rename(path, stalePath).then(() => unlink(stalePath)).catch(() => undefined);
      }
    }
    throw new Error(`Unable to acquire run lock: ${runId}`);
  }

  private static async isStale(path: string, staleAfterMs: number): Promise<boolean> {
    try {
      const record = JSON.parse(await readFile(path, "utf8")) as LockRecord;
      const age = Date.now() - new Date(record.startedAt).getTime();
      if (record.pid === process.pid) return false;
      if (age > staleAfterMs) return true;
      try {
        process.kill(record.pid, 0);
        return false;
      } catch {
        return true;
      }
    } catch {
      return true;
    }
  }

  async release(): Promise<void> {
    try {
      const record = JSON.parse(await readFile(this.path, "utf8")) as LockRecord;
      if (record.token === this.token) await unlink(this.path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
}
