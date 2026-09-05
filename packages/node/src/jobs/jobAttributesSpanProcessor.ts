import { Context } from "@opentelemetry/api";
import { SpanProcessor, Span } from "@opentelemetry/sdk-trace-node";
import {
  JOB_CONTEXT_KEY,
  JOB_NAME_ATTRIBUTE,
  JOB_SCHEDULE_ATTRIBUTE,
  JobContextValue,
} from "./withJobMonitor.js";

/**
 * Stamps job attributes onto every span started inside a `withJobMonitor` scope.
 *
 * The job's root span is only exported when the job ends, but child spans
 * export as they finish. Stamping the job identity on each child means any
 * span in the trace identifies its job, even while a long-running job is
 * still in progress.
 */
export class JobAttributesSpanProcessor implements SpanProcessor {
  onStart(span: Span, parentContext: Context): void {
    const job = parentContext.getValue(JOB_CONTEXT_KEY) as
      | JobContextValue
      | undefined;
    if (!job) return;

    span.setAttribute(JOB_NAME_ATTRIBUTE, job.name);
    if (job.schedule) {
      span.setAttribute(JOB_SCHEDULE_ATTRIBUTE, job.schedule);
    }
  }

  onEnd(): void {}

  forceFlush(): Promise<void> {
    return Promise.resolve();
  }

  shutdown(): Promise<void> {
    return Promise.resolve();
  }
}
