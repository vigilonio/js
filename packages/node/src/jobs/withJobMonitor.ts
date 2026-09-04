import {
  context,
  createContextKey,
  trace,
  ROOT_CONTEXT,
  Span,
  SpanKind,
  SpanStatusCode,
} from "@opentelemetry/api";
import { toRecordedError } from "../errors/recordException.js";

/**
 * Public ingest contract. These names are deliberately vendor-neutral so that
 * telemetry emitted without this SDK — plain OpenTelemetry, another language —
 * still lands on the Vigilon jobs surface.
 */
export const JOB_NAME_ATTRIBUTE = "job.name";
export const JOB_SCHEDULE_ATTRIBUTE = "job.schedule";

export const JOB_CONTEXT_KEY = createContextKey("vigilon.job");

export type JobContextValue = { name: string; schedule?: string };

export type WithJobOptions = {
  /**
   * Stable, code-defined job identifier. Never interpolate per-item values
   * (`sync-user-42`); that fragments one job into unbounded identities.
   */
  name: string;
  /** Optional cron expression, enabling last-run and stale-job detection. */
  schedule?: string;
};

const TRACER_NAME = "@vigilon/node";

/**
 * Wrap one execution of a background job so it is reported as a Job Run.
 *
 * Each call starts a new root trace — never attached to ambient context — so
 * a job triggered inside some other traced flow still appears as its own run.
 * Sync and async functions are both supported; the return value or promise is
 * passed through and errors are recorded and rethrown.
 *
 * Safe to call before `register()`: the global API returns a no-op tracer, and
 * the wrapped function still runs.
 */
export function withJobMonitor<T>(options: WithJobOptions, fn: () => T): T {
  const tracer = trace.getTracer(TRACER_NAME);

  // root: true plus an explicit ROOT_CONTEXT parent: never inherits ambient context.
  const span = tracer.startSpan(
    `job ${options.name}`,
    {
      kind: SpanKind.INTERNAL,
      root: true,
      attributes: {
        [JOB_NAME_ATTRIBUTE]: options.name,
        ...(options.schedule
          ? { [JOB_SCHEDULE_ATTRIBUTE]: options.schedule }
          : {}),
      },
    },
    ROOT_CONTEXT,
  );

  const jobContext = trace.setSpan(ROOT_CONTEXT, span).setValue(JOB_CONTEXT_KEY, {
    name: options.name,
    schedule: options.schedule,
  } satisfies JobContextValue);

  let result: T;
  try {
    result = context.with(jobContext, fn);
  } catch (error) {
    failSpan(span, error);
    span.end();
    throw error;
  }

  if (isThenable(result)) {
    return result.then(
      (value: unknown) => {
        span.end();
        return value;
      },
      (error: unknown) => {
        failSpan(span, error);
        span.end();
        throw error;
      },
    ) as unknown as T;
  }

  span.end();
  return result;
}

function failSpan(span: Span, error: unknown): void {
  const recorded = toRecordedError(error);
  span.recordException(recorded);
  span.setStatus({ code: SpanStatusCode.ERROR, message: recorded.message });
}

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as PromiseLike<unknown>).then === "function"
  );
}
