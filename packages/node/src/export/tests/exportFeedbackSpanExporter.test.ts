import { ExportResultCode, type ExportResult } from "@opentelemetry/core";
import type { SpanExporter } from "@opentelemetry/sdk-trace-node";
import { describe, expect, it, vi } from "vitest";
import { ExportFeedbackSpanExporter } from "../exportFeedbackSpanExporter.js";

function fakeExporter(results: ExportResult[]) {
  const queue = [...results];
  const inner: SpanExporter = {
    export: vi.fn((_spans, cb) => cb(queue.shift() ?? { code: ExportResultCode.SUCCESS })),
    shutdown: vi.fn(async () => {}),
    forceFlush: vi.fn(async () => {}),
  };
  return inner;
}

function failure(status?: number, message = "boom"): ExportResult {
  const error = Object.assign(new Error(message), status === undefined ? {} : { code: status });
  return { code: ExportResultCode.FAILED, error };
}

describe("ExportFeedbackSpanExporter", () => {
  it("passes results through and delegates shutdown and forceFlush", async () => {
    const inner = fakeExporter([{ code: ExportResultCode.SUCCESS }]);
    const log = vi.fn();
    const exporter = new ExportFeedbackSpanExporter(inner, log);
    const cb = vi.fn();

    exporter.export([], cb);
    await exporter.forceFlush();
    await exporter.shutdown();

    expect(cb).toHaveBeenCalledWith({ code: ExportResultCode.SUCCESS });
    expect(inner.forceFlush).toHaveBeenCalledTimes(1);
    expect(inner.shutdown).toHaveBeenCalledTimes(1);
    expect(log).not.toHaveBeenCalled();
  });

  it("reports a rejected API key once, naming VIGILON_API_KEY", () => {
    const log = vi.fn();
    const exporter = new ExportFeedbackSpanExporter(
      fakeExporter([failure(401), failure(401), failure(403)]),
      log,
    );

    exporter.export([], () => {});
    exporter.export([], () => {});
    exporter.export([], () => {});

    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0][0]).toMatch(/HTTP 401/);
    expect(log.mock.calls[0][0]).toMatch(/VIGILON_API_KEY/);
  });

  it("reports other failures once with the error message and the debug hint", () => {
    const log = vi.fn();
    const exporter = new ExportFeedbackSpanExporter(
      fakeExporter([failure(undefined, "connect ECONNREFUSED"), failure(500, "Internal")]),
      log,
    );

    exporter.export([], () => {});
    exporter.export([], () => {});

    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0][0]).toContain("connect ECONNREFUSED");
    expect(log.mock.calls[0][0]).toContain("VIGILON_DEBUG=1");
  });

  it("logs to console.error by default", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    new ExportFeedbackSpanExporter(fakeExporter([failure(401)])).export([], () => {});

    expect(error).toHaveBeenCalledTimes(1);
    error.mockRestore();
  });
});
