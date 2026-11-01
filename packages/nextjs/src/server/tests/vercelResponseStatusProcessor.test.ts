import * as http from "node:http";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SpanKind, context, trace } from "@opentelemetry/api";
import {
  InMemorySpanExporter,
  NodeTracerProvider,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-node";
import {
  HTTP_RESPONSE_STATUS_CODE_ATTRIBUTE,
  VercelResponseStatusProcessor,
  patchServerResponseStatus,
} from "../vercelResponseStatusProcessor";

let exporter: InMemorySpanExporter;
let provider: NodeTracerProvider;
let processor: VercelResponseStatusProcessor;

beforeEach(() => {
  exporter = new InMemorySpanExporter();
  processor = new VercelResponseStatusProcessor();
  provider = new NodeTracerProvider({
    spanProcessors: [processor, new SimpleSpanProcessor(exporter)],
  });
  provider.register();
});

afterEach(async () => {
  await provider.shutdown();
  trace.disable();
  context.disable();
});

function exportedEntrySpan(name = "GET /api/warn") {
  const span = exporter
    .getFinishedSpans()
    .find((candidate) => candidate.name === name);
  if (!span) throw new Error(`entry span ${name} not exported`);
  return span;
}

describe("VercelResponseStatusProcessor", () => {
  it("records the status on the entry span of the active trace", () => {
    const tracer = trace.getTracer("test");
    const entry = tracer.startSpan("GET /api/warn", { kind: SpanKind.SERVER });
    context.with(trace.setSpan(context.active(), entry), () => {
      // Simulate the write happening under a nested child span, as it does
      // inside Next's response pipeline.
      const child = tracer.startSpan("start response");
      context.with(trace.setSpan(context.active(), child), () => {
        processor.recordStatus(429);
      });
      child.end();
    });
    entry.end();

    expect(
      exportedEntrySpan().attributes[HTTP_RESPONSE_STATUS_CODE_ATTRIBUTE],
    ).toBe(429);
  });

  it("does nothing without an active span", () => {
    const entry = trace
      .getTracer("test")
      .startSpan("GET /api/warn", { kind: SpanKind.SERVER });
    processor.recordStatus(500);
    entry.end();

    expect(
      exportedEntrySpan().attributes[HTTP_RESPONSE_STATUS_CODE_ATTRIBUTE],
    ).toBeUndefined();
  });

  it("stops tracking an entry span once it has ended", () => {
    const tracer = trace.getTracer("test");
    const entry = tracer.startSpan("GET /api/warn", { kind: SpanKind.SERVER });
    const entryContext = trace.setSpan(context.active(), entry);
    entry.end();

    context.with(entryContext, () => processor.recordStatus(503));

    expect(
      exportedEntrySpan().attributes[HTTP_RESPONSE_STATUS_CODE_ATTRIBUTE],
    ).toBeUndefined();
  });

  it("ignores non-entry spans when registering", () => {
    const tracer = trace.getTracer("test");
    const entry = tracer.startSpan("GET /api/warn", { kind: SpanKind.SERVER });
    context.with(trace.setSpan(context.active(), entry), () => {
      const nested = tracer.startSpan("nested", { kind: SpanKind.SERVER });
      nested.end();
      // The registry must still point at the entry span, not the nested one.
      processor.recordStatus(404);
    });
    entry.end();

    expect(
      exportedEntrySpan().attributes[HTTP_RESPONSE_STATUS_CODE_ATTRIBUTE],
    ).toBe(404);
  });
});

describe("patchServerResponseStatus", () => {
  it("records the implicit-header status from a real server response", async () => {
    patchServerResponseStatus(processor);
    const tracer = trace.getTracer("test");

    const server = http.createServer((_req, res) => {
      const entry = tracer.startSpan("GET /api/warn", {
        kind: SpanKind.SERVER,
      });
      context.with(trace.setSpan(context.active(), entry), () => {
        res.statusCode = 429;
        res.end("too many");
      });
      entry.end();
    });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const { port } = server.address() as { port: number };
    const response = await fetch(`http://127.0.0.1:${port}/`);
    server.close();

    expect(response.status).toBe(429);
    expect(
      exportedEntrySpan().attributes[HTTP_RESPONSE_STATUS_CODE_ATTRIBUTE],
    ).toBe(429);
  });

  it("is idempotent", () => {
    patchServerResponseStatus(processor);
    const once = http.ServerResponse.prototype.writeHead;
    patchServerResponseStatus(processor);

    expect(http.ServerResponse.prototype.writeHead).toBe(once);
  });
});
