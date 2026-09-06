import { ExportResultCode, type ExportResult } from "@opentelemetry/core";
import type { ReadableSpan, SpanExporter } from "@opentelemetry/sdk-trace-node";

const AUTH_FAILURE_STATUSES = new Set([401, 403]);

/**
 * Wraps a SpanExporter so the first failed export is reported on the console.
 *
 * The OTLP exporter only reports failures through OpenTelemetry's diag
 * logger, which is silent by default, so a wrong API key otherwise shows up
 * as an empty dashboard with no explanation. Each kind of failure (auth,
 * other) is reported once to keep a persistent outage from flooding logs.
 */
export class ExportFeedbackSpanExporter implements SpanExporter {
  private reportedAuthFailure = false;
  private reportedOtherFailure = false;

  constructor(
    private readonly inner: SpanExporter,
    private readonly log: (message: string) => void = (message) =>
      console.error(message),
  ) {}

  export(
    spans: ReadableSpan[],
    resultCallback: (result: ExportResult) => void,
  ): void {
    this.inner.export(spans, (result) => {
      if (result.code === ExportResultCode.FAILED) {
        this.report(result.error);
      }
      resultCallback(result);
    });
  }

  shutdown(): Promise<void> {
    return this.inner.shutdown();
  }

  forceFlush(): Promise<void> {
    return this.inner.forceFlush?.() ?? Promise.resolve();
  }

  private report(error: Error | undefined): void {
    const status = httpStatusOf(error);
    if (status !== undefined && AUTH_FAILURE_STATUSES.has(status)) {
      if (!this.reportedAuthFailure) {
        this.reportedAuthFailure = true;
        this.log(
          `Vigilon: the ingest endpoint rejected the API key (HTTP ${status}). Traces are not being delivered. Check VIGILON_API_KEY.`,
        );
      }
      return;
    }
    if (!this.reportedOtherFailure) {
      this.reportedOtherFailure = true;
      const detail = error?.message ? `: ${error.message}` : "";
      this.log(
        `Vigilon: exporting traces failed${detail}. Set VIGILON_DEBUG=1 for OpenTelemetry diagnostics.`,
      );
    }
  }
}

function httpStatusOf(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null) {
    return undefined;
  }
  const code = (error as { code?: unknown }).code;
  return typeof code === "number" ? code : undefined;
}
