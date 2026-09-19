import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);

test("packed CLI discovers runtime skills without cwd assumptions", async () => {
  const packageDirectory = await mkdtemp(join(tmpdir(), "hackon-pack-"));
  const installDirectory = await mkdtemp(join(tmpdir(), "hackon-install-"));
  const packed = (await exec("npm", ["pack", "--pack-destination", packageDirectory, "--silent"], { cwd: process.cwd() })).stdout.trim();
  const tarball = join(packageDirectory, packed.split(/\r?\n/).pop()!);
  const listing = (await exec("tar", ["-tzf", tarball])).stdout;
  assert.equal(listing.includes("/dist/test/"), false);
  await exec("npm", ["install", "--ignore-scripts", "--prefix", installDirectory, tarball], { cwd: installDirectory });
  const binary = join(installDirectory, "node_modules", ".bin", "hackon");
  const version = await exec(binary, ["--version"], { cwd: installDirectory });
  assert.match(version.stdout.trim(), /^\d+\.\d+\.\d+$/);
  const skills = await exec(binary, ["skills"], { cwd: join(installDirectory, "node_modules") });
  assert.match(skills.stdout, /debugging/);
  assert.match(skills.stdout, /learning-influence/);
  await exec(binary, ["init"], { cwd: installDirectory });
  const workflows = await exec(binary, ["workflows"], { cwd: installDirectory });
  assert.match(workflows.stdout, /feature-development/);
  const status = await exec(binary, ["status", "--json"], { cwd: installDirectory });
  assert.deepEqual(JSON.parse(status.stdout), []);
  assert.match(await readFile(join(installDirectory, ".hackon", "config.json"), "utf8"), /factory-droid/);
});
