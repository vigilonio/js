import { SpanKind } from "@opentelemetry/api";
import { ReadableSpan, Span } from "@opentelemetry/sdk-trace-node";

/**
 * A service-entry span: the one SERVER span that marks a request entering
 * this service — its parent is either absent or remote. Matches the
 * definition the collector counts for endpoint metrics.
 */
export function isEntrySpan(span: Span | ReadableSpan): boolean {
  if (span.kind !== SpanKind.SERVER) return false;
  const parent = (span as ReadableSpan).parentSpanContext;
  return !parent || parent.isRemote === true;
}
