import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SpanKind, SpanStatusCode, context, trace } from "@opentelemetry/api";
import {
  InMemorySpanExporter,
  NodeTracerProvider,
  SimpleSpanProcessor,
  type ReadableSpan,
} from "@opentelemetry/sdk-trace-node";
import { JobAttributesSpanProcessor } from "../jobAttributesSpanProcessor.js";
import {
  JOB_NAME_ATTRIBUTE,
  JOB_SCHEDULE_ATTRIBUTE,
  withJobMonitor,
} from "../withJobMonitor.js";

let exporter: InMemorySpanExporter;
let provider: NodeTracerProvider;

function finishedSpans(): ReadableSpan[] {
  return exporter.getFinishedSpans();
}

function jobSpan(name = "sync-users"): ReadableSpan {
  const span = finishedSpans().find((s) => s.name === `job ${name}`);
  if (!span) throw new Error(`no span found for job ${name}`);
  return span;
}

beforeEach(() => {
  exporter = new InMemorySpanExporter();
  provider = new NodeTracerProvider({
    spanProcessors: [
      new JobAttributesSpanProcessor(),
      new SimpleSpanProcessor(exporter),
    ],
  });
  // Registers the global tracer provider and the AsyncLocalStorage context
  // manager, so context propagates into the wrapped function.
  provider.register();
});

afterEach(async () => {
  await provider.shutdown();
  trace.disable();
  context.disable();
});

describe("withJobMonitor", () => {
  it("passes through a synchronous return value", () => {
    const result = withJobMonitor({ name: "sync-users" }, () => 42);

    expect(result).toBe(42);
    expect(finishedSpans()).toHaveLength(1);
  });

  it("passes through an async resolution and ends the span after it settles", async () => {
    const promise = withJobMonitor({ name: "sync-users" }, async () => {
      // The span must still be open while the job is running.
      expect(finishedSpans()).toHaveLength(0);
      return "done";
    });

    await expect(promise).resolves.toBe("done");
    expect(finishedSpans()).toHaveLength(1);
  });

  it("records the span as a job run with a name and no schedule by default", () => {
    withJobMonitor({ name: "sync-users" }, () => undefined);

    const span = jobSpan();
    expect(span.kind).toBe(SpanKind.INTERNAL);
    expect(span.attributes[JOB_NAME_ATTRIBUTE]).toBe("sync-users");
    expect(span.attributes[JOB_SCHEDULE_ATTRIBUTE]).toBeUndefined();
    // Success leaves the status unset, matching HTTP span behaviour.
    expect(span.status.code).toBe(SpanStatusCode.UNSET);
  });

  it("records the schedule when provided", () => {
    withJobMonitor({ name: "sync-users", schedule: "0 3 * * *" }, () => undefined);

    expect(jobSpan().attributes[JOB_SCHEDULE_ATTRIBUTE]).toBe("0 3 * * *");
  });

  it("marks the span failed and rethrows when the job throws", () => {
    const error = new Error("boom");

    expect(() =>
      withJobMonitor({ name: "sync-users" }, () => {
        throw error;
      }),
    ).toThrow(error);

    const span = jobSpan();
    expect(span.status.code).toBe(SpanStatusCode.ERROR);
    expect(span.status.message).toBe("boom");
    expect(span.events.map((event) => event.name)).toContain("exception");
  });

  it("marks the span failed and rejects when the job rejects", async () => {
    const error = new Error("async boom");

    await expect(
      withJobMonitor({ name: "sync-users" }, async () => {
        throw error;
      }),
    ).rejects.toThrow(error);

    const span = jobSpan();
    expect(span.status.code).toBe(SpanStatusCode.ERROR);
    expect(span.events.map((event) => event.name)).toContain("exception");
  });

  it("coerces a non-Error throw into an Error for the status message", () => {
    expect(() =>
      withJobMonitor({ name: "sync-users" }, () => {
        throw "string failure";
      }),
    ).toThrow();

    expect(jobSpan().status.message).toBe("string failure");
  });

  it("serializes a non-Error object throw into the status message", () => {
    expect(() =>
      withJobMonitor({ name: "sync-users" }, () => {
        throw { code: "E_BOOM" };
      }),
    ).toThrow();

    expect(jobSpan().status.message).toBe('{"code":"E_BOOM"}');
  });

  it("starts a new root trace even inside an active span", () => {
    const tracer = trace.getTracer("test");
    const outer = tracer.startSpan("outer");

    context.with(trace.setSpan(context.active(), outer), () => {
      withJobMonitor({ name: "sync-users" }, () => undefined);
    });
    outer.end();

    const span = jobSpan();
    expect(span.parentSpanContext?.spanId).toBeUndefined();
    expect(span.spanContext().traceId).not.toBe(outer.spanContext().traceId);
  });

  it("makes the job span the active span inside the wrapped function", () => {
    let activeSpanId: string | undefined;

    withJobMonitor({ name: "sync-users" }, () => {
      activeSpanId = trace.getActiveSpan()?.spanContext().spanId;
    });

    expect(activeSpanId).toBe(jobSpan().spanContext().spanId);
  });
});

describe("JobAttributesSpanProcessor", () => {
  it("stamps job attributes onto child spans started inside the job", () => {
    withJobMonitor({ name: "sync-users", schedule: "0 3 * * *" }, () => {
      const child = trace.getTracer("test").startSpan("db.query");
      child.end();
    });

    const child = finishedSpans().find((span) => span.name === "db.query");
    expect(child?.attributes[JOB_NAME_ATTRIBUTE]).toBe("sync-users");
    expect(child?.attributes[JOB_SCHEDULE_ATTRIBUTE]).toBe("0 3 * * *");
  });

  it("leaves spans started outside a job untouched", () => {
    const span = trace.getTracer("test").startSpan("http.request");
    span.end();

    const exported = finishedSpans().find(
      (candidate) => candidate.name === "http.request",
    );
    expect(exported?.attributes[JOB_NAME_ATTRIBUTE]).toBeUndefined();
  });
});

describe("withJobMonitor without a registered SDK", () => {
  beforeEach(() => {
    // Drop the provider registered by the outer beforeEach so the global API
    // falls back to the no-op tracer, as it would before register() runs.
    trace.disable();
  });

  it("still runs the job and returns its value", async () => {
    expect(withJobMonitor({ name: "sync-users" }, () => "ok")).toBe("ok");
    await expect(
      withJobMonitor({ name: "sync-users" }, async () => "ok"),
    ).resolves.toBe("ok");
  });

  it("still rethrows job failures", () => {
    expect(() =>
      withJobMonitor({ name: "sync-users" }, () => {
        throw new Error("boom");
      }),
    ).toThrow("boom");
  });
});
