import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { uploadChunks, UploadError, type DebugIdChunk } from "../upload";

const API = "https://api.example.com";

function chunk(index: number): DebugIdChunk {
  const debugId = `c4a1e7d2-5b3f-4e8a-9c6d-${String(index).padStart(12, "0")}`;
  return {
    debugId,
    codeFileName: `assets/chunk-${index}.js`,
    mapFileName: `assets/chunk-${index}.js.map`,
    code: Buffer.from(`console.log(${index});\n//# debugId=${debugId}\n`),
    map: Buffer.from(JSON.stringify({ version: 3, mappings: "AAAA", debugId })),
  };
}

interface Declared {
  debugId: string;
  kind: string;
  fileName: string;
  sizeBytes: number;
  sha256: string;
}

/** A stand-in for the source map upload API and the presigned PUTs. */
function mockApi(
  respond: {
    status?: (artifact: Declared) => "upload_required" | "already_uploaded" | "conflict";
    complete?: (debugId: string) => Record<string, unknown>;
    failFirst?: { path: string; status: number; retryAfter?: string };
  } = {},
) {
  const calls: Array<{ method: string; url: string; headers: Record<string, string>; body: unknown }> = [];
  let failed = false;
  const fetch: typeof globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    const headers = Object.fromEntries(new Headers(init.headers).entries());
    const body = url.startsWith(API) ? JSON.parse(String(init.body)) : init.body;
    calls.push({ method: init.method ?? "GET", url, headers, body });
    if (respond.failFirst && !failed && url.endsWith(respond.failFirst.path)) {
      failed = true;
      return new Response("busy", {
        status: respond.failFirst.status,
        headers: respond.failFirst.retryAfter ? { "Retry-After": respond.failFirst.retryAfter } : {},
      });
    }
    if (url === `${API}/v1/source-maps/uploads`) {
      const artifacts = (body as { artifacts: Declared[] }).artifacts.map((artifact) => {
        const status = respond.status?.(artifact) ?? "upload_required";
        return status === "upload_required"
          ? {
              debugId: artifact.debugId,
              kind: artifact.kind,
              status,
              upload: {
                method: "PUT",
                url: `https://s3.example.com/${artifact.debugId}/${artifact.kind}?signed`,
                headers: {
                  "Content-Type": artifact.kind === "source_map" ? "application/json" : "application/javascript",
                  "Content-Length": String(artifact.sizeBytes),
                  "x-amz-checksum-sha256": Buffer.from(artifact.sha256, "hex").toString("base64"),
                },
                expiresAt: "2026-10-27T15:15:00.000Z",
              },
            }
          : { debugId: artifact.debugId, kind: artifact.kind, status };
      });
      return Response.json({ artifacts });
    }
    if (url === `${API}/v1/source-maps/uploads/complete`) {
      const results = (body as { debugIds: string[] }).debugIds.map(
        (debugId) => respond.complete?.(debugId) ?? { debugId, usable: true },
      );
      return Response.json({ results });
    }
    return new Response(null, { status: 200 });
  };
  return { fetch, calls };
}

const noSleep = async () => undefined;

describe("uploadChunks", () => {
  it("declares both artifacts, PUTs them with exactly the signed headers, then completes", async () => {
    const api = mockApi();
    const report = await uploadChunks([chunk(1)], { apiUrl: `${API}/`, token: "vg_sm_test", fetch: api.fetch });

    expect(report).toEqual({ usable: [chunk(1).debugId], unusable: [] });
    const [declare, ...rest] = api.calls;
    expect(declare.headers.authorization).toBe("Bearer vg_sm_test");
    expect(declare.body).toEqual({
      artifacts: [
        {
          debugId: chunk(1).debugId,
          kind: "minified_source",
          fileName: "assets/chunk-1.js",
          sizeBytes: chunk(1).code.length,
          sha256: createHash("sha256").update(chunk(1).code).digest("hex"),
        },
        {
          debugId: chunk(1).debugId,
          kind: "source_map",
          fileName: "assets/chunk-1.js.map",
          sizeBytes: chunk(1).map.length,
          sha256: createHash("sha256").update(chunk(1).map).digest("hex"),
        },
      ],
    });
    const puts = rest.filter((call) => call.method === "PUT");
    expect(puts).toHaveLength(2);
    expect(Object.keys(puts[0].headers).sort()).toEqual(
      ["content-length", "content-type", "x-amz-checksum-sha256"],
    );
    expect(rest.at(-1)).toMatchObject({
      url: `${API}/v1/source-maps/uploads/complete`,
      body: { debugIds: [chunk(1).debugId] },
    });
  });

  it("skips artifacts the server already has", async () => {
    const api = mockApi({ status: () => "already_uploaded" });
    const report = await uploadChunks([chunk(1)], { apiUrl: API, token: "t", fetch: api.fetch });
    expect(report.usable).toEqual([chunk(1).debugId]);
    expect(api.calls.filter((call) => call.method === "PUT")).toHaveLength(0);
  });

  it("batches 100 artifacts per declaration and 50 debug IDs per completion", async () => {
    const api = mockApi();
    const chunks = Array.from({ length: 120 }, (_, index) => chunk(index));
    const report = await uploadChunks(chunks, { apiUrl: API, token: "t", fetch: api.fetch });

    expect(report.usable).toHaveLength(120);
    const declared = api.calls.filter((call) => call.url.endsWith("/uploads"));
    expect(declared.map((call) => (call.body as { artifacts: unknown[] }).artifacts.length)).toEqual([
      100, 100, 40,
    ]);
    const completed = api.calls.filter((call) => call.url.endsWith("/complete"));
    expect(completed.map((call) => (call.body as { debugIds: unknown[] }).debugIds.length)).toEqual([
      50, 50, 20,
    ]);
  });

  it("reports a conflict and an unusable debug ID without completing the conflict", async () => {
    const api = mockApi({
      status: (artifact) => (artifact.debugId === chunk(1).debugId ? "conflict" : "upload_required"),
      complete: (debugId) => ({
        debugId,
        usable: false,
        kind: "source_map",
        failedCheck: "debug_id_mismatch",
        message: "The source map's debugId does not match.",
      }),
    });
    const report = await uploadChunks([chunk(1), chunk(2)], { apiUrl: API, token: "t", fetch: api.fetch });

    expect(report.usable).toEqual([]);
    expect(report.unusable).toEqual([
      {
        debugId: chunk(1).debugId,
        fileName: "assets/chunk-1.js",
        failedCheck: "conflict",
        message: "a different artifact is already stored for this debug ID",
      },
      {
        debugId: chunk(2).debugId,
        fileName: "assets/chunk-2.js.map",
        failedCheck: "debug_id_mismatch",
        message: "The source map's debugId does not match.",
      },
    ]);
    const completed = api.calls.find((call) => call.url.endsWith("/complete"));
    expect(completed?.body).toEqual({ debugIds: [chunk(2).debugId] });
  });

  it("reports an artifact over 50 MB without sending it", async () => {
    const api = mockApi();
    const big = { ...chunk(1), map: Buffer.alloc(50 * 1024 * 1024 + 1) };
    const report = await uploadChunks([big], { apiUrl: API, token: "t", fetch: api.fetch });
    expect(report.unusable).toMatchObject([{ debugId: big.debugId, failedCheck: "too_large" }]);
    expect(api.calls).toHaveLength(0);
  });

  it("retries a 429 after Retry-After and a 503, but not a 401", async () => {
    const slept: number[] = [];
    const sleep = async (ms: number) => void slept.push(ms);

    const limited = mockApi({ failFirst: { path: "/uploads", status: 429, retryAfter: "2" } });
    await uploadChunks([chunk(1)], { apiUrl: API, token: "t", fetch: limited.fetch, sleep });
    expect(slept).toEqual([2000]);

    const unavailable = mockApi({ failFirst: { path: "/complete", status: 503 } });
    const report = await uploadChunks([chunk(1)], { apiUrl: API, token: "t", fetch: unavailable.fetch, sleep: noSleep });
    expect(report.usable).toHaveLength(1);

    const unauthorized = mockApi({ failFirst: { path: "/uploads", status: 401 } });
    await expect(
      uploadChunks([chunk(1)], { apiUrl: API, token: "t", fetch: unauthorized.fetch, sleep: noSleep }),
    ).rejects.toThrow(new UploadError("POST /v1/source-maps/uploads failed with HTTP 401: busy (check the source map upload token)"));
  });

  it("gives up after three attempts", async () => {
    const failing: typeof fetch = async () => new Response("down", { status: 502 });
    await expect(
      uploadChunks([chunk(1)], { apiUrl: API, token: "t", fetch: failing, sleep: noSleep }),
    ).rejects.toThrow(/HTTP 502: down/);
  });
});
