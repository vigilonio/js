import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SpanKind, context, trace } from "@opentelemetry/api";
import {
  BatchSpanProcessor,
  InMemorySpanExporter,
  NodeTracerProvider,
} from "@opentelemetry/sdk-trace-node";
import { VercelFlushSpanProcessor } from "../vercelFlushSpanProcessor";

const VERCEL_REQUEST_CONTEXT = Symbol.for("@vercel/request-context");

const REMOTE_PARENT = {
  traceId: "aaaabbbbccccddddeeeeffff00001111",
  spanId: "0123456789abcdef",
  traceFlags: 1,
  isRemote: true,
};

let flushable: { forceFlush: ReturnType<typeof vi.fn<() => Promise<void>>> };
let provider: NodeTracerProvider;

function startProvider(...extra: ConstructorParameters<typeof NodeTracerProvider>) {
  provider = new NodeTracerProvider({
    spanProcessors: [new VercelFlushSpanProcessor([flushable])],
    ...extra[0],
  });
  provider.register();
}

beforeEach(() => {
  flushable = { forceFlush: vi.fn().mockResolvedValue(undefined) };
});

afterEach(async () => {
  await provider.shutdown();
  trace.disable();
  context.disable();
  delete (globalThis as Record<symbol, unknown>)[VERCEL_REQUEST_CONTEXT];
});

describe("VercelFlushSpanProcessor", () => {
  it("flushes when a root SERVER span ends", () => {
    startProvider();
    const span = trace
      .getTracer("test")
      .startSpan("GET /api/hello", { kind: SpanKind.SERVER });
    expect(flushable.forceFlush).not.toHaveBeenCalled();
    span.end();

    expect(flushable.forceFlush).toHaveBeenCalledTimes(1);
  });

  it("flushes when a remote-parented SERVER span ends", () => {
    startProvider();
    const remoteContext = trace.setSpanContext(
      context.active(),
      REMOTE_PARENT,
    );
    const span = trace
      .getTracer("test")
      .startSpan("GET /api/hello", { kind: SpanKind.SERVER }, remoteContext);
    span.end();

    expect(flushable.forceFlush).toHaveBeenCalledTimes(1);
  });

  it("does not flush for non-SERVER spans or locally-parented SERVER spans", () => {
    startProvider();
    const tracer = trace.getTracer("test");

    const internal = tracer.startSpan("db.query");
    internal.end();

    const entry = tracer.startSpan("GET /api/hello", {
      kind: SpanKind.SERVER,
    });
    context.with(trace.setSpan(context.active(), entry), () => {
      const nested = tracer.startSpan("nested handleRequest", {
        kind: SpanKind.SERVER,
      });
      nested.end();
    });

    // Only the eventual entry-span end may flush; the nested SERVER span and
    // the internal span must not.
    expect(flushable.forceFlush).not.toHaveBeenCalled();
    entry.end();
    expect(flushable.forceFlush).toHaveBeenCalledTimes(1);
  });

  it("registers the keep-alive with waitUntil when the entry span STARTS", () => {
    const waitUntil = vi.fn();
    (globalThis as Record<symbol, unknown>)[VERCEL_REQUEST_CONTEXT] = {
      get: () => ({ waitUntil }),
    };
    startProvider();

    const span = trace
      .getTracer("test")
      .startSpan("GET /api/hello", { kind: SpanKind.SERVER });

    // Registration must happen while the request is in flight — a waitUntil
    // registered after the response settles (i.e. at span end) is silently
    // dropped by Vercel's runtime.
    expect(waitUntil).toHaveBeenCalledTimes(1);
    expect(waitUntil.mock.calls[0][0]).toBeInstanceOf(Promise);
    span.end();
    expect(waitUntil).toHaveBeenCalledTimes(1);
  });

  it("releases the keep-alive only once the flush completes", async () => {
    const waitUntil = vi.fn();
    (globalThis as Record<symbol, unknown>)[VERCEL_REQUEST_CONTEXT] = {
      get: () => ({ waitUntil }),
    };
    let finishFlush!: () => void;
    flushable.forceFlush.mockImplementation(
      () => new Promise<void>((resolve) => (finishFlush = resolve)),
    );
    startProvider();

    const span = trace
      .getTracer("test")
      .startSpan("GET /api/hello", { kind: SpanKind.SERVER });
    const keepAlive: Promise<void> = waitUntil.mock.calls[0][0];
    let released = false;
    void keepAlive.then(() => (released = true));

    span.end();
    await Promise.resolve();
    expect(released).toBe(false);

    finishFlush();
    await vi.waitFor(() => expect(released).toBe(true));
  });

  it("releases the keep-alive via the backstop if the span never ends", async () => {
    vi.useFakeTimers();
    try {
      const waitUntil = vi.fn();
      (globalThis as Record<symbol, unknown>)[VERCEL_REQUEST_CONTEXT] = {
        get: () => ({ waitUntil }),
      };
      startProvider();

      trace
        .getTracer("test")
        .startSpan("GET /api/hello", { kind: SpanKind.SERVER });
      const keepAlive: Promise<void> = waitUntil.mock.calls[0][0];
      let released = false;
      void keepAlive.then(() => (released = true));

      vi.advanceTimersByTime(15_000);
      await vi.advanceTimersByTimeAsync(0);
      expect(released).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("exports the ending entry span itself when placed after the batch processor", async () => {
    const exporter = new InMemorySpanExporter();
    const batch = new BatchSpanProcessor(exporter);
    provider = new NodeTracerProvider({
      spanProcessors: [batch, new VercelFlushSpanProcessor([batch])],
    });
    provider.register();

    trace
      .getTracer("test")
      .startSpan("GET /api/hello", { kind: SpanKind.SERVER })
      .end();

    // No timer has fired; the flush triggered by the span's own end must have
    // pushed it to the exporter.
    await vi.waitFor(() => {
      expect(
        exporter.getFinishedSpans().map((span) => span.name),
      ).toContain("GET /api/hello");
    });
  });
});
