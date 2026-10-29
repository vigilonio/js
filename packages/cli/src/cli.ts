import { readFile, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { DebugIdBuild, type Logger } from "../../bundler-plugins/src/core/build";
import { injectDebugId } from "../../bundler-plugins/src/core/inject";
import { findScripts } from "./files";

declare const __VIGILON_CLI_VERSION__: string;

const USAGE = `Usage: vigilon <command> [options]

Commands:
  sourcemaps inject <dir...>   Give every script in the build output and its
                               source map a debug ID, in place.
  sourcemaps upload <dir...>   Upload every script that has a debug ID, and its
                               source map, to Vigilon.

Upload options:
  --token <token>              Source map upload token (default:
                               VIGILON_SOURCE_MAP_TOKEN).
  --api-url <url>              Vigilon API (default: VIGILON_API_URL, then
                               https://api.vigilon.io).
  --delete-after-upload        Delete the source maps once they are uploaded.
  --warn-only                  Exit 0 when the upload fails or a script cannot
                               be used, after printing a warning.

Options:
  -h, --help                   Show this help.
  -v, --version                Show the version.
`;

export interface Io {
  out: (line: string) => void;
  err: (line: string) => void;
}

const consoleIo: Io = {
  out: (line) => console.log(line),
  err: (line) => console.error(line),
};

/** Runs the CLI and resolves to its exit code: 0 success, 1 failure, 2 usage. */
export async function run(argv: string[], io: Io = consoleIo): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        token: { type: "string" },
        "api-url": { type: "string" },
        "delete-after-upload": { type: "boolean" },
        "warn-only": { type: "boolean" },
        help: { type: "boolean", short: "h" },
        version: { type: "boolean", short: "v" },
      },
    });
  } catch (failure) {
    io.err(`vigilon: ${(failure as Error).message}\n\n${USAGE}`);
    return 2;
  }
  const { values, positionals } = parsed;
  if (values.version) {
    io.out(__VIGILON_CLI_VERSION__);
    return 0;
  }
  const [group, command, ...dirs] = positionals;
  if (values.help || group === undefined) {
    io.out(USAGE);
    return values.help ? 0 : 2;
  }
  if (group !== "sourcemaps" || (command !== "inject" && command !== "upload") || dirs.length === 0) {
    io.err(`vigilon: unknown command "${positionals.join(" ")}"\n\n${USAGE}`);
    return 2;
  }
  try {
    if (command === "inject") {
      await inject(dirs, io);
      return 0;
    }
    const token = values.token ?? process.env.VIGILON_SOURCE_MAP_TOKEN;
    if (!token) {
      io.err("vigilon: no upload token; pass --token or set VIGILON_SOURCE_MAP_TOKEN");
      return 2;
    }
    await upload(dirs, io, {
      uploadToken: token,
      apiUrl: values["api-url"],
      deleteSourceMapsAfterUpload: values["delete-after-upload"] ?? false,
      onUploadError: values["warn-only"] ? "warn" : "error",
    });
    return 0;
  } catch (failure) {
    io.err(`vigilon: ${(failure as Error).message.replace(/^\[vigilon\] /, "")}`);
    return 1;
  }
}

async function inject(dirs: string[], io: Io): Promise<void> {
  for (const dir of dirs) {
    const { scripts, withoutMap } = await findScripts(dir);
    let injected = 0;
    let reused = 0;
    for (const script of scripts) {
      const result = injectDebugId(
        await readFile(script.codePath, "utf8"),
        await readFile(script.mapPath, "utf8"),
      );
      await writeFile(script.codePath, result.code);
      await writeFile(script.mapPath, result.map);
      if (result.reused) {
        reused += 1;
      } else {
        injected += 1;
      }
    }
    io.out(
      `${dir}: ${injected} script(s) got a new debug ID, ${reused} kept their existing one` +
        (withoutMap.length > 0 ? `, ${withoutMap.length} skipped (no source map)` : ""),
    );
  }
}

async function upload(
  dirs: string[],
  io: Io,
  options: ConstructorParameters<typeof DebugIdBuild>[0],
): Promise<void> {
  const logger: Logger = { info: (message) => io.out(message), warn: (message) => io.err(message) };
  for (const dir of dirs) {
    const build = new DebugIdBuild(options, logger);
    const { scripts } = await findScripts(dir);
    let recorded = 0;
    for (const script of scripts) {
      const hasDebugId = build.record(
        script.codeFileName,
        await readFile(script.codePath),
        script.mapFileName,
        await readFile(script.mapPath),
      );
      recorded += hasDebugId ? 1 : 0;
    }
    if (recorded < scripts.length) {
      io.err(
        `${dir}: ${scripts.length - recorded} script(s) have no debug ID; run \`vigilon sourcemaps inject\` first`,
      );
    }
    if (recorded === 0) {
      const problem = `${dir}: no scripts with a debug ID and a source map to upload`;
      if (options.onUploadError === "warn") {
        io.err(problem);
        continue;
      }
      throw new Error(problem);
    }
    await build.finish(dir, false);
  }
}
