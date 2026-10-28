import { existsSync } from "node:fs";
import { cp, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { originalPositionFor, TraceMap } from "@jridgewell/trace-mapping";
import { build as esbuild, transform } from "esbuild";
import { rollup, type Plugin } from "rollup";
import { build as vite } from "vite";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import webpack from "webpack";
import type { VigilonPluginOptions } from "../src/core/build";
import { vigilonEsbuildPlugin, vigilonRollupPlugin, vigilonVitePlugin, vigilonWebpackPlugin } from "../src/index";
import { startMockApi, TOKEN, type MockApi } from "./mock-api";

const fixture = fileURLToPath(new URL("./fixtures/app/", import.meta.url));

// Every bundler hashes every file name, entries included, so the tests can
// hold each build to "same file name, same bytes".
type Bundler = (
  outDir: string,
  options: VigilonPluginOptions,
  userSourceMaps: boolean,
  root?: string,
) => Promise<void>;

export const bundlers: Record<string, Bundler> = {
  async vite(outDir, options, userSourceMaps, root = fixture) {
    await vite({
      root,
      logLevel: "silent",
      configFile: false,
      build: { outDir, emptyOutDir: true, ...(userSourceMaps ? { sourcemap: true } : {}) },
      plugins: [vigilonVitePlugin(options)],
    });
  },
  async rollup(outDir, options, userSourceMaps, root = fixture) {
    const bundle = await rollup({ input: join(root, "main.js"), plugins: [vigilonRollupPlugin(options)] });
    try {
      await bundle.write({
        dir: outDir,
        format: "es",
        entryFileNames: "[name]-[hash].js",
        ...(userSourceMaps ? { sourcemap: true } : {}),
      });
    } finally {
      await bundle.close();
    }
  },
  // A minifying plugin strips comments before Rollup hashes file names.
  async "rollup with a minifier"(outDir, options, userSourceMaps, root = fixture) {
    const minify: Plugin = {
      name: "minify",
      async renderChunk(code) {
        const result = await transform(code, { minify: true, format: "esm", sourcemap: "external" });
        return { code: result.code, map: result.map };
      },
    };
    const bundle = await rollup({
      input: join(root, "main.js"),
      plugins: [minify, vigilonRollupPlugin(options)],
    });
    try {
      await bundle.write({
        dir: outDir,
        format: "es",
        entryFileNames: "[name]-[hash].js",
        ...(userSourceMaps ? { sourcemap: true } : {}),
      });
    } finally {
      await bundle.close();
    }
  },
  async webpack(outDir, options, userSourceMaps, root = fixture) {
    const compiler = webpack({
      mode: "production",
      context: root,
      entry: join(root, "main.js"),
      output: { path: outDir, filename: "[name].[contenthash].js", clean: true },
      ...(userSourceMaps ? { devtool: "source-map" } : {}),
      plugins: [vigilonWebpackPlugin(options)],
    });
    await new Promise<void>((resolve, reject) =>
      compiler.run((error, stats) => {
        compiler.close(() => undefined);
        if (error) return reject(error);
        if (stats?.hasErrors()) return reject(new Error(stats.toString("errors-only")));
        resolve();
      }),
    );
  },
  async esbuild(outDir, options, userSourceMaps, root = fixture) {
    await esbuild({
      entryPoints: [join(root, "main.js")],
      entryNames: "[name]-[hash]",
      bundle: true,
      splitting: true,
      format: "esm",
      minify: true,
      outdir: outDir,
      logLevel: "silent",
      ...(userSourceMaps ? { sourcemap: true } : {}),
      plugins: [vigilonEsbuildPlugin(options)],
    });
  },
};

/** Each emitted script's contents by its path relative to the output. */
async function contents(outDir: string): Promise<Map<string, string>> {
  const files = await scripts(outDir);
  return new Map(
    await Promise.all(files.map(async (file) => [relative(outDir, file), await readFile(file, "utf8")] as const)),
  );
}

async function scripts(outDir: string): Promise<string[]> {
  const entries = await readdir(outDir, { recursive: true });
  return entries.filter((name) => /\.[cm]?js$/.test(name)).map((name) => join(outDir, name));
}

const REGISTRATION = /_vigilonDebugIds\[n\]="([0-9a-f-]{36})"/g;
const COMMENT = /\/\/# debugId=([0-9a-f-]{36})/g;

/**
 * Each emitted script has exactly one debug ID, registered and commented,
 * stored and usable, and its uploaded map still points the thrown error at
 * its original line.
 */
async function expectUploadedDebugIds(outDir: string, api: MockApi) {
  const files = await scripts(outDir);
  expect(files.length).toBeGreaterThanOrEqual(2);
  let foundThrow = false;
  for (const file of files) {
    const code = await readFile(file, "utf8");
    const registered = [...code.matchAll(REGISTRATION)].map((match) => match[1]);
    const commented = [...code.matchAll(COMMENT)].map((match) => match[1]);
    expect(registered, relative(outDir, file)).toHaveLength(1);
    expect(commented).toEqual(registered);
    const [debugId] = registered;

    expect(api.usable.has(debugId)).toBe(true);
    expect(api.objects.get(`${debugId}/minified_source`)?.toString("utf8")).toBe(code);
    const map = api.objects.get(`${debugId}/source_map`)?.toString("utf8") ?? "";
    expect(JSON.parse(map).debugId).toBe(debugId);

    const offset = code.indexOf("price-missing");
    if (offset !== -1) {
      foundThrow = true;
      const lines = code.slice(0, offset).split("\n");
      const position = originalPositionFor(new TraceMap(map), {
        line: lines.length,
        column: lines.at(-1)!.length,
      });
      expect(position.source).toMatch(/lib\.js$/);
      expect(position.line).toBe(3);
    }
  }
  expect(foundThrow).toBe(true);
}

let api: MockApi;
let outDir: string;
const options = (): VigilonPluginOptions => ({ uploadToken: TOKEN, apiUrl: api.url });

beforeAll(async () => {
  api = await startMockApi();
});
afterAll(() => api.close());
beforeEach(async () => {
  outDir = await mkdtemp(join(tmpdir(), "vigilon-bundler-"));
  api.failCheck = null;
  vi.spyOn(console, "info").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});
afterEach(async () => {
  vi.restoreAllMocks();
  await rm(outDir, { recursive: true, force: true });
});

describe.each(Object.entries(bundlers))("%s", (_name, bundle) => {
  it("injects and uploads with the build's own source maps, and keeps them", async () => {
    await bundle(outDir, options(), true);
    await expectUploadedDebugIds(outDir, api);
    for (const file of await scripts(outDir)) {
      expect(existsSync(`${file}.map`)).toBe(true);
    }
  });

  it("never emits different bytes under the same file name", async () => {
    // A comment-only edit leaves the minified code alone but changes the map,
    // and with it the debug ID, so it must change the file name too.
    const root = await mkdtemp(join(tmpdir(), "vigilon-fixture-"));
    const builds = [await mkdtemp(join(tmpdir(), "vigilon-a-")), await mkdtemp(join(tmpdir(), "vigilon-b-"))];
    const again = await mkdtemp(join(tmpdir(), "vigilon-a2-"));
    try {
      await cp(fixture, root, { recursive: true });
      await bundle(builds[0], options(), true, root);
      await bundle(again, options(), true, root);
      const lib = join(root, "lib.js");
      await writeFile(lib, `// Prices arrive in cents.\n${await readFile(lib, "utf8")}`);
      await bundle(builds[1], options(), true, root);

      const [first, repeated, edited] = await Promise.all([builds[0], again, builds[1]].map(contents));
      expect(repeated).toEqual(first);
      for (const [name, code] of edited) {
        if (first.has(name)) {
          expect(code, name).toBe(first.get(name));
        }
      }
      const changed = [...edited.keys()].filter((name) => !first.has(name));
      expect(changed.length).toBeGreaterThan(0);
    } finally {
      await Promise.all([root, again, ...builds].map((dir) => rm(dir, { recursive: true, force: true })));
    }
  });

  it("turns on hidden source maps when the build has none, and deletes them after upload", async () => {
    await bundle(outDir, options(), false);
    await expectUploadedDebugIds(outDir, api);
    for (const file of await scripts(outDir)) {
      expect(existsSync(`${file}.map`)).toBe(false);
      expect(await readFile(file, "utf8")).not.toContain("sourceMappingURL");
    }
  });
});

describe("upload settings", () => {
  it("injects without uploading when there is no token", async () => {
    const before = api.usable.size;
    await bundlers.vite(outDir, { apiUrl: api.url }, true);
    expect(api.usable.size).toBe(before);
    for (const file of await scripts(outDir)) {
      expect([...(await readFile(file, "utf8")).matchAll(REGISTRATION)]).toHaveLength(1);
    }
    expect(console.info).toHaveBeenCalledWith(expect.stringContaining("no upload token"));
  });

  it("deletes the build's own maps after upload when asked", async () => {
    await bundlers.rollup(outDir, { ...options(), deleteSourceMapsAfterUpload: true }, true);
    for (const file of await scripts(outDir)) {
      expect(existsSync(`${file}.map`)).toBe(false);
    }
  });

  it("fails the build when a debug ID is unusable, or warns when configured to", async () => {
    api.failCheck = "debug_id_mismatch";
    await expect(bundlers.vite(outDir, options(), true)).rejects.toThrow(/cannot be symbolicated/);

    await bundlers.vite(outDir, { ...options(), onUploadError: "warn" }, true);
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("debug_id_mismatch"));
  });

  it("fails the build on a rejected token, keeping the build's maps and deleting its own", async () => {
    await expect(
      bundlers.esbuild(outDir, { uploadToken: "vg_sm_wrong", apiUrl: api.url }, true),
    ).rejects.toThrow(/HTTP 401/);
    for (const file of await scripts(outDir)) {
      expect(existsSync(`${file}.map`)).toBe(true);
    }

    await rm(outDir, { recursive: true, force: true });
    await expect(
      bundlers.esbuild(outDir, { uploadToken: "vg_sm_wrong", apiUrl: api.url }, false),
    ).rejects.toThrow(/HTTP 401/);
    const files = await scripts(outDir);
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      expect(existsSync(`${file}.map`)).toBe(false);
    }
  });

  it("decides map deletion per Rollup output", async () => {
    const hidden = join(outDir, "hidden");
    const kept = join(outDir, "kept");
    const bundle = await rollup({ input: join(fixture, "main.js"), plugins: [vigilonRollupPlugin(options())] });
    try {
      await bundle.write({ dir: hidden, format: "es" });
      await bundle.write({ dir: kept, format: "es", sourcemap: true });
    } finally {
      await bundle.close();
    }
    for (const file of await scripts(hidden)) {
      expect(existsSync(`${file}.map`)).toBe(false);
    }
    const keptFiles = await scripts(kept);
    expect(keptFiles.length).toBeGreaterThan(0);
    for (const file of keptFiles) {
      expect(existsSync(`${file}.map`)).toBe(true);
    }
  });

  it("does nothing when disabled", async () => {
    await bundlers.vite(outDir, { ...options(), disabled: true }, true);
    for (const file of await scripts(outDir)) {
      expect(await readFile(file, "utf8")).not.toContain("debugId");
    }
  });
});
