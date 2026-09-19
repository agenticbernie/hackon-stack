import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { KnowledgeStore, RunState, StateStore } from "./domain.js";

export class FileStateStore implements StateStore {
  private readonly directory: string;
  constructor(workspace: string) {
    this.directory = join(workspace, ".hackon", "runs");
  }
  async load(runId: string): Promise<RunState | undefined> {
    try {
      return JSON.parse(await readFile(join(this.directory, `${runId}.json`), "utf8")) as RunState;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
  }
  async save(run: RunState): Promise<void> {
    await mkdir(this.directory, { recursive: true });
    await writeFile(join(this.directory, `${run.id}.json`), JSON.stringify(run, null, 2));
  }
  async list(): Promise<RunState[]> {
    try {
      const names = await readdir(this.directory);
      return Promise.all(names.filter((name) => name.endsWith(".json")).map(async (name) =>
        JSON.parse(await readFile(join(this.directory, name), "utf8")) as RunState));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
  }
}

type KnowledgeEntry = { id: string; title: string; content: string; tags: string[]; sourceRunId: string; createdAt: string };

function redact(value: string): string {
  return value
    .replace(/(?:sk|pk|ghp|api[_-]?key|token)[_:=\s]+[A-Za-z0-9._-]{12,}/gi, "[REDACTED]")
    .replace(/-----BEGIN [^-]+-----[\s\S]+?-----END [^-]+-----/g, "[REDACTED KEY]");
}

export class FileKnowledgeStore implements KnowledgeStore {
  private readonly file: string;
  constructor(workspace: string) {
    this.file = join(workspace, ".hackon", "knowledge.json");
  }
  private async read(): Promise<KnowledgeEntry[]> {
    try {
      return JSON.parse(await readFile(this.file, "utf8")) as KnowledgeEntry[];
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
  }
  async save(entry: { title: string; content: string; tags: string[]; sourceRunId: string }): Promise<void> {
    const entries = await this.read();
    entries.push({ ...entry, id: crypto.randomUUID(), content: redact(entry.content), createdAt: new Date().toISOString() });
    await mkdir(join(this.file, ".."), { recursive: true });
    await writeFile(this.file, JSON.stringify(entries, null, 2));
  }
  async search(query: string, limit = 5): Promise<Array<{ id: string; title: string; content: string; score: number }>> {
    const terms = new Set(query.toLowerCase().split(/\W+/).filter((term) => term.length > 2));
    return (await this.read())
      .map((entry) => {
        const haystack = `${entry.title} ${entry.content} ${entry.tags.join(" ")}`.toLowerCase();
        const score = [...terms].filter((term) => haystack.includes(term)).length;
        return { id: entry.id, title: entry.title, content: entry.content, score };
      })
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }
}
