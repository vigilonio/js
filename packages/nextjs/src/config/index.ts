import { execFile } from "node:child_process";
import { readdir, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { ignoreSourcesNotOnDisk } from "./ignore-list";

export interface VigilonNextConfigOptions {
  /**
   * A source map upload token for the project. Falls back to
   * VIGILON_SOURCE_MAP_TOKEN. Without one, source maps are neither built nor
   * uploaded. Never use a project API key here: API keys are public.
   */
  uploadToken?: string;
  /** The Vigilon API. Falls back to VIGILON_API_URL, then https://api.vigilon.io. */
  apiUrl?: string;
  /** What a failed upload does to the build. Defaults to "error". */
  onUploadError?: "error" | "warn";
}

/** The parts of a Next.js config this wrapper reads and sets. */
export interface NextConfigLike {
  serverExternalPackages?: string[];
  productionBrowserSourceMaps?: boolean;
  experimental?: { clientTraceMetadata?: string[]; [key: string]: unknown };
  compiler?: {
    runAfterProductionCompile?: (metadata: { projectDir: string; distDir: string }) => Promise<void>;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

const SERVER_PACKAGES = ["@vigilon/nextjs", "@vigilon/node"];

/**
 * Wraps a Next.js config for Vigilon:
 *
 * - keeps the SDK and its require-hook based OpenTelemetry dependencies out
 *   of the server bundle;
 * - has Next.js render the request's `traceparent` in a meta tag, so browser
 *   errors on a server-rendered page link to its server trace;
 * - with an upload token, builds browser source maps and, once Next.js has
 *   compiled (Next.js 15.4 or later, with Turbopack or webpack), marks
 *   sources that are not the application's own files as library code, gives
 *   every script a debug ID, uploads the scripts and their maps, and deletes
 *   every map so none is deployed.
 *
 * ```ts
 * export default withVigilon({ reactStrictMode: true });
 * ```
 */
export function withVigilon<T extends NextConfigLike>(
  config: T,
  options: VigilonNextConfigOptions = {},
): T & NextConfigLike {
  const uploadToken = options.uploadToken ?? process.env.VIGILON_SOURCE_MAP_TOKEN;
  const experimental = config.experimental ?? {};
  const wrapped: NextConfigLike = {
    ...config,
    serverExternalPackages: unique([...(config.serverExternalPackages ?? []), ...SERVER_PACKAGES]),
    experimental: {
      ...experimental,
      clientTraceMetadata: unique([...(experimental.clientTraceMetadata ?? []), "traceparent"]),
    },
  };
  if (uploadToken) {
    const previous = config.compiler?.runAfterProductionCompile;
    wrapped.productionBrowserSourceMaps = true;
    wrapped.compiler = {
      ...config.compiler,
      runAfterProductionCompile: async (metadata) => {
        await previous?.(metadata);
        const staticDir = join(metadata.distDir, "static");
        try {
          // Before inject, so each debug ID covers the final map.
          await ignoreSourcesNotOnDisk(staticDir, metadata.projectDir);
          await uploadSourceMaps(staticDir, uploadToken, options);
        } finally {
          // The maps were turned on only for the upload, so none may be
          // deployed: not after a failed upload, which keeps them for a
          // retry, and not the maps of Next.js's own files, which have no
          // sourceMappingURL to pair them with a script.
          await deleteSourceMaps(staticDir);
        }
      },
    };
  }
  return wrapped as T & NextConfigLike;
}

const run = promisify(execFile);

/** Runs @vigilon/cli's inject and upload over the browser build output. */
export async function uploadSourceMaps(
  staticDir: string,
  uploadToken: string,
  options: VigilonNextConfigOptions,
): Promise<void> {
  const cli = cliBinPath();
  const env = {
    ...process.env,
    VIGILON_SOURCE_MAP_TOKEN: uploadToken,
    ...(options.apiUrl ? { VIGILON_API_URL: options.apiUrl } : {}),
  };
  const warnOnly = options.onUploadError === "warn" ? ["--warn-only"] : [];
  for (const args of [
    ["sourcemaps", "inject", staticDir],
    ["sourcemaps", "upload", staticDir, "--delete-after-upload", ...warnOnly],
  ]) {
    try {
      const { stdout, stderr } = await run(process.execPath, [cli, ...args], { env });
      process.stdout.write(stdout);
      process.stderr.write(stderr);
    } catch (error) {
      // A failed run rejects with its output attached; show it, then fail the
      // build with it.
      const { stdout = "", stderr = "" } = error as { stdout?: string; stderr?: string };
      process.stdout.write(stdout);
      process.stderr.write(stderr);
      throw new Error(`Vigilon source map upload failed: vigilon ${args.join(" ")}`);
    }
  }
}

async function deleteSourceMaps(dir: string): Promise<void> {
  const files = await readdir(dir, { recursive: true });
  await Promise.all(
    files.filter((file) => file.endsWith(".map")).map((file) => rm(join(dir, file), { force: true })),
  );
}

function cliBinPath(): string {
  const require = createRequire(import.meta.url);
  const manifestPath = require.resolve("@vigilon/cli/package.json");
  const manifest = require(manifestPath) as { bin: { vigilon: string } };
  return join(dirname(manifestPath), manifest.bin.vigilon);
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
