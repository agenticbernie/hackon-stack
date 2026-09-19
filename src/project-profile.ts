import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { ProjectProfile } from "./domain.js";

type PackageJson = {
  packageManager?: string;
  workspaces?: unknown;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

async function exists(path: string): Promise<boolean> {
  return access(path).then(() => true).catch(() => false);
}

async function readJson<T>(path: string): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch {
    return undefined;
  }
}

function commandFor(scriptName: string | undefined, manager: ProjectProfile["packageManager"]): string[] | undefined {
  if (!scriptName || !manager) return undefined;
  return [manager, ...(manager === "npm" ? ["run", scriptName] : [scriptName])];
}

export async function detectProjectProfile(root: string): Promise<ProjectProfile> {
  const packageJson = await readJson<PackageJson>(join(root, "package.json"));
  const config = await readJson<{ project?: Partial<ProjectProfile> }>(join(root, ".hackon", "config.json"));
  const detectedFrom: string[] = [];
  const languages: string[] = [];
  const frameworks: string[] = [];
  let packageManager: ProjectProfile["packageManager"];
  if (await exists(join(root, "pnpm-lock.yaml"))) packageManager = "pnpm";
  else if (await exists(join(root, "yarn.lock"))) packageManager = "yarn";
  else if (await exists(join(root, "bun.lockb")) || await exists(join(root, "bun.lock"))) packageManager = "bun";
  else if (packageJson) packageManager = "npm";
  if (packageManager) detectedFrom.push(packageManager === "npm" ? "package.json" : `${packageManager} lockfile`);
  if (packageJson) {
    languages.push("JavaScript");
    if (await exists(join(root, "tsconfig.json"))) languages.push("TypeScript");
    const allDependencies = { ...packageJson.dependencies, ...packageJson.devDependencies };
    for (const framework of ["react", "next", "express", "fastify", "vite", "hono", "nestjs"]) {
      if (Object.keys(allDependencies).some((name) => name === framework || name.includes(framework))) frameworks.push(framework);
    }
  }
  if (await exists(join(root, "pyproject.toml")) || await exists(join(root, "requirements.txt"))) languages.push("Python");
  if (await exists(join(root, "go.mod"))) languages.push("Go");
  if (await exists(join(root, "Cargo.toml"))) languages.push("Rust");
  if (await exists(join(root, "foundry.toml"))) {
    languages.push("Solidity");
    frameworks.push("Foundry");
  }
  if (await exists(join(root, "Move.toml"))) {
    languages.push("Move");
    frameworks.push("Sui/Move");
  }
  const scripts = packageJson?.scripts ?? {};
  const base: ProjectProfile = {
    root,
    languages: [...new Set(languages)],
    frameworks: [...new Set(frameworks)],
    packageManager,
    monorepo: Boolean(packageJson?.workspaces) || await exists(join(root, "pnpm-workspace.yaml")),
    commands: {
      test: commandFor(scripts.test ? "test" : undefined, packageManager) ??
        (await exists(join(root, "go.mod")) ? ["go", "test", "./..."] :
          await exists(join(root, "Cargo.toml")) ? ["cargo", "test"] :
            await exists(join(root, "foundry.toml")) ? ["forge", "test"] :
              await exists(join(root, "pyproject.toml")) || await exists(join(root, "requirements.txt")) ? ["pytest"] : undefined),
      build: commandFor(scripts.build ? "build" : undefined, packageManager) ?? (await exists(join(root, "Cargo.toml")) ? ["cargo", "build"] : await exists(join(root, "go.mod")) ? ["go", "build", "./..."] : undefined),
      lint: commandFor(scripts.lint ? "lint" : undefined, packageManager),
      typecheck: commandFor(scripts.typecheck ? "typecheck" : undefined, packageManager),
      security: commandFor(scripts.audit ? "audit" : undefined, packageManager) ?? (await exists(join(root, "Cargo.toml")) ? ["cargo", "audit"] : undefined),
    },
    workingDirectories: ["."],
    detectedFrom,
    overrides: [],
  };
  const override = config?.project;
  if (override) {
    const merged = {
      ...base,
      ...override,
      languages: override.languages ?? base.languages,
      frameworks: override.frameworks ?? base.frameworks,
      commands: { ...base.commands, ...override.commands },
      workingDirectories: override.workingDirectories ?? base.workingDirectories,
      overrides: [".hackon/config.json"],
    };
    return merged;
  }
  return base;
}
