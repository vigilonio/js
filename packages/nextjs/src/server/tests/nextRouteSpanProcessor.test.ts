import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { context, trace, ROOT_CONTEXT } from "@opentelemetry/api";
import {
  getRPCMetadata,
  setRPCMetadata,
  RPCType,
  type RPCMetadata,
} from "@opentelemetry/core";
import {
  InMemorySpanExporter,
  NodeTracerProvider,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-node";
import {
  HTTP_ROUTE_ATTRIBUTE,
  NEXT_ROUTE_ATTRIBUTE,
  NextRouteSpanProcessor,
} from "../nextRouteSpanProcessor";

let exporter: InMemorySpanExporter;
let provider: NodeTracerProvider;

beforeEach(() => {
  exporter = new InMemorySpanExporter();
  provider = new NodeTracerProvider({
    spanProcessors: [
      new NextRouteSpanProcessor(),
      new SimpleSpanProcessor(exporter),
    ],
  });
  provider.register();
});

afterEach(async () => {
  await provider.shutdown();
  trace.disable();
  context.disable();
});

// Mirrors what the HTTP instrumentation does for every incoming request: it
// stores mutable RPC metadata on the context and reads `route` back from it
// when the response finishes.
function withHttpRequestContext<T>(fn: (rpcMetadata: RPCMetadata) => T): T {
  const span = trace.getTracer("test").startSpan("GET");
  const rpcMetadata: RPCMetadata = { type: RPCType.HTTP, span };
  const requestContext = setRPCMetadata(
    trace.setSpan(context.active(), span),
    rpcMetadata,
  );
  try {
    return context.with(requestContext, () => fn(rpcMetadata));
  } finally {
    span.end();
  }
}

function startNextStyleSpan(attributes: Record<string, string>): void {
  const span = trace
    .getTracer("next.js", "0.0.1")
    .startSpan("executing api route (app) /api/hello", { attributes });
  span.end();
}

describe("NextRouteSpanProcessor", () => {
  it("copies next.route from a span started inside the request onto the RPC metadata", () => {
    withHttpRequestContext((rpcMetadata) => {
      startNextStyleSpan({ [NEXT_ROUTE_ATTRIBUTE]: "/api/hello" });

      expect(rpcMetadata.route).toBe("/api/hello");
    });
  });

  it("keeps the route of the innermost span when several spans carry next.route", () => {
    withHttpRequestContext((rpcMetadata) => {
      startNextStyleSpan({ [NEXT_ROUTE_ATTRIBUTE]: "/api/notes" });
      startNextStyleSpan({ [NEXT_ROUTE_ATTRIBUTE]: "/api/notes/[id]" });

      expect(rpcMetadata.route).toBe("/api/notes/[id]");
    });
  });

  it("leaves the RPC metadata alone for spans without next.route", () => {
    withHttpRequestContext((rpcMetadata) => {
      startNextStyleSpan({ "next.span_type": "AppRender.getBodyResult" });

      expect(rpcMetadata.route).toBeUndefined();
    });
  });

  it("ignores non-string next.route values", () => {
    withHttpRequestContext((rpcMetadata) => {
      const span = trace.getTracer("test").startSpan("weird", {
        attributes: { [NEXT_ROUTE_ATTRIBUTE]: 42 },
      });
      span.end();

      expect(rpcMetadata.route).toBeUndefined();
    });
  });

  it("does nothing when there is no HTTP RPC metadata on the context", () => {
    // A span started outside any incoming request, e.g. during a job.
    startNextStyleSpan({ [NEXT_ROUTE_ATTRIBUTE]: "/api/hello" });

    expect(getRPCMetadata(ROOT_CONTEXT)).toBeUndefined();
  });

  it("does not fabricate a route on the span itself", () => {
    withHttpRequestContext(() => {
      startNextStyleSpan({ [NEXT_ROUTE_ATTRIBUTE]: "/api/hello" });
    });

    const nextSpan = exporter
      .getFinishedSpans()
      .find((span) => span.name.startsWith("executing api route"));
    expect(nextSpan?.attributes[NEXT_ROUTE_ATTRIBUTE]).toBe("/api/hello");
    expect(nextSpan?.attributes[HTTP_ROUTE_ATTRIBUTE]).toBeUndefined();
  });
});

// Replicates the span topology observed on Vercel: Next's bundled runtime
// keeps separate tracer-internal attribute stores per route chunk, so the
// BaseServer.handleRequest entry span starts without a route while its
// runHandler child carries next.route. There is no HTTP instrumentation span
// and no RPC metadata in this topology.
describe("NextRouteSpanProcessor entry-span stamping", () => {
  function withEntrySpan<T>(
    attributes: Record<string, string>,
    fn: () => T,
  ): { result: T; end: () => void } {
    const entry = trace.getTracer("next.js", "0.0.1").startSpan("GET", {
      attributes,
    });
    const result = context.with(
      trace.setSpan(context.active(), entry),
      fn,
    );
    return { result, end: () => entry.end() };
  }

  function entrySpanAttributes() {
    const entry = exporter
      .getFinishedSpans()
      .find(
        (span) =>
          span.attributes["next.span_type"] === "BaseServer.handleRequest",
      );
    if (!entry) throw new Error("no entry span exported");
    return entry.attributes;
  }

  it("stamps the child's route onto a route-less handleRequest parent", () => {
    const { end } = withEntrySpan(
      { "next.span_type": "BaseServer.handleRequest", "http.method": "GET" },
      () => startNextStyleSpan({ [NEXT_ROUTE_ATTRIBUTE]: "/api/slow" }),
    );
    end();

    expect(entrySpanAttributes()[HTTP_ROUTE_ATTRIBUTE]).toBe("/api/slow");
    expect(entrySpanAttributes()[NEXT_ROUTE_ATTRIBUTE]).toBe("/api/slow");
  });

  it("does not overwrite a route the entry span already has", () => {
    const { end } = withEntrySpan(
      {
        "next.span_type": "BaseServer.handleRequest",
        [HTTP_ROUTE_ATTRIBUTE]: "/api/slow",
        [NEXT_ROUTE_ATTRIBUTE]: "/api/slow",
      },
      () => startNextStyleSpan({ [NEXT_ROUTE_ATTRIBUTE]: "/api/other" }),
    );
    end();

    expect(entrySpanAttributes()[HTTP_ROUTE_ATTRIBUTE]).toBe("/api/slow");
  });

  it("leaves parents that are not handleRequest spans alone", () => {
    const { end } = withEntrySpan(
      { "next.span_type": "AppRender.getBodyResult" },
      () => startNextStyleSpan({ [NEXT_ROUTE_ATTRIBUTE]: "/api/hello" }),
    );
    end();

    const parent = exporter
      .getFinishedSpans()
      .find(
        (span) =>
          span.attributes["next.span_type"] === "AppRender.getBodyResult",
      );
    expect(parent?.attributes[HTTP_ROUTE_ATTRIBUTE]).toBeUndefined();
  });

  it("survives routed spans with no parent span at all", () => {
    expect(() =>
      startNextStyleSpan({ [NEXT_ROUTE_ATTRIBUTE]: "/api/hello" }),
    ).not.toThrow();
  });

  it("also stamps the entry span when RPC metadata is present", () => {
    // Preloaded self-hosted topology: HTTP span with RPC metadata wraps
    // Next's entry span; both bridges should engage.
    withHttpRequestContext((rpcMetadata) => {
      const { end } = withEntrySpan(
        { "next.span_type": "BaseServer.handleRequest" },
        () => startNextStyleSpan({ [NEXT_ROUTE_ATTRIBUTE]: "/api/hello" }),
      );
      end();

      expect(rpcMetadata.route).toBe("/api/hello");
      expect(entrySpanAttributes()[HTTP_ROUTE_ATTRIBUTE]).toBe("/api/hello");
    });
  });
});
