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

// Under vitest, npm_package_* and the nearest package.json would supply a
// service name and version, which would hide the "missing setting" paths.
// Pretend there is no package.json and clear the npm-provided variables.
vi.mock("./src/config/packageJson.js", () => ({
  defaultSearchDirs: () => [],
  findNearestPackageJson: () => undefined,
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
  vi.stubEnv("npm_package_name", "");
  vi.stubEnv("npm_package_version", "");
  vi.spyOn(console, "info").mockImplementation(() => {});
  startMock.mockClear();
  shutdownMock.mockReset().mockResolvedValue(undefined);
  nodeSdkCtorMock.mockClear();
  delete (globalThis as Record<symbol, unknown>)[REGISTER_STATE_KEY];
});

describe("shutdown", () => {
  it("resolves and warns instead of rejecting when the final flush fails", async () => {
    shutdownMock.mockRejectedValue(new Error("Unauthorized"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    register(params);

    await expect(shutdown()).resolves.toBeUndefined();

    expect(warn).toHaveBeenCalledWith(expect.stringContaining("Unauthorized"));
  });

  it("resolves when the SDK throws synchronously from shutdown", async () => {
    shutdownMock.mockImplementation(() => {
      throw new Error("sync boom");
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    register(params);

    await expect(shutdown()).resolves.toBeUndefined();

    expect(warn).toHaveBeenCalledWith(expect.stringContaining("sync boom"));
  });

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
  vi.unstubAllEnvs();
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

describe("configuration from the environment", () => {
  let registerFromEnv: typeof import("./index.js").registerFromEnv;

  beforeEach(async () => {
    ({ registerFromEnv } = await import("./index.js"));
    vi.stubEnv("VIGILON_API_KEY", "env-key");
    vi.stubEnv("VIGILON_SERVICE_NAME", "env-service");
    vi.stubEnv("VIGILON_ENVIRONMENT", "env-test");
    vi.stubEnv("VIGILON_SERVICE_VERSION", "1.0.0");
    vi.stubEnv("VIGILON_EXCLUDED_URLS", " /metrics , /internal/status ,");
  });

  it("starts the SDK from the VIGILON_* variables", () => {
    const sdk = registerFromEnv();

    expect(sdk).toBeDefined();
    expect(startMock).toHaveBeenCalledTimes(1);
  });

  it("uses the resolved values as the resource attributes", () => {
    vi.stubEnv("VIGILON_SERVICE_NAME", "");
    vi.stubEnv("OTEL_SERVICE_NAME", "otel-service");
    vi.stubEnv("VIGILON_ENVIRONMENT", "");
    vi.stubEnv("ENVIRONMENT", "staging");

    register();

    const options = nodeSdkCtorMock.mock.calls[0][0] as {
      resource: { attributes: Record<string, unknown> };
    };
    expect(options.resource.attributes).toMatchObject({
      "service.name": "otel-service",
      "service.version": "1.0.0",
      "deployment.environment": "staging",
    });
  });

  it("lets register() arguments override the environment", () => {
    register({ serviceName: "explicit", environment: "explicit-env" });

    const options = nodeSdkCtorMock.mock.calls[0][0] as {
      resource: { attributes: Record<string, unknown> };
    };
    expect(options.resource.attributes).toMatchObject({
      "service.name": "explicit",
      "deployment.environment": "explicit-env",
    });
  });

  it("throws without starting or taking the guard when a required setting is missing", () => {
    vi.stubEnv("VIGILON_SERVICE_NAME", "");

    expect(() => registerFromEnv()).toThrow(/VIGILON_SERVICE_NAME/);
    expect(startMock).not.toHaveBeenCalled();
    expect(
      (globalThis as Record<symbol, unknown>)[REGISTER_STATE_KEY],
    ).toBeUndefined();
  });

  it("logs the effective configuration and its sources on startup", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});

    registerFromEnv();

    expect(info).toHaveBeenCalledWith(
      expect.stringContaining(
        "service.name=env-service (VIGILON_SERVICE_NAME), deployment.environment=env-test (VIGILON_ENVIRONMENT), service.version=1.0.0 (VIGILON_SERVICE_VERSION)",
      ),
    );
  });

  it("warns when no service version can be resolved", () => {
    vi.stubEnv("VIGILON_SERVICE_VERSION", "");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    registerFromEnv();

    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("VIGILON_SERVICE_VERSION"),
    );
  });

  it("does nothing when VIGILON_DISABLED is set", () => {
    vi.stubEnv("VIGILON_DISABLED", "true");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    expect(register()).toBeUndefined();
    expect(startMock).not.toHaveBeenCalled();
    expect(
      (globalThis as Record<symbol, unknown>)[REGISTER_STATE_KEY],
    ).toBeUndefined();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("VIGILON_DISABLED"));
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
