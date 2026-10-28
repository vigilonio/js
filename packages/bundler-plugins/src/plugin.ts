import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { createUnplugin } from "unplugin";
import { consoleLogger, DebugIdBuild, type VigilonPluginOptions } from "./core/build";

const NAME = "vigilon";

// The part of a Rollup or Rolldown output bundle the plugin touches.
type OutputBundle = Record<
  string,
  | { type: "chunk"; code: string; sourcemapFileName?: string | null }
  | { type: "asset"; fileName: string; source: string | Uint8Array }
>;

/*
 * Every adapter does the same three things through DebugIdBuild: turn on
 * hidden source maps when the build has none, inject each emitted script and
 * its map once the bundler has finished changing them, and upload once the
 * files are on disk. Maps the plugin turned on are deleted afterwards, decided
 * per output, so one output's choice never deletes another's maps.
 */
export const unplugin = createUnplugin<VigilonPluginOptions | undefined, false>(
  (rawOptions = {}) => {
    const options = rawOptions;
    const build = new DebugIdBuild(options);
    if (options.disabled) {
      return { name: NAME };
    }

    // Rollup outputs whose source maps the plugin turned on, by outputKey.
    const ownedOutputs = new Set<string>();
    let viteOwnsSourceMaps = false;
    let ssr = false;

    // Hashed file names are computed before generateBundle, where the plugin
    // injects. A minifier can leave two builds' code identical while their
    // maps differ (a comment-only edit), and the debug ID covers the map, so
    // the file name must cover what the map is made from: each module's
    // source as loaded, keyed by its path relative to the working directory
    // so names do not depend on where the project is checked out.
    const sourceHashes = new Map<string, string>();
    const hashSources = {
      transform: {
        order: "pre" as const,
        handler(code: string, id: string) {
          sourceHashes.set(id, createHash("sha256").update(code).digest("hex"));
          return null;
        },
      },
      augmentChunkHash(chunk: { moduleIds: readonly string[] }) {
        const hash = createHash("sha256");
        for (const id of [...chunk.moduleIds].sort()) {
          hash.update(relative(process.cwd(), id)).update("\0");
          hash.update(sourceHashes.get(id) ?? "").update("\0");
        }
        return hash.digest("hex");
      },
    };

    const rollupHooks = {
      ...hashSources,
      generateBundle: {
        order: "post" as const,
        handler(_outputOptions: unknown, bundle: OutputBundle) {
          injectRollupBundle(build, bundle);
        },
      },
      async writeBundle(
        outputOptions: { dir?: string; file?: string; format?: string },
        bundle: OutputBundle,
        ownsSourceMaps: boolean,
      ) {
        const outputDir = resolve(outputOptions.dir ?? dirname(outputOptions.file ?? "."));
        recordRollupBundle(build, bundle);
        await build.finish(outputDir, ownsSourceMaps);
      },
    };

    return {
      name: NAME,
      enforce: "post",

      rollup: {
        ...rollupHooks,
        outputOptions(outputOptions) {
          if (outputOptions.sourcemap) {
            return null;
          }
          ownedOutputs.add(outputKey(outputOptions));
          return { ...outputOptions, sourcemap: "hidden" };
        },
        async writeBundle(outputOptions, bundle) {
          await rollupHooks.writeBundle(
            outputOptions,
            bundle as unknown as OutputBundle,
            ownedOutputs.has(outputKey(outputOptions)),
          );
        },
      },

      vite: {
        apply: "build",
        config(config) {
          if (config.build?.ssr || config.build?.sourcemap) {
            if (config.build?.sourcemap === "inline") {
              consoleLogger.warn("inline source maps cannot be uploaded; use \"hidden\" or true");
            }
            return;
          }
          viteOwnsSourceMaps = true;
          return { build: { sourcemap: "hidden" } };
        },
        configResolved(config) {
          // A server bundle never runs in the browser.
          ssr = Boolean(config.build.ssr);
        },
        transform: hashSources.transform,
        augmentChunkHash(chunk) {
          return ssr ? undefined : hashSources.augmentChunkHash(chunk);
        },
        generateBundle: {
          order: "post",
          handler(_outputOptions, bundle) {
            if (!ssr) {
              injectRollupBundle(build, bundle as unknown as OutputBundle);
            }
          },
        },
        async writeBundle(outputOptions, bundle) {
          if (!ssr) {
            await rollupHooks.writeBundle(
              outputOptions,
              bundle as unknown as OutputBundle,
              viteOwnsSourceMaps,
            );
          }
        },
      },

      webpack(compiler) {
        if (compiler.options.mode === "development") {
          return;
        }
        const { devtool } = compiler.options;
        let ownsSourceMaps = false;
        if (devtool === undefined || devtool === false) {
          compiler.options.devtool = "hidden-source-map";
          ownsSourceMaps = true;
        } else if (typeof devtool === "string" && /eval|inline/.test(devtool)) {
          consoleLogger.warn(`devtool "${devtool}" emits no source map files to upload`);
        }
        const { Compilation, sources } = compiler.webpack;
        compiler.hooks.thisCompilation.tap(NAME, (compilation) => {
          // After source maps are generated (DEV_TOOLING) and before content
          // hashes are finalised (OPTIMIZE_HASH), so file names and
          // integrity hashes cover the injected code.
          compilation.hooks.processAssets.tap(
            { name: NAME, stage: Compilation.PROCESS_ASSETS_STAGE_DEV_TOOLING + 1 },
            () => {
              for (const { name, mapName } of webpackScripts(compilation)) {
                const code = compilation.getAsset(name)?.source.source().toString();
                const map = compilation.getAsset(mapName)?.source.source().toString();
                const injected =
                  code !== undefined && map !== undefined ? build.inject(name, code, map) : null;
                if (injected) {
                  compilation.updateAsset(name, new sources.RawSource(injected.code));
                  compilation.updateAsset(mapName, new sources.RawSource(injected.map));
                }
              }
            },
          );
          // Recorded under their final, content-hashed names; webpack drops
          // asset contents once they are emitted.
          compilation.hooks.processAssets.tap(
            { name: NAME, stage: Compilation.PROCESS_ASSETS_STAGE_REPORT },
            () => {
              for (const { name, mapName } of webpackScripts(compilation)) {
                const code = compilation.getAsset(name)?.source.buffer();
                const map = compilation.getAsset(mapName)?.source.buffer();
                if (code && map) {
                  build.record(name, code, mapName, map);
                }
              }
            },
          );
        });
        compiler.hooks.afterEmit.tapPromise(NAME, async (compilation) => {
          await build.finish(compilation.outputOptions.path ?? compiler.outputPath, ownsSourceMaps);
        });
      },

      esbuild: {
        setup(esbuild) {
          const initial = esbuild.initialOptions;
          let ownsSourceMaps = false;
          if (!initial.sourcemap) {
            // External maps carry no sourceMappingURL comment: hidden.
            initial.sourcemap = "external";
            ownsSourceMaps = true;
          } else if (initial.sourcemap === "inline") {
            consoleLogger.warn("inline source maps cannot be uploaded; use \"external\" or true");
          }
          initial.metafile = true;
          esbuild.onEnd(async (result) => {
            if (result.errors.length > 0 || !result.metafile) {
              return;
            }
            if (initial.write === false) {
              consoleLogger.warn("write: false builds are not supported; no debug IDs injected");
              return;
            }
            const workingDir = initial.absWorkingDir ?? process.cwd();
            const outputDir = resolve(
              workingDir,
              initial.outdir ?? dirname(initial.outfile ?? "."),
            );
            const outputs = Object.keys(result.metafile.outputs);
            for (const output of outputs) {
              if (!DebugIdBuild.isScript(output) || !outputs.includes(`${output}.map`)) {
                continue;
              }
              const codePath = resolve(workingDir, output);
              const mapPath = `${codePath}.map`;
              const name = relative(outputDir, codePath);
              const injected = build.inject(
                name,
                await readFile(codePath, "utf8"),
                await readFile(mapPath, "utf8"),
              );
              if (injected) {
                await writeFile(codePath, injected.code);
                await writeFile(mapPath, injected.map);
                build.record(name, Buffer.from(injected.code), `${name}.map`, Buffer.from(injected.map));
              }
            }
            await build.finish(outputDir, ownsSourceMaps);
          });
        },
      },
    };
  },
);

/** Tells a Rollup build's outputs apart, before and after Rollup normalises them. */
function outputKey(outputOptions: { dir?: string; file?: string; format?: string }): string {
  return JSON.stringify([outputOptions.dir ?? null, outputOptions.file ?? null, outputOptions.format ?? "es"]);
}

function injectRollupBundle(build: DebugIdBuild, bundle: OutputBundle): void {
  for (const [fileName, output, mapAsset] of rollupScripts(bundle)) {
    const injected = build.inject(fileName, output.code, String(mapAsset.source));
    if (injected) {
      output.code = injected.code;
      mapAsset.source = injected.map;
    }
  }
}

function recordRollupBundle(build: DebugIdBuild, bundle: OutputBundle): void {
  for (const [fileName, output, mapAsset] of rollupScripts(bundle)) {
    build.record(
      fileName,
      Buffer.from(output.code),
      mapAsset.fileName,
      Buffer.from(String(mapAsset.source)),
    );
  }
}

function* rollupScripts(bundle: OutputBundle) {
  for (const [fileName, output] of Object.entries(bundle)) {
    if (output.type !== "chunk" || !DebugIdBuild.isScript(fileName)) {
      continue;
    }
    const mapAsset = bundle[output.sourcemapFileName ?? `${fileName}.map`];
    if (mapAsset?.type === "asset") {
      yield [fileName, output, mapAsset] as const;
    }
  }
}

interface WebpackAssets {
  getAssets(): ReadonlyArray<{ name: string; info: { related?: Record<string, unknown> } }>;
}

function webpackScripts(compilation: WebpackAssets): Array<{ name: string; mapName: string }> {
  const scripts: Array<{ name: string; mapName: string }> = [];
  for (const { name, info } of compilation.getAssets()) {
    const related = info.related?.sourceMap;
    const mapName = Array.isArray(related) ? related[0] : related;
    if (DebugIdBuild.isScript(name) && typeof mapName === "string") {
      scripts.push({ name, mapName });
    }
  }
  return scripts;
}
