import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { sentryVitePlugin } from "@sentry/vite-plugin";
import { build, type PluginOption } from "vite";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { vigilonVitePlugin } from "../src/vite";
import { startMockApi, TOKEN, type MockApi } from "./mock-api";

/*
 * A Vite build with Sentry's plugin as well as Vigilon's, configured like a
 * production app that already uses Sentry: hidden source maps, no Sentry
 * upload in this test. Whichever plugin comes first, every chunk ends up
 * with one debug ID that both tools share, and Vigilon can still use it.
 */
const fixture = fileURLToPath(new URL("./fixtures/app/", import.meta.url));

let api: MockApi;
beforeAll(async () => {
  api = await startMockApi();
});
afterAll(() => api.close());
beforeEach(() => {
  vi.spyOn(console, "info").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "log").mockImplementation(() => undefined);
});

function sentry(): PluginOption {
  return sentryVitePlugin({ telemetry: false, silent: true, release: { create: false } });
}

describe.each([
  ["Sentry first", (vigilon: PluginOption) => [sentry(), vigilon]],
  ["Vigilon first", (vigilon: PluginOption) => [vigilon, sentry()]],
])("with @sentry/vite-plugin, %s", (_order, plugins) => {
  it("leaves each chunk one shared, usable debug ID", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "vigilon-sentry-"));
    try {
      await build({
        root: fixture,
        logLevel: "silent",
        configFile: false,
        build: { outDir, emptyOutDir: true, sourcemap: "hidden" },
        plugins: plugins(vigilonVitePlugin({ uploadToken: TOKEN, apiUrl: api.url })),
      });

      const files = (await readdir(join(outDir, "assets"))).filter((name) => name.endsWith(".js"));
      expect(files.length).toBeGreaterThanOrEqual(2);
      for (const file of files) {
        const code = await readFile(join(outDir, "assets", file), "utf8");
        const sentryIds = [...code.matchAll(/_sentryDebugIds\[\w+\]=["'`]([0-9a-f-]{36})["'`]/g)].map((m) => m[1]);
        const comments = [...code.matchAll(/\/\/# debugId=([0-9a-f-]{36})/g)].map((m) => m[1]);
        const map = JSON.parse(await readFile(join(outDir, "assets", `${file}.map`), "utf8"));

        expect(sentryIds, file).toHaveLength(1);
        expect(code).not.toContain("_vigilonDebugIds");
        expect(comments).toEqual(sentryIds);
        expect(map.debugId).toBe(sentryIds[0]);
        expect(api.usable.has(sentryIds[0])).toBe(true);
      }
    } finally {
      await rm(outDir, { recursive: true, force: true });
    }
  });
});
