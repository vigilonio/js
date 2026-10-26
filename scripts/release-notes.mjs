// Prints the GitHub Release notes for a release tag, in Markdown:
//
//   node scripts/release-notes.mjs v0.2.9
//
// The notes list the commits since the previous release tag, grouped by their
// conventional-commit type (`feat(scope): subject`), skipping the release
// commit itself. PRs are squash-merged, so each entry is one PR, linked by the
// `(#N)` GitHub appends to the squash commit's subject. Each entry names the
// packages it changed, and the notes end with the packages published at that
// version.
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const GROUPS = [
  ["Features", ["feat"]],
  ["Fixes", ["fix"]],
  ["Performance", ["perf"]],
  ["Documentation", ["doc", "docs"]],
  ["Build and CI", ["build", "ci"]],
  ["Tests", ["test"]],
  ["Maintenance", ["refactor", "style", "chore", "revert"]],
];
const OTHER = "Other changes";
const RELEASE_COMMIT = /^chore\(release\): /;
const CONVENTIONAL = /^([a-z]+)(?:\(([^)]+)\))?(!)?: (.+)$/;
const PULL_REQUEST = /\s*\(#(\d+)\)$/;
// A merge titled with a skip marker released nothing; keep it out of the notes.
const SKIP_MARKER = /\s*\[(skip ci|ci skip|no ci|skip actions|actions skip)\]/gi;

/** Splits a commit subject into its type, breaking flag, text, and PR number. */
export function parseSubject(subject) {
  const cleaned = subject.replace(SKIP_MARKER, "");
  const pull = PULL_REQUEST.exec(cleaned);
  const withoutPull = pull ? cleaned.slice(0, pull.index) : cleaned;
  const match = CONVENTIONAL.exec(withoutPull);
  return {
    type: match ? match[1] : null,
    breaking: Boolean(match?.[3]),
    text: match ? match[4] : withoutPull,
    pull: pull ? Number(pull[1]) : null,
  };
}

export function groupFor(type) {
  return GROUPS.find(([, types]) => types.includes(type))?.[0] ?? OTHER;
}

/**
 * Renders the notes from plain data, so it can be tested without git.
 * commits: [{ sha, subject, packages: [name] }], newest first.
 */
export function renderNotes({ repo, tag, previousTag, commits, published }) {
  const lines = [];
  const entries = commits.filter((commit) => !RELEASE_COMMIT.test(commit.subject));
  if (entries.length === 0) {
    lines.push(
      previousTag
        ? `No changes since ${previousTag}: this release publishes the same code under a new version.`
        : "No changes.",
      "",
    );
  }
  const byGroup = new Map();
  for (const commit of entries) {
    const parsed = parseSubject(commit.subject);
    const group = groupFor(parsed.type);
    const link = parsed.pull
      ? `[#${parsed.pull}](https://github.com/${repo}/pull/${parsed.pull})`
      : `[${commit.sha.slice(0, 7)}](https://github.com/${repo}/commit/${commit.sha})`;
    const packages = commit.packages.length
      ? ` (${commit.packages.map((name) => `\`${name}\``).join(", ")})`
      : "";
    const breaking = parsed.breaking ? "**Breaking:** " : "";
    const entry = `- ${breaking}${parsed.text}${packages} (${link})`;
    byGroup.set(group, [...(byGroup.get(group) ?? []), entry]);
  }
  for (const group of [...GROUPS.map(([name]) => name), OTHER]) {
    const groupEntries = byGroup.get(group);
    if (groupEntries) {
      lines.push(`## ${group}`, "", ...groupEntries, "");
    }
  }
  const version = tag.replace(/^v/, "");
  lines.push(
    "## Packages",
    "",
    ...published.map(
      (name) => `- [\`${name}@${version}\`](https://www.npmjs.com/package/${name}/v/${version})`,
    ),
    "",
  );
  if (previousTag) {
    lines.push(
      `**Full changelog:** https://github.com/${repo}/compare/${previousTag}...${tag}`,
    );
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

function git(...args) {
  return execFileSync("git", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function previousReleaseTag(tag) {
  try {
    return git("describe", "--tags", "--abbrev=0", "--match", "v*", `${tag}^`);
  } catch {
    return null;
  }
}

/** Package directory to package name, as of the given revision. */
function packageNames(revision) {
  const names = new Map();
  const dirs = git("ls-tree", "-d", "--name-only", `${revision}:packages`).split("\n").filter(Boolean);
  for (const dir of dirs) {
    try {
      const manifest = JSON.parse(git("show", `${revision}:packages/${dir}/package.json`));
      names.set(dir, { name: manifest.name, private: Boolean(manifest.private) });
    } catch {
      // A directory without a manifest is not a package.
    }
  }
  return names;
}

function repoSlug() {
  if (process.env.GITHUB_REPOSITORY) {
    return process.env.GITHUB_REPOSITORY;
  }
  const url = git("remote", "get-url", "origin");
  return url.replace(/^.*github\.com[:/]/, "").replace(/\.git$/, "");
}

function main() {
  const tag = process.argv[2];
  if (!tag) {
    console.error("usage: node scripts/release-notes.mjs <tag>");
    process.exit(2);
  }
  const previousTag = previousReleaseTag(tag);
  const names = packageNames(tag);
  const range = previousTag ? `${previousTag}..${tag}` : tag;
  const log = git("log", "--no-merges", "--format=%H%x1f%s", range);
  const commits = log
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [sha, subject] = line.split("\x1f");
      const files = git("diff-tree", "--root", "--no-commit-id", "--name-only", "-r", sha).split("\n");
      const dirs = new Set(
        files.map((file) => /^packages\/([^/]+)\//.exec(file)?.[1]).filter(Boolean),
      );
      const packages = [...dirs]
        .map((dir) => names.get(dir)?.name)
        .filter(Boolean)
        .sort();
      return { sha, subject, packages };
    });
  const published = [...names.values()]
    .filter((pkg) => !pkg.private)
    .map((pkg) => pkg.name)
    .sort();
  process.stdout.write(renderNotes({ repo: repoSlug(), tag, previousTag, commits, published }));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main();
}
