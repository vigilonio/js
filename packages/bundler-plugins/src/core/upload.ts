import { createHash } from "node:crypto";

/*
 * The source map upload API: declare each debug ID's two artifacts, PUT
 * the ones the server does not already have to the presigned URLs it
 * returns, then ask it to verify and mark each debug ID usable.
 */
const UPLOADS_PATH = "/v1/source-maps/uploads";
const COMPLETE_PATH = "/v1/source-maps/uploads/complete";
const ARTIFACTS_PER_REQUEST = 100;
const DEBUG_IDS_PER_REQUEST = 50;
const PUT_CONCURRENCY = 4;
const ATTEMPTS = 3;
const MAX_RETRY_AFTER_MS = 30_000;
export const MAX_ARTIFACT_BYTES = 50 * 1024 * 1024;

export type ArtifactKind = "source_map" | "minified_source";

/** One emitted script and its source map, already carrying their debug ID. */
export interface DebugIdChunk {
  debugId: string;
  /** Paths relative to the build output directory. */
  codeFileName: string;
  mapFileName: string;
  code: Buffer;
  map: Buffer;
}

export interface UnusableDebugId {
  debugId: string;
  fileName: string;
  failedCheck: string;
  message: string;
}

export interface UploadReport {
  usable: string[];
  unusable: UnusableDebugId[];
}

export interface UploadOptions {
  apiUrl: string;
  token: string;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

interface Artifact {
  debugId: string;
  kind: ArtifactKind;
  fileName: string;
  body: Buffer;
  sha256: string;
}

type DeclaredArtifact =
  | { debugId: string; kind: ArtifactKind; status: "upload_required"; upload: PresignedUpload }
  | { debugId: string; kind: ArtifactKind; status: "already_uploaded" | "conflict" };

interface PresignedUpload {
  method: string;
  url: string;
  headers: Record<string, string>;
}

type CompletionResult =
  | { debugId: string; usable: true }
  | { debugId: string; usable: false; kind?: ArtifactKind; failedCheck: string; message: string };

/** A failure of the upload as a whole, as opposed to one unusable debug ID. */
export class UploadError extends Error {
  override name = "UploadError";
}

export async function uploadChunks(
  chunks: DebugIdChunk[],
  options: UploadOptions,
): Promise<UploadReport> {
  const request = createRequester(options);
  const unusable: UnusableDebugId[] = [];
  const byDebugId = new Map(chunks.map((chunk) => [chunk.debugId, chunk]));

  const artifacts: Artifact[] = [];
  for (const chunk of byDebugId.values()) {
    const tooLarge = [chunk.code, chunk.map].some((body) => body.length > MAX_ARTIFACT_BYTES);
    if (tooLarge) {
      unusable.push({
        debugId: chunk.debugId,
        fileName: chunk.codeFileName,
        failedCheck: "too_large",
        message: `larger than the ${MAX_ARTIFACT_BYTES / 1024 / 1024} MB artifact limit`,
      });
      continue;
    }
    artifacts.push(artifact(chunk, "minified_source"), artifact(chunk, "source_map"));
  }

  const conflicted = new Set<string>();
  const pending: Array<{ artifact: Artifact; upload: PresignedUpload }> = [];
  for (const batch of batches(artifacts, ARTIFACTS_PER_REQUEST)) {
    const { artifacts: declared } = await request<{ artifacts: DeclaredArtifact[] }>(UPLOADS_PATH, {
      artifacts: batch.map(({ debugId, kind, fileName, body, sha256 }) => ({
        debugId,
        kind,
        fileName,
        sizeBytes: body.length,
        sha256,
      })),
    });
    declared.forEach((entry, index) => {
      const sent = batch[index];
      if (entry.status === "upload_required") {
        pending.push({ artifact: sent, upload: entry.upload });
      } else if (entry.status === "conflict" && !conflicted.has(sent.debugId)) {
        conflicted.add(sent.debugId);
        unusable.push({
          debugId: sent.debugId,
          fileName: sent.fileName,
          failedCheck: "conflict",
          message: "a different artifact is already stored for this debug ID",
        });
      }
    });
  }

  await forEachConcurrently(pending, PUT_CONCURRENCY, ({ artifact, upload }) =>
    put(artifact, upload, options),
  );

  const toComplete = [...new Set(artifacts.map(({ debugId }) => debugId))].filter(
    (debugId) => !conflicted.has(debugId),
  );
  const usable: string[] = [];
  for (const batch of batches(toComplete, DEBUG_IDS_PER_REQUEST)) {
    const { results } = await request<{ results: CompletionResult[] }>(COMPLETE_PATH, {
      debugIds: batch,
    });
    for (const result of results) {
      if (result.usable) {
        usable.push(result.debugId);
      } else {
        const chunk = byDebugId.get(result.debugId);
        unusable.push({
          debugId: result.debugId,
          fileName:
            (result.kind === "source_map" ? chunk?.mapFileName : chunk?.codeFileName) ??
            result.debugId,
          failedCheck: result.failedCheck,
          message: result.message,
        });
      }
    }
  }
  return { usable, unusable };
}

function artifact(chunk: DebugIdChunk, kind: ArtifactKind): Artifact {
  const body = kind === "source_map" ? chunk.map : chunk.code;
  return {
    debugId: chunk.debugId,
    kind,
    fileName: kind === "source_map" ? chunk.mapFileName : chunk.codeFileName,
    body,
    sha256: createHash("sha256").update(body).digest("hex"),
  };
}

function createRequester(options: UploadOptions) {
  const base = options.apiUrl.replace(/\/+$/, "");
  return async function request<T>(path: string, body: unknown): Promise<T> {
    const response = await withRetries(options, `POST ${path}`, () =>
      (options.fetch ?? fetch)(`${base}${path}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${options.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      }),
    );
    return (await response.json()) as T;
  };
}

async function put(artifact: Artifact, upload: PresignedUpload, options: UploadOptions): Promise<void> {
  // Exactly the headers the URL was signed for, nothing added.
  await withRetries(options, `upload of ${artifact.fileName}`, () =>
    (options.fetch ?? fetch)(upload.url, {
      method: upload.method,
      headers: upload.headers,
      body: new Uint8Array(artifact.body),
    }),
  );
}

/** Retries network errors, 429, and 5xx; any other failure is final. */
async function withRetries(
  options: UploadOptions,
  label: string,
  send: () => Promise<Response>,
): Promise<Response> {
  const sleep = options.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  for (let attempt = 1; ; attempt += 1) {
    let response: Response;
    try {
      response = await send();
    } catch (failure) {
      if (attempt === ATTEMPTS) {
        throw new UploadError(`${label} failed: ${String(failure)}`);
      }
      await sleep(1000 * attempt);
      continue;
    }
    if (response.ok) {
      return response;
    }
    const retryable = response.status === 429 || response.status >= 500;
    if (!retryable || attempt === ATTEMPTS) {
      const detail = (await response.text().catch(() => "")).slice(0, 500);
      throw new UploadError(
        `${label} failed with HTTP ${response.status}${detail ? `: ${detail}` : ""}${
          response.status === 401 ? " (check the source map upload token)" : ""
        }`,
      );
    }
    const retryAfter = Number(response.headers.get("Retry-After"));
    await sleep(
      Number.isFinite(retryAfter) && retryAfter > 0
        ? Math.min(retryAfter * 1000, MAX_RETRY_AFTER_MS)
        : 1000 * attempt,
    );
  }
}

function batches<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
}

async function forEachConcurrently<T>(
  items: T[],
  concurrency: number,
  run: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next];
      next += 1;
      await run(item);
    }
  });
  await Promise.all(workers);
}
