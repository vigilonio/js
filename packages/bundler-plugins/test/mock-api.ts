import { createHash } from "node:crypto";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";

/*
 * A local stand-in for the source map upload API and the object storage
 * behind its presigned URLs. The PUT endpoint rejects a body that does not
 * match the signed Content-Length, Content-Type, and checksum, and completion
 * runs the same checks the real API does before marking a debug ID usable.
 */
export const TOKEN = "vg_sm_test";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const CONTENT_TYPES = { source_map: "application/json", minified_source: "application/javascript" };

type Kind = keyof typeof CONTENT_TYPES;

interface Declared {
  debugId: string;
  kind: Kind;
  fileName: string;
  sizeBytes: number;
  sha256: string;
}

export interface MockApi {
  url: string;
  /** Stored objects by `<debugId>/<kind>`. */
  objects: Map<string, Buffer>;
  usable: Set<string>;
  /** Makes completion report this check as failed for every debug ID. */
  failCheck: string | null;
  close(): Promise<void>;
}

export async function startMockApi(): Promise<MockApi> {
  const declared = new Map<string, Declared>();
  const objects = new Map<string, Buffer>();
  const usable = new Set<string>();
  let server: Server;

  const api: MockApi = {
    url: "",
    objects,
    usable,
    failCheck: null,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };

  server = createServer(async (request, response) => {
    const body = await readBody(request);
    const send = (status: number, json?: unknown) => {
      response.writeHead(status, json === undefined ? {} : { "Content-Type": "application/json" });
      response.end(json === undefined ? undefined : JSON.stringify(json));
    };
    const url = request.url ?? "";

    if (request.method === "PUT" && url.startsWith("/s3/")) {
      const key = url.slice("/s3/".length);
      const expected = declared.get(key);
      const checksum = createHash("sha256").update(body).digest("base64");
      if (
        !expected ||
        request.headers["content-length"] !== String(expected.sizeBytes) ||
        request.headers["content-type"] !== CONTENT_TYPES[expected.kind] ||
        request.headers["x-amz-checksum-sha256"] !== checksum ||
        body.length !== expected.sizeBytes
      ) {
        return send(400, { error: "signature does not match" });
      }
      objects.set(key, body);
      return send(200);
    }

    if (request.method !== "POST" || request.headers.authorization !== `Bearer ${TOKEN}`) {
      return send(401, { message: "Unauthorized" });
    }
    const json = JSON.parse(body.toString("utf8"));

    if (url === "/v1/source-maps/uploads") {
      const artifacts = json.artifacts as Declared[];
      if (
        !Array.isArray(artifacts) ||
        artifacts.length > 100 ||
        artifacts.some(
          (artifact) =>
            !UUID.test(artifact.debugId) ||
            !(artifact.kind in CONTENT_TYPES) ||
            !/^[0-9a-f]{64}$/.test(artifact.sha256) ||
            artifact.sizeBytes < 1 ||
            artifact.fileName.length === 0,
        )
      ) {
        return send(400, { message: "invalid body" });
      }
      return send(200, {
        artifacts: artifacts.map((artifact) => {
          const key = `${artifact.debugId}/${artifact.kind}`;
          const stored = objects.get(key);
          const storedSha = stored && createHash("sha256").update(stored).digest("hex");
          if (stored && storedSha === artifact.sha256) {
            return { debugId: artifact.debugId, kind: artifact.kind, status: "already_uploaded" };
          }
          if (stored && usable.has(artifact.debugId)) {
            return { debugId: artifact.debugId, kind: artifact.kind, status: "conflict" };
          }
          declared.set(key, artifact);
          return {
            debugId: artifact.debugId,
            kind: artifact.kind,
            status: "upload_required",
            upload: {
              method: "PUT",
              url: `${api.url}/s3/${key}`,
              headers: {
                "Content-Type": CONTENT_TYPES[artifact.kind],
                "Content-Length": String(artifact.sizeBytes),
                "x-amz-checksum-sha256": Buffer.from(artifact.sha256, "hex").toString("base64"),
              },
              expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
            },
          };
        }),
      });
    }

    if (url === "/v1/source-maps/uploads/complete") {
      const debugIds = json.debugIds as string[];
      if (!Array.isArray(debugIds) || debugIds.length > 50) {
        return send(400, { message: "invalid body" });
      }
      return send(200, {
        results: debugIds.map((debugId) => {
          const failure = api.failCheck ?? verify(debugId);
          if (failure) {
            return { debugId, usable: false, kind: "source_map", failedCheck: failure, message: failure };
          }
          usable.add(debugId);
          return { debugId, usable: true };
        }),
      });
    }
    return send(404);
  });

  function verify(debugId: string): string | null {
    const map = objects.get(`${debugId}/source_map`);
    if (!map || !objects.has(`${debugId}/minified_source`)) {
      return "missing_object";
    }
    try {
      return JSON.parse(map.toString("utf8")).debugId === debugId ? null : "debug_id_mismatch";
    } catch {
      return "invalid_source_map";
    }
  }

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  api.url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return api;
}

async function readBody(request: IncomingMessage): Promise<Buffer> {
  const parts: Buffer[] = [];
  for await (const part of request) {
    parts.push(part as Buffer);
  }
  return Buffer.concat(parts);
}
