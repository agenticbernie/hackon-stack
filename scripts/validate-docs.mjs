import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const root = new URL("../", import.meta.url).pathname;
const required = [
  "README.md", "LICENSE", "CONTRIBUTING.md", "SECURITY.md", "CHANGELOG.md",
  "docs/architecture.md", "docs/concepts.md", "docs/installation.md",
  "docs/getting-started.md", "docs/configuration.md", "docs/skills.md",
  "docs/workflows.md", "docs/adapters.md", "docs/evidence.md",
  "docs/quality-gates.md", "docs/context-engineering.md", "docs/compound-learning.md",
  "docs/security-model.md", "docs/testing.md", "docs/extending.md",
  "docs/troubleshooting.md", "docs/BUILD_STATUS.md",
  "docs/research/reference-analysis.md", "docs/research/capability-matrix.md",
];
for (const path of required) {
  const content = await readFile(join(root, path), "utf8");
  if (content.trim().length < 40) throw new Error(`Documentation is empty: ${path}`);
}
const skillRoot = join(root, "skills");
const domains = await readdir(skillRoot, { withFileTypes: true });
for (const domain of domains.filter((entry) => entry.isDirectory())) {
  const content = await readFile(join(skillRoot, domain.name, "SKILL.md"), "utf8");
  if (!/^---\nname: .+\ndescription: .+\n---/m.test(content)) throw new Error(`Invalid skill frontmatter: ${domain.name}`);
  if (content.split("\n").length < 10) throw new Error(`Skill lacks methodology: ${domain.name}`);
}
console.log(`Validated ${required.length} docs and ${domains.filter((entry) => entry.isDirectory()).length} skills`);
