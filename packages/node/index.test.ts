import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HttpInstrumentation } from "@opentelemetry/instrumentation-http";

const startMock = vi.fn();
const shutdownMock = vi.fn<() => Promise<void>>();
const nodeSdkCtorMock = vi.fn();

// Avoid starting a real SDK (network exporters + background timers). We only
// care about register()'s own control flow here.
vi.mock("@opentelemetry/sdk-node", () => ({
  NodeSDK: class {
    constructor(options: unknown) {
      nodeSdkCtorMock(options);
    }
    start = startMock;
    shutdown = shutdownMock;
  },
}));

const REGISTER_STATE_KEY = Symbol.for("vigilon.register.started");

const params = {
  apiKey: "test-key",
  serviceName: "test-service",
  environment: "test",
  otelEndpoint: "http://localhost:9999",
};

let register: typeof import("./index.js").register;
let shutdown: typeof import("./index.js").shutdown;

beforeEach(async () => {
  ({ register, shutdown } = await import("./index.js"));
  startMock.mockClear();
  shutdownMock.mockReset().mockResolvedValue(undefined);
  nodeSdkCtorMock.mockClear();
  delete (globalThis as Record<symbol, unknown>)[REGISTER_STATE_KEY];
});

describe("shutdown", () => {
  it("is a no-op before the SDK is registered", async () => {
    await expect(shutdown()).resolves.toBeUndefined();

    expect(shutdownMock).not.toHaveBeenCalled();
  });

  it("shuts down the SDK retained by register", async () => {
    register(params);

    await shutdown();

    expect(shutdownMock).toHaveBeenCalledTimes(1);
  });

  it("shares one shutdown across concurrent and later calls", async () => {
    let resolveShutdown: (() => void) | undefined;
    shutdownMock.mockReturnValue(
      new Promise<void>((resolve) => {
        resolveShutdown = resolve;
      }),
    );
    register(params);

    const first = shutdown();
    const second = shutdown();

    expect(first).toBe(second);
    expect(shutdownMock).toHaveBeenCalledTimes(1);

    resolveShutdown?.();
    await first;
    await shutdown();

    expect(shutdownMock).toHaveBeenCalledTimes(1);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  delete (globalThis as Record<symbol, unknown>)[REGISTER_STATE_KEY];
});

describe("register idempotency guard", () => {
  it("starts the SDK and marks the process as registered on first call", () => {
    const sdk = register(params);

    expect(sdk).toBeDefined();
    expect(startMock).toHaveBeenCalledTimes(1);
    expect(
      (globalThis as Record<symbol, unknown>)[REGISTER_STATE_KEY],
    ).toBeTruthy();
  });

  it("no-ops and warns on a second call without starting a second SDK", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    register(params);
    startMock.mockClear();

    const second = register(params);

    expect(second).toBeUndefined();
    expect(startMock).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("already registered"),
    );
  });

  it("does not start an SDK when the guard symbol is already set by a preload", () => {
    (globalThis as Record<symbol, unknown>)[REGISTER_STATE_KEY] = true;
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const sdk = register(params);

    expect(sdk).toBeUndefined();
    expect(startMock).not.toHaveBeenCalled();
  });

  it("clears the guard when startup throws, so a later attempt can succeed", () => {
    const boom = new Error("extension exploded");

    expect(() =>
      register({
        ...params,
        extendSpanProcessors: () => {
          throw boom;
        },
      }),
    ).toThrow(boom);
    expect(
      (globalThis as Record<symbol, unknown>)[REGISTER_STATE_KEY],
    ).toBeUndefined();

    const sdk = register(params);

    expect(sdk).toBeDefined();
    expect(startMock).toHaveBeenCalledTimes(1);
  });
});

describe("extendSpanProcessors seam", () => {
  it("orders processors as [jobs, ...prepend, batch, ...append]", () => {
    const prepended = { name: "prepended" };
    const appended = { name: "appended" };
    const seen: { batch?: unknown } = {};

    register({
      ...params,
      extendSpanProcessors: ({ batchSpanProcessor }) => {
        seen.batch = batchSpanProcessor;
        return {
          prepend: [prepended as never],
          append: [appended as never],
        };
      },
    });

    const options = nodeSdkCtorMock.mock.calls[0][0] as {
      spanProcessors: unknown[];
      metricReader?: unknown;
      metricReaders?: unknown[];
    };
    expect(options.spanProcessors).toHaveLength(4);
    expect(options.spanProcessors[1]).toBe(prepended);
    expect(options.spanProcessors[2]).toBe(seen.batch);
    expect(options.spanProcessors[3]).toBe(appended);
    expect(options.metricReader).toBeUndefined();
    expect(options.metricReaders).toEqual([]);
  });
});

describe("incoming URL exclusions", () => {
  it("combines built-in exclusions with client-provided URLs", () => {
    register({
      ...params,
      excludedUrls: ["/internal/metrics", "/internal/status?full=true"],
    });

    const options = nodeSdkCtorMock.mock.calls[0][0] as {
      instrumentations: unknown[];
    };
    const http = options.instrumentations.find(
      (instrumentation) => instrumentation instanceof HttpInstrumentation,
    );
    expect(http).toBeInstanceOf(HttpInstrumentation);

    const ignoreIncomingRequestHook = (
      http as HttpInstrumentation
    ).getConfig().ignoreIncomingRequestHook;
    expect(ignoreIncomingRequestHook?.({ url: "/health" } as never)).toBe(
      true,
    );
    expect(
      ignoreIncomingRequestHook?.({ url: "/internal/metrics" } as never),
    ).toBe(true);
    expect(
      ignoreIncomingRequestHook?.({ url: "/internal/status?full=true" } as never),
    ).toBe(true);
    expect(ignoreIncomingRequestHook?.({ url: "/internal/status" } as never)).toBe(
      false,
    );
  });
});

describe("registerFromEnv", () => {
  let registerFromEnv: typeof import("./index.js").registerFromEnv;

  beforeEach(async () => {
    ({ registerFromEnv } = await import("./index.js"));
    vi.stubEnv("VIGILON_API_KEY", "env-key");
    vi.stubEnv("VIGILON_SERVICE_NAME", "env-service");
    vi.stubEnv("VIGILON_ENVIRONMENT", "env-test");
    vi.stubEnv("VIGILON_SERVICE_VERSION", "1.0.0");
    vi.stubEnv("VIGILON_EXCLUDED_URLS", " /metrics , /internal/status ,");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("starts the SDK from the VIGILON_* variables", () => {
    const sdk = registerFromEnv();

    expect(sdk).toBeDefined();
    expect(startMock).toHaveBeenCalledTimes(1);
  });

  it("throws without starting when a required variable is missing", () => {
    vi.stubEnv("VIGILON_SERVICE_NAME", "");

    expect(() => registerFromEnv()).toThrow(/VIGILON_SERVICE_NAME/);
    expect(startMock).not.toHaveBeenCalled();
  });

  it("warns when VIGILON_SERVICE_VERSION is unset", () => {
    vi.stubEnv("VIGILON_SERVICE_VERSION", "");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    registerFromEnv();

    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("VIGILON_SERVICE_VERSION"),
    );
  });

  it("parses VIGILON_EXCLUDED_URLS into trimmed, non-empty exclusions", () => {
    registerFromEnv();

    const options = nodeSdkCtorMock.mock.calls[0][0] as {
      instrumentations: unknown[];
    };
    const http = options.instrumentations.find(
      (instrumentation) => instrumentation instanceof HttpInstrumentation,
    ) as HttpInstrumentation;
    const ignore = http.getConfig().ignoreIncomingRequestHook;
    expect(ignore?.({ url: "/metrics" } as never)).toBe(true);
    expect(ignore?.({ url: "/internal/status" } as never)).toBe(true);
    expect(ignore?.({ url: "/health" } as never)).toBe(true);
    expect(ignore?.({ url: "/api" } as never)).toBe(false);
  });
});
