import { existsSync } from "node:fs";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { originalPositionFor, TraceMap } from "@jridgewell/trace-mapping";
import { build } from "esbuild";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { startMockApi, TOKEN, type MockApi } from "../../../bundler-plugins/test/mock-api";
import { run, type Io } from "../cli";

const LIB = `export function formatPrice(price) {
  if (price === undefined) {
    throw new TypeError("price-missing");
  }
  return "$" + price.toFixed(2);
}
`;
const MAIN = `import { formatPrice } from "./lib.js";
document.title = formatPrice(globalThis.initialPrice);
`;

let api: MockApi;
let dir: string;
let output: { out: string[]; err: string[] };
let io: Io;

beforeAll(async () => {
  api = await startMockApi();
});
afterAll(() => api.close());
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "vigilon-cli-"));
  output = { out: [], err: [] };
  io = { out: (line) => output.out.push(line), err: (line) => output.err.push(line) };
  return () => rm(dir, { recursive: true, force: true });
});

/**
 * An esbuild build with no Vigilon plugin: `linked.js` references its map in a
 * comment, `hidden.js` has a map beside it and no comment, and `plain.js` has
 * no map at all.
 */
async function buildOutput() {
  await writeFile(join(dir, "lib.js"), LIB);
  await writeFile(join(dir, "main.js"), MAIN);
  for (const [name, sourcemap] of [
    ["linked", "linked"],
    ["hidden", "external"],
    ["plain", false],
  ] as const) {
    await build({
      entryPoints: [join(dir, "main.js")],
      bundle: true,
      minify: true,
      outfile: join(dir, "dist", `assets/${name}.js`),
      sourcemap,
      logLevel: "silent",
    });
  }
  return join(dir, "dist");
}

const debugIdOf = (code: string) => /\/\/# debugId=([0-9a-f-]{36})/.exec(code)?.[1];

describe("vigilon sourcemaps inject", () => {
  it("gives each script with a map one debug ID and keeps the map exact", async () => {
    const dist = await buildOutput();
    expect(await run(["sourcemaps", "inject", dist], io)).toBe(0);
    expect(output.out.at(-1)).toContain("2 script(s) got a new debug ID, 0 kept their existing one, 1 skipped (no source map)");

    for (const name of ["linked", "hidden"]) {
      const code = await readFile(join(dist, `assets/${name}.js`), "utf8");
      const map = await readFile(join(dist, `assets/${name}.js.map`), "utf8");
      const debugId = debugIdOf(code);
      expect(code).toContain(`_vigilonDebugIds[n]="${debugId}"`);
      expect(JSON.parse(map).debugId).toBe(debugId);

      const lines = code.slice(0, code.indexOf("price-missing")).split("\n");
      const position = originalPositionFor(new TraceMap(map), { line: lines.length, column: lines.at(-1)!.length });
      expect(position.source).toMatch(/lib\.js$/);
      expect(position.line).toBe(3);
    }
    const linked = await readFile(join(dist, "assets/linked.js"), "utf8");
    expect(linked.trimEnd().endsWith("//# sourceMappingURL=linked.js.map")).toBe(true);
    expect(await readFile(join(dist, "assets/plain.js"), "utf8")).not.toContain("debugId");
  });

  it("changes nothing on a second run", async () => {
    const dist = await buildOutput();
    await run(["sourcemaps", "inject", dist], io);
    const before = await readFile(join(dist, "assets/hidden.js"), "utf8");
    await run(["sourcemaps", "inject", dist], io);
    expect(await readFile(join(dist, "assets/hidden.js"), "utf8")).toBe(before);
    expect(output.out.at(-1)).toContain("0 script(s) got a new debug ID, 2 kept their existing one");
  });
});

describe("vigilon sourcemaps upload", () => {
  it("uploads every injected script and map, and can delete the maps", async () => {
    const dist = await buildOutput();
    await run(["sourcemaps", "inject", dist], io);
    const code = await readFile(join(dist, "assets/hidden.js"), "utf8");
    const exit = await run(
      ["sourcemaps", "upload", dist, "--token", TOKEN, "--api-url", api.url, "--delete-after-upload"],
      io,
    );

    expect(exit).toBe(0);
    expect(api.usable.has(debugIdOf(code)!)).toBe(true);
    expect(api.objects.get(`${debugIdOf(code)}/minified_source`)?.toString("utf8")).toBe(code);
    expect(existsSync(join(dist, "assets/hidden.js.map"))).toBe(false);
    expect(existsSync(join(dist, "assets/linked.js.map"))).toBe(false);
  });

  it("deletes the map of every identical copy of a script", async () => {
    const dist = await buildOutput();
    await run(["sourcemaps", "inject", dist], io);
    await mkdir(join(dist, "copy"));
    for (const file of ["hidden.js", "hidden.js.map"]) {
      await copyFile(join(dist, "assets", file), join(dist, "copy", file));
    }
    const exit = await run(
      ["sourcemaps", "upload", dist, "--token", TOKEN, "--api-url", api.url, "--delete-after-upload"],
      io,
    );

    expect(exit).toBe(0);
    expect(existsSync(join(dist, "assets/hidden.js.map"))).toBe(false);
    expect(existsSync(join(dist, "copy/hidden.js.map"))).toBe(false);
  });

  it("asks for inject first when no script has a debug ID", async () => {
    const dist = await buildOutput();
    expect(await run(["sourcemaps", "upload", dist, "--token", TOKEN, "--api-url", api.url], io)).toBe(1);
    expect(output.err.join("\n")).toMatch(/run `vigilon sourcemaps inject` first/);

    expect(await run(["sourcemaps", "upload", dist, "--token", TOKEN, "--api-url", api.url, "--warn-only"], io)).toBe(0);
    expect(output.err.at(-1)).toMatch(/no scripts with a debug ID/);
  });

  it("fails on a rejected token or an unusable script, unless --warn-only", async () => {
    const dist = await buildOutput();
    await run(["sourcemaps", "inject", dist], io);

    expect(await run(["sourcemaps", "upload", dist, "--token", "vg_sm_wrong", "--api-url", api.url], io)).toBe(1);
    expect(output.err.at(-1)).toMatch(/HTTP 401/);

    api.failCheck = "checksum_mismatch";
    try {
      expect(await run(["sourcemaps", "upload", dist, "--token", TOKEN, "--api-url", api.url], io)).toBe(1);
      expect(await run(["sourcemaps", "upload", dist, "--token", TOKEN, "--api-url", api.url, "--warn-only"], io)).toBe(0);
      expect(output.err.at(-1)).toMatch(/checksum_mismatch/);
    } finally {
      api.failCheck = null;
    }
    expect(existsSync(join(dist, "assets/hidden.js.map"))).toBe(true);
  });

  it("needs a token", async () => {
    const dist = await buildOutput();
    const saved = process.env.VIGILON_SOURCE_MAP_TOKEN;
    delete process.env.VIGILON_SOURCE_MAP_TOKEN;
    try {
      expect(await run(["sourcemaps", "upload", dist], io)).toBe(2);
      expect(output.err.at(-1)).toMatch(/no upload token/);
    } finally {
      if (saved !== undefined) process.env.VIGILON_SOURCE_MAP_TOKEN = saved;
    }
  });
});

describe("usage", () => {
  it.each([[[]], [["sourcemaps"]], [["sourcemaps", "inject"]], [["deploy", "x"]], [["--nope"]]])(
    "exits 2 for %j",
    async (argv) => {
      expect(await run(argv, io)).toBe(2);
    },
  );

  it("prints help and the version", async () => {
    expect(await run(["--help"], io)).toBe(0);
    expect(output.out[0]).toContain("sourcemaps upload");
    expect(await run(["--version"], io)).toBe(0);
    expect(output.out[1]).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
