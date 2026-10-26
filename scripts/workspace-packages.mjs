// Prints the directory of every publishable workspace package, one per line,
// dependencies before dependents, so publish.sh never publishes a package
// before a workspace package it depends on. Private packages are skipped.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const packages = readdirSync(join(root, "packages"))
  .map((name) => join("packages", name))
  .filter((dir) => existsSync(join(root, dir, "package.json")))
  .map((dir) => ({ dir, manifest: JSON.parse(readFileSync(join(root, dir, "package.json"), "utf8")) }))
  .filter(({ manifest }) => !manifest.private);
const byName = new Map(packages.map((pkg) => [pkg.manifest.name, pkg]));

const ordered = [];
const state = new Map();
function visit(pkg) {
  if (state.get(pkg) === "done") return;
  if (state.get(pkg) === "visiting") {
    throw new Error(`workspace dependency cycle at ${pkg.manifest.name}`);
  }
  state.set(pkg, "visiting");
  const { dependencies = {}, peerDependencies = {}, optionalDependencies = {} } = pkg.manifest;
  for (const name of Object.keys({ ...dependencies, ...peerDependencies, ...optionalDependencies })) {
    const dependency = byName.get(name);
    if (dependency) visit(dependency);
  }
  state.set(pkg, "done");
  ordered.push(pkg.dir);
}
packages
  .sort((a, b) => a.dir.localeCompare(b.dir))
  .forEach(visit);
console.log(ordered.join("\n"));
