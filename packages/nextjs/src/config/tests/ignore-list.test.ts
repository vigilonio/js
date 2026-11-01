import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ignoreSourcesNotOnDisk, webpackSourcePath } from "../ignore-list";

let root: string;
let projectDir: string;
let staticDir: string;

// A monorepo: the Next.js app in apps/web, a shared package beside it.
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "vigilon-ignore-"));
  projectDir = join(root, "apps", "web");
  staticDir = join(projectDir, ".next", "static");
  await mkdir(join(projectDir, "app"), { recursive: true });
  await mkdir(join(projectDir, "node_modules", "next", "dist"), { recursive: true });
  await mkdir(join(root, "packages", "ui", "src"), { recursive: true });
  await mkdir(join(staticDir, "chunks"), { recursive: true });
  await writeFile(join(projectDir, "app", "page.tsx"), "");
  await writeFile(join(projectDir, "node_modules", "next", "dist", "require.js"), "");
  await writeFile(join(root, "packages", "ui", "src", "button.tsx"), "");
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function writeMap(name: string, map: object): Promise<string> {
  const path = join(staticDir, "chunks", name);
  await writeFile(path, JSON.stringify(map));
  return path;
}

async function readMap(path: string) {
  return JSON.parse(await readFile(path, "utf8"));
}

describe("ignoreSourcesNotOnDisk", () => {
  it("ignore-lists webpack sources that are not files on disk, and keeps the application's", async () => {
    const path = await writeMap("app.js.map", {
      version: 3,
      sources: [
        "webpack://_N_E/./app/page.tsx",
        "webpack://_N_E/../../src/client/add-base-path.ts",
        "webpack://_N_E/../../packages/ui/src/button.tsx",
        "webpack://_N_E/./node_modules/next/dist/require.js?7046",
        "webpack://_N_E/webpack/bootstrap",
        "webpack://_N_E/",
      ],
      x_google_ignoreList: [4],
      mappings: "",
    });

    await ignoreSourcesNotOnDisk(staticDir, projectDir);

    // Next's client code (1) and the bare namespace (5) are added; the
    // existing entry (4) is kept; the app page (0), the monorepo package (2),
    // and the node_modules file behind its query (3) stay.
    expect((await readMap(path)).ignoreList).toEqual([1, 4, 5]);
  });

  it("leaves Turbopack sources and maps with nothing to add untouched", async () => {
    const turbopack = {
      version: 3,
      sources: ["turbopack:///[project]/apps/web/app/page.tsx", "turbopack:///[turbopack]/runtime.ts"],
      ignoreList: [1],
      mappings: "",
    };
    const path = await writeMap("turbo.js.map", turbopack);
    const before = await readFile(path, "utf8");

    await ignoreSourcesNotOnDisk(staticDir, projectDir);

    expect(await readFile(path, "utf8")).toBe(before);
  });

  it("handles index maps section by section", async () => {
    const path = await writeMap("index.js.map", {
      version: 3,
      sections: [
        {
          offset: { line: 0, column: 0 },
          map: { version: 3, sources: ["webpack://_N_E/../../src/shared/lib/x.ts"], mappings: "" },
        },
        {
          offset: { line: 10, column: 0 },
          map: { version: 3, sources: ["webpack://_N_E/./app/page.tsx"], mappings: "" },
        },
      ],
    });

    await ignoreSourcesNotOnDisk(staticDir, projectDir);

    const map = await readMap(path);
    expect(map.sections[0].map.ignoreList).toEqual([0]);
    expect(map.sections[1].map.ignoreList).toBeUndefined();
  });

  it("skips a file that is not JSON", async () => {
    const path = join(staticDir, "chunks", "broken.js.map");
    await writeFile(path, "not json");
    await ignoreSourcesNotOnDisk(staticDir, projectDir);
    expect(await readFile(path, "utf8")).toBe("not json");
  });
});

describe("webpackSourcePath", () => {
  it("resolves a webpack source against the project and drops its query", () => {
    expect(webpackSourcePath("webpack://_N_E/./app/page.tsx?v=1", "/repo/apps/web")).toBe(
      "/repo/apps/web/app/page.tsx",
    );
    expect(webpackSourcePath("webpack://_N_E/../../src/client/x.ts", "/repo/apps/web")).toBe(
      "/repo/src/client/x.ts",
    );
  });

  it("returns null for anything that is not a webpack source", () => {
    expect(webpackSourcePath("turbopack:///[project]/app/page.tsx", "/repo")).toBeNull();
    expect(webpackSourcePath("../src/main.tsx", "/repo")).toBeNull();
  });
});
