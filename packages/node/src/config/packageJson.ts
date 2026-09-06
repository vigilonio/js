import fs from "node:fs";
import path from "node:path";

export type PackageInfo = {
  name?: string;
  version?: string;
  /** Absolute path of the package.json the values came from. */
  path: string;
};

/**
 * Directories to start the package.json search from, most specific first:
 * the directory of the entry script (so `node packages/api/dist/server.js`
 * run from a monorepo root finds packages/api/package.json rather than the
 * root one), then the working directory.
 */
export function defaultSearchDirs(
  argv: string[] = process.argv,
  cwd: string = process.cwd(),
): string[] {
  const dirs: string[] = [];
  const entry = argv[1];
  if (entry) {
    try {
      const resolved = path.resolve(cwd, entry);
      if (fs.statSync(resolved).isFile()) {
        dirs.push(path.dirname(resolved));
      }
    } catch {
      // Not a file path (for example `node -e`); fall through to cwd.
    }
  }
  dirs.push(cwd);
  return dirs;
}

/**
 * Walks up from each start directory and returns the first package.json that
 * declares a non-blank name or version. That file is treated as the project's
 * manifest as a unit: a package.json with only a version still wins, and its
 * missing name is never filled in from a parent package. Files declaring
 * neither (for example a `{"type": "module"}` stub in a build directory) are
 * walked past. Directories inside node_modules are skipped but walked past,
 * so an entry script such as node_modules/next/dist/bin/next resolves to the
 * application's own package.json rather than the tool's.
 */
export function findNearestPackageJson(
  startDirs: string[] = defaultSearchDirs(),
): PackageInfo | undefined {
  for (const startDir of startDirs) {
    let dir = path.resolve(startDir);
    for (;;) {
      if (!isInsideNodeModules(dir)) {
        const info = readPackageJson(path.join(dir, "package.json"));
        if (info && (info.name || info.version)) {
          return info;
        }
      }
      const parent = path.dirname(dir);
      if (parent === dir) {
        break;
      }
      dir = parent;
    }
  }
  return undefined;
}

function isInsideNodeModules(dir: string): boolean {
  return dir.split(path.sep).includes("node_modules");
}

function readPackageJson(file: string): PackageInfo | undefined {
  let raw: string;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch {
    return undefined;
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return {
      name: nonBlankString(parsed.name),
      version: nonBlankString(parsed.version),
      path: file,
    };
  } catch {
    // Malformed package.json: treat as absent and keep walking.
    return undefined;
  }
}

/** Returns the trimmed string, or undefined for non-strings and blank values. */
function nonBlankString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed || undefined;
}
