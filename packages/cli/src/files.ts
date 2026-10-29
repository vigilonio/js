import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";

const SCRIPT = /\.[cm]?js$/;
const SOURCE_MAPPING_URL = /\/\/[#@] sourceMappingURL=(\S+)\s*$/;

export interface ScriptWithMap {
  /** Absolute paths. */
  codePath: string;
  mapPath: string;
  /** Paths relative to the directory that was searched. */
  codeFileName: string;
  mapFileName: string;
}

export interface FoundScripts {
  scripts: ScriptWithMap[];
  /** Scripts with no source map file, relative to the directory searched. */
  withoutMap: string[];
}

/**
 * Every script under `dir` and the source map file that belongs to it: the
 * one its `sourceMappingURL` comment names, or `<script>.map` next to it for
 * hidden source maps. `node_modules` is skipped.
 */
export async function findScripts(dir: string): Promise<FoundScripts> {
  const root = resolve(dir);
  const entries = await readdir(root, { recursive: true });
  const scripts: ScriptWithMap[] = [];
  const withoutMap: string[] = [];
  for (const entry of entries.sort()) {
    if (!SCRIPT.test(entry) || entry.split(/[\\/]/).includes("node_modules")) {
      continue;
    }
    const codePath = join(root, entry);
    const mapPath = await mapPathFor(codePath);
    if (mapPath === null) {
      withoutMap.push(entry);
      continue;
    }
    scripts.push({
      codePath,
      mapPath,
      codeFileName: relative(root, codePath),
      mapFileName: relative(root, mapPath),
    });
  }
  return { scripts, withoutMap };
}

async function mapPathFor(codePath: string): Promise<string | null> {
  // The comment, if any, is on the last lines; a data: URL is an inline map,
  // which cannot be uploaded.
  const tail = (await readFile(codePath, "utf8")).slice(-1000);
  const reference = tail
    .split("\n")
    .map((line) => SOURCE_MAPPING_URL.exec(line)?.[1])
    .filter((url): url is string => url !== undefined)
    .at(-1);
  if (reference !== undefined && !reference.startsWith("data:")) {
    const referenced = resolve(dirname(codePath), decodeURI(reference.split(/[?#]/)[0]));
    if (existsSync(referenced)) {
      return referenced;
    }
  }
  const sibling = `${codePath}.map`;
  return existsSync(sibling) ? sibling : null;
}
