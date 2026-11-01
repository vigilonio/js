import { existsSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { withVigilon } from "../index";

const { execFile } = vi.hoisted(() => ({
  execFile: vi.fn((_file: string, _args: string[], _options: unknown, callback: (...result: unknown[]) => void) =>
    callback(null, { stdout: "", stderr: "" }),
  ),
}));
vi.mock("node:child_process", () => ({ execFile }));

const originalToken = process.env.VIGILON_SOURCE_MAP_TOKEN;
let distDir: string;
let maps: string[];

beforeEach(async () => {
  execFile.mockClear();
  delete process.env.VIGILON_SOURCE_MAP_TOKEN;
  // A build output with an app chunk's map and a map Next.js ships for one of
  // its own files.
  distDir = await mkdtemp(join(tmpdir(), "vigilon-next-"));
  await mkdir(join(distDir, "static", "chunks"), { recursive: true });
  maps = [join(distDir, "static", "chunks", "app.js.map"), join(distDir, "static", "chunks", "polyfill.js.map")];
  await Promise.all(maps.map((map) => writeFile(map, "{}")));
});

afterEach(async () => {
  if (originalToken === undefined) delete process.env.VIGILON_SOURCE_MAP_TOKEN;
  else process.env.VIGILON_SOURCE_MAP_TOKEN = originalToken;
  await rm(distDir, { recursive: true, force: true });
});

describe("withVigilon", () => {
  it("keeps the SDK external on the server and turns on the traceparent meta tag", () => {
    const config = withVigilon({
      reactStrictMode: true,
      serverExternalPackages: ["pg"],
      experimental: { clientTraceMetadata: ["baggage"], ppr: true },
    });
    expect(config.reactStrictMode).toBe(true);
    expect(config.serverExternalPackages).toEqual(["pg", "@vigilon/nextjs", "@vigilon/node"]);
    expect(config.experimental).toEqual({ ppr: true, clientTraceMetadata: ["baggage", "traceparent"] });
  });

  it("leaves source maps and the build alone without an upload token", () => {
    const config = withVigilon({});
    expect(config.productionBrowserSourceMaps).toBeUndefined();
    expect(config.compiler).toBeUndefined();
  });

  it("with a token, builds browser source maps and runs the CLI after the app's own post-compile hook", async () => {
    process.env.VIGILON_SOURCE_MAP_TOKEN = "vg_sm_test";
    const order: string[] = [];
    const previous = vi.fn(async () => {
      order.push("app hook");
    });
    execFile.mockImplementation((_file, args, _options, callback) => {
      order.push(args.slice(1, 3).join(" "));
      callback(null, { stdout: "", stderr: "" });
    });
    const config = withVigilon(
      { compiler: { runAfterProductionCompile: previous, removeConsole: true } },
      { apiUrl: "https://api.example.test", onUploadError: "warn" },
    );
    expect(config.productionBrowserSourceMaps).toBe(true);
    expect(config.compiler?.removeConsole).toBe(true);

    await config.compiler?.runAfterProductionCompile?.({ projectDir: "/app", distDir });

    expect(order).toEqual(["app hook", "sourcemaps inject", "sourcemaps upload"]);
    const [, uploadArgs, uploadOptions] = execFile.mock.calls[1] ?? [];
    expect(uploadArgs?.slice(1)).toEqual([
      "sourcemaps",
      "upload",
      join(distDir, "static"),
      "--delete-after-upload",
      "--warn-only",
    ]);
    expect((uploadOptions as { env: Record<string, string> }).env).toMatchObject({
      VIGILON_SOURCE_MAP_TOKEN: "vg_sm_test",
      VIGILON_API_URL: "https://api.example.test",
    });
    // Every map is gone, including one the CLI could not pair with a script.
    expect(maps.filter((map) => existsSync(map))).toEqual([]);
  });

  it("ignore-lists sources that are not the app's files before the CLI injects debug IDs", async () => {
    const map = join(distDir, "static", "chunks", "framework.js.map");
    await writeFile(
      map,
      JSON.stringify({ version: 3, sources: ["webpack://_N_E/../../src/client/router.ts"], mappings: "" }),
    );
    let atInject: unknown;
    execFile.mockImplementation((_file, args, _options, callback) => {
      if (args[2] === "inject") atInject = JSON.parse(readFileSync(map, "utf8")).ignoreList;
      callback(null, { stdout: "", stderr: "" });
    });
    const config = withVigilon({}, { uploadToken: "vg_sm_test" });

    await config.compiler?.runAfterProductionCompile?.({ projectDir: "/app", distDir });

    expect(atInject).toEqual([0]);
  });

  it("fails the build when the CLI fails, after printing its output, and still deletes every map", async () => {
    execFile.mockImplementation((_file, _args, _options, callback) =>
      callback(Object.assign(new Error("exit 1"), { stdout: "", stderr: "upload rejected\n" })),
    );
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const config = withVigilon({}, { uploadToken: "vg_sm_test" });

    await expect(
      config.compiler?.runAfterProductionCompile?.({ projectDir: "/app", distDir }),
    ).rejects.toThrow(`Vigilon source map upload failed: vigilon sourcemaps inject ${join(distDir, "static")}`);
    expect(stderr).toHaveBeenCalledWith("upload rejected\n");
    expect(maps.filter((map) => existsSync(map))).toEqual([]);
    stderr.mockRestore();
  });
});
