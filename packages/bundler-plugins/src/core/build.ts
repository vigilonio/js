import { rm } from "node:fs/promises";
import { join } from "node:path";
import { existingDebugId } from "./debug-id";
import { injectDebugId, type InjectedChunk } from "./inject";
import { uploadChunks, UploadError, type DebugIdChunk } from "./upload";

export interface VigilonPluginOptions {
  /**
   * A source map upload token (`vg_sm_…`) for the project, from its settings
   * in the Vigilon dashboard. Defaults to the `VIGILON_SOURCE_MAP_TOKEN`
   * environment variable. Without one, debug IDs are still injected and
   * nothing is uploaded.
   */
  uploadToken?: string;
  /** The Vigilon API. Defaults to `VIGILON_API_URL`, then https://api.vigilon.io. */
  apiUrl?: string;
  /**
   * Delete the `.map` files once they are uploaded, so they are never
   * deployed. Source maps the plugin turned on itself are always deleted.
   */
  deleteSourceMapsAfterUpload?: boolean;
  /**
   * What a failed upload, or a debug ID Vigilon reports as unusable, does to
   * the build: `"error"` (the default) fails it, `"warn"` logs a warning.
   */
  onUploadError?: "error" | "warn";
  /** Turns the plugin off entirely. */
  disabled?: boolean;
  /** Logs what the plugin does. */
  debug?: boolean;
}

export interface Logger {
  info(message: string): void;
  warn(message: string): void;
}

const DEFAULT_API_URL = "https://api.vigilon.io";
const JS_FILE = /\.[cm]?js$/;

export const consoleLogger: Logger = {
  info: (message) => console.info(`[vigilon] ${message}`),
  warn: (message) => console.warn(`[vigilon] ${message}`),
};

/**
 * One build output's debug ID work, shared by every bundler adapter: inject
 * into each emitted script and its map, then upload and clean up once the
 * files are written.
 */
export class DebugIdBuild {
  private readonly chunks = new Map<string, DebugIdChunk>();
  // Every map file recorded, by debug ID: identical copies of a script share
  // an ID and are uploaded once, but each copy's map is deleted.
  private readonly mapFiles = new Map<string, Set<string>>();

  constructor(
    readonly options: VigilonPluginOptions,
    private readonly logger: Logger = consoleLogger,
  ) {}

  /** Whether an emitted file is a script the plugin handles. */
  static isScript(fileName: string): boolean {
    return JS_FILE.test(fileName);
  }

  /**
   * Gives one emitted script and its map their debug ID. Returns null, with
   * a warning, when the map cannot be used.
   */
  inject(fileName: string, code: string, map: string): InjectedChunk | null {
    try {
      const injected = injectDebugId(code, map);
      this.debug(`${fileName}: debug ID ${injected.debugId}${injected.reused ? " (reused)" : ""}`);
      return injected;
    } catch (failure) {
      this.logger.warn(`${fileName}: no debug ID, its source map cannot be used: ${String(failure)}`);
      return null;
    }
  }

  /**
   * Records a written script and map for upload, under their final names.
   * The debug ID is read back from the script, so an adapter can record after
   * the bundler has renamed files. Returns false when the script has none.
   */
  record(codeFileName: string, code: Buffer, mapFileName: string, map: Buffer): boolean {
    const parsed = safeParse(map);
    const existing = existingDebugId(code.toString("utf8"), parsed ?? {});
    if (existing === null) {
      return false;
    }
    this.chunks.set(existing.debugId, {
      debugId: existing.debugId,
      codeFileName,
      mapFileName,
      code,
      map,
    });
    const mapFiles = this.mapFiles.get(existing.debugId) ?? new Set<string>();
    this.mapFiles.set(existing.debugId, mapFiles.add(mapFileName));
    return true;
  }

  /**
   * Uploads what was recorded, then deletes the maps that should not be
   * deployed. `ownsSourceMaps` says the adapter turned this output's maps on,
   * so they are deleted even when the upload fails.
   */
  async finish(outputDir: string, ownsSourceMaps: boolean): Promise<void> {
    const chunks = [...this.chunks.values()];
    const mapFiles = [...this.mapFiles.values()].flatMap((files) => [...files]);
    this.chunks.clear();
    this.mapFiles.clear();
    if (chunks.length === 0) {
      return;
    }
    let uploaded = false;
    try {
      const token = this.options.uploadToken ?? process.env.VIGILON_SOURCE_MAP_TOKEN;
      if (!token) {
        this.logger.info(
          `${chunks.length} script(s) got debug IDs; source maps not uploaded (no upload token)`,
        );
      } else {
        uploaded = await this.uploadAll(chunks, token);
      }
    } finally {
      // The build's own maps are kept after a failed upload, so a retry can
      // still send them.
      if (ownsSourceMaps || (uploaded && this.options.deleteSourceMapsAfterUpload)) {
        await Promise.all(mapFiles.map((file) => rm(join(outputDir, file), { force: true })));
        this.debug(`deleted ${mapFiles.length} source map(s)`);
      }
    }
  }

  private async uploadAll(chunks: DebugIdChunk[], token: string): Promise<boolean> {
    const apiUrl = this.options.apiUrl ?? process.env.VIGILON_API_URL ?? DEFAULT_API_URL;
    let problem: string;
    try {
      const report = await uploadChunks(chunks, { apiUrl, token });
      this.logger.info(`uploaded source maps for ${report.usable.length} script(s)`);
      if (report.unusable.length === 0) {
        return true;
      }
      problem = [
        `${report.unusable.length} script(s) cannot be symbolicated:`,
        ...report.unusable.map(
          ({ fileName, debugId, failedCheck, message }) =>
            `  ${fileName} (${debugId}): ${failedCheck}: ${message}`,
        ),
      ].join("\n");
    } catch (failure) {
      if (!(failure instanceof UploadError)) {
        throw failure;
      }
      problem = `source map upload failed: ${failure.message}`;
    }
    if ((this.options.onUploadError ?? "error") === "error") {
      throw new Error(`[vigilon] ${problem}`);
    }
    this.logger.warn(problem);
    return false;
  }

  private debug(message: string): void {
    if (this.options.debug) {
      this.logger.info(message);
    }
  }
}

function safeParse(map: Buffer): Record<string, unknown> | null {
  try {
    return JSON.parse(map.toString("utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}
