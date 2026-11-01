import { Context, trace } from "@opentelemetry/api";
import { getRPCMetadata, RPCType } from "@opentelemetry/core";
import {
  SpanProcessor,
  Span,
  ReadableSpan,
} from "@opentelemetry/sdk-trace-node";

export const NEXT_ROUTE_ATTRIBUTE = "next.route";
export const HTTP_ROUTE_ATTRIBUTE = "http.route";

const NEXT_SPAN_TYPE_ATTRIBUTE = "next.span_type";
const NEXT_ENTRY_SPAN_TYPE = "BaseServer.handleRequest";

/**
 * Propagates the route Next.js resolves to the two places the rest of the
 * pipeline reads it from, neither of which Next.js reliably fills itself:
 *
 * 1. The incoming request's RPC metadata — where the HTTP instrumentation
 *    reads `http.route` when labelling its server span. Express and Fastify
 *    instrumentations write the matched route there; Next.js never does.
 *
 * 2. Next's own `BaseServer.handleRequest` entry span. Next normally copies
 *    `next.route` onto it via a tracer-internal root-span-attribute store,
 *    but bundled runtimes (Vercel's serverless build) load private copies of
 *    Next's tracer per route chunk, so the route module writes to one store
 *    while the base server reads another and the entry span exports without
 *    a route. Endpoint metrics are collector-derived from entry spans, so
 *    every Vercel request was bucketed as "unknown".
 *
 * A span processor is used instead of patching Next's internals because the
 * global tracer provider is the one channel every bundled copy of Next's
 * tracer shares — proven by child spans parenting correctly even where the
 * attribute store is split.
 */
export class NextRouteSpanProcessor implements SpanProcessor {
  onStart(span: Span, parentContext: Context): void {
    const route = span.attributes[NEXT_ROUTE_ATTRIBUTE];
    if (typeof route !== "string" || route.length === 0) return;

    const rpcMetadata = getRPCMetadata(parentContext);
    if (rpcMetadata?.type === RPCType.HTTP) {
      rpcMetadata.route = route;
    }

    const parentSpan = trace.getSpan(parentContext);
    if (!parentSpan?.isRecording()) return;
    // Only SDK spans expose attributes; a NonRecordingSpan (remote or no-op
    // parent) has none and is skipped by the checks below.
    const parentAttributes = (parentSpan as unknown as ReadableSpan).attributes;
    if (
      parentAttributes?.[NEXT_SPAN_TYPE_ATTRIBUTE] === NEXT_ENTRY_SPAN_TYPE &&
      parentAttributes[HTTP_ROUTE_ATTRIBUTE] === undefined
    ) {
      parentSpan.setAttribute(HTTP_ROUTE_ATTRIBUTE, route);
      parentSpan.setAttribute(NEXT_ROUTE_ATTRIBUTE, route);
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
