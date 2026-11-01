import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";

interface SourceMapSection {
  map: SourceMapLike;
}

interface SourceMapLike {
  sources?: (string | null)[];
  ignoreList?: number[];
  x_google_ignoreList?: number[];
  sections?: SourceMapSection[];
}

/**
 * Adds to each map's `ignoreList` every webpack source that is not a file on
 * disk under the project, so Vigilon reads it as library code. Next.js's
 * webpack build gives Next's own precompiled client code sources such as
 * `webpack://_N_E/../../src/client/add-base-path.ts`, which no path rule can
 * tell from the application's, and leaves them off the list. The
 * application's own sources, including a monorepo package outside the
 * project, are files on disk while it builds.
 *
 * Turbopack sources are left alone: Turbopack lists its framework and runtime
 * sources itself, and its `[project]` root may be a monorepo root rather than
 * the project directory.
 */
export async function ignoreSourcesNotOnDisk(staticDir: string, projectDir: string): Promise<void> {
  const files = (await readdir(staticDir, { recursive: true })).filter((file) => file.endsWith(".map"));
  await Promise.all(
    files.map(async (file) => {
      const path = join(staticDir, file);
      let map: SourceMapLike;
      try {
        map = JSON.parse(await readFile(path, "utf8")) as SourceMapLike;
      } catch {
        return;
      }
      const maps = map.sections ? map.sections.map((section) => section.map) : [map];
      let changed = false;
      for (const part of maps) {
        changed = (await ignoreInMap(part, projectDir)) || changed;
      }
      if (changed) {
        await writeFile(path, JSON.stringify(map));
      }
    }),
  );
}

async function ignoreInMap(map: SourceMapLike, projectDir: string): Promise<boolean> {
  const sources = map.sources ?? [];
  const ignored = new Set([...(map.ignoreList ?? []), ...(map.x_google_ignoreList ?? [])]);
  const added: number[] = [];
  await Promise.all(
    sources.map(async (source, index) => {
      if (ignored.has(index) || typeof source !== "string") return;
      const path = webpackSourcePath(source, projectDir);
      if (path !== null && !(await isFile(path))) added.push(index);
    }),
  );
  if (added.length === 0) return false;
  // Readers take ignoreList over x_google_ignoreList, so the old entries are
  // merged into it rather than left beside it.
  map.ignoreList = [...ignored, ...added].sort((a, b) => a - b);
  return true;
}

/**
 * The file a `webpack://<namespace>/<path>` source names, relative to the
 * project (webpack's context), without a query or fragment; null for any
 * other source.
 */
export function webpackSourcePath(source: string, projectDir: string): string | null {
  const match = /^webpack:\/\/[^/]*\/(.*)$/.exec(source);
  if (!match) return null;
  const path = (match[1] ?? "").replace(/[?#].*$/, "");
  return isAbsolute(path) ? path : resolve(projectDir, path);
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}
