import type { Instrumentation } from "@opentelemetry/instrumentation";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { resourceFromAttributes } from "@opentelemetry/resources";
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from "@opentelemetry/semantic-conventions";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-proto";
import { HttpInstrumentation } from "@opentelemetry/instrumentation-http";
import { ExpressInstrumentation } from "@opentelemetry/instrumentation-express";
import { FastifyOtelInstrumentation } from "@fastify/otel";
import { AwsLambdaInstrumentation } from "@opentelemetry/instrumentation-aws-lambda";
import { PgInstrumentation } from "@opentelemetry/instrumentation-pg";
import { RedisInstrumentation } from "@opentelemetry/instrumentation-redis";
import { MongoDBInstrumentation } from "@opentelemetry/instrumentation-mongodb";
import { MySQLInstrumentation } from "@opentelemetry/instrumentation-mysql";
import { UndiciInstrumentation } from "@opentelemetry/instrumentation-undici";
import {
  BatchSpanProcessor,
  type SpanProcessor,
} from "@opentelemetry/sdk-trace-node";
import { JobAttributesSpanProcessor } from "./src/jobs/index.js";

export * from "./src/errors/index.js";
export * from "./src/jobs/index.js";

const DEFAULT_OTEL_ENDPOINT = "https://ingest.vigilon.io";

// Shared with the preload entrypoints (register.cjs / register.mjs) so that a
// preload and an in-process register() call cannot start two SDKs.
const REGISTER_STATE_KEY = Symbol.for("vigilon.register.started");

type VigilonRegistrationState = {
  sdk?: NodeSDK;
  shutdownPromise?: Promise<void>;
};

export type SpanProcessorContext = {
  /** The batch processor that feeds the OTLP trace exporter. */
  batchSpanProcessor: SpanProcessor;
};

export type SpanProcessorExtensions = {
  /**
   * Processors that run before the batch processor — use for processors that
   * mutate span attributes, so the enriched span is what gets enqueued for
   * export.
   */
  prepend?: SpanProcessor[];
  /**
   * Processors that run after the batch processor — use for flush/export
   * hooks that must see the ending span already enqueued.
   */
  append?: SpanProcessor[];
};

export type VigilonRegisterParams = {
  apiKey: string;
  serviceName: string;
  environment: string;
  serviceVersion?: string;
  otelEndpoint?: string;
  /**
   * Additional incoming request URLs to leave uninstrumented. URLs are
   * matched exactly against the request URL, including any query string.
   */
  excludedUrls?: string[];
  /**
   * Extension seam for framework-specific packages
   * to contribute span processors around the batch exporter.
   */
  extendSpanProcessors?: (ctx: SpanProcessorContext) => SpanProcessorExtensions;
};

export function register({
  apiKey,
  serviceName,
  environment,
  serviceVersion,
  otelEndpoint = process.env.VIGILON_OTEL_ENDPOINT,
  excludedUrls,
  extendSpanProcessors,
}: VigilonRegisterParams) {
  const globalState = globalThis as Record<symbol, unknown>;
  if (globalState[REGISTER_STATE_KEY]) {
    console.warn(
      "Vigilon is already registered; ignoring this register() call. This usually means the SDK was started via both the preload entrypoint (@vigilon/node/register) and an in-process register() call — keep only one.",
    );
    return undefined;
  }
  const registrationState: VigilonRegistrationState = {};
  globalState[REGISTER_STATE_KEY] = registrationState;

  try {
    const sdk = startSdk({
      apiKey,
      serviceName,
      environment,
      serviceVersion,
      otelEndpoint,
      excludedUrls,
      extendSpanProcessors,
    });
    registrationState.sdk = sdk;
    return sdk;
  } catch (error) {
    // A failed start must not poison the guard — leaving it set would make
    // every later register() attempt warn and no-op.
    delete globalState[REGISTER_STATE_KEY];
    throw error;
  }
}

/**
 * Flushes pending telemetry and shuts down the process-wide Vigilon SDK.
 *
 * Safe to call before registration and safe to call repeatedly. Concurrent
 * and later calls share the first shutdown attempt.
 */
export function shutdown(): Promise<void> {
  const globalState = globalThis as Record<symbol, unknown>;
  const registrationState = globalState[REGISTER_STATE_KEY];

  if (!isRegistrationState(registrationState) || !registrationState.sdk) {
    return Promise.resolve();
  }

  if (!registrationState.shutdownPromise) {
    try {
      registrationState.shutdownPromise = registrationState.sdk.shutdown();
    } catch (error) {
      registrationState.shutdownPromise = Promise.reject(error);
    }
  }
  return registrationState.shutdownPromise;
}

function isRegistrationState(
  value: unknown,
): value is VigilonRegistrationState {
  return typeof value === "object" && value !== null;
}

function startSdk({
  apiKey,
  serviceName,
  environment,
  serviceVersion,
  otelEndpoint,
  excludedUrls,
  extendSpanProcessors,
}: VigilonRegisterParams) {
  process.env.OTEL_SEMCONV_STABILITY_OPT_IN = "http";

  const exporterBaseUrl = resolveEndpoint(otelEndpoint);

  const traceExporter = new OTLPTraceExporter({
    url: `${exporterBaseUrl}/v1/traces`,
    headers: {
      authorization: `Bearer ${apiKey}`,
    },
  });

  const batchSpanProcessor = new BatchSpanProcessor(traceExporter);
  const extensions = extendSpanProcessors?.({ batchSpanProcessor }) ?? {};
  const spanProcessors: SpanProcessor[] = [
    new JobAttributesSpanProcessor(),
    ...(extensions.prepend ?? []),
    batchSpanProcessor,
    ...(extensions.append ?? []),
  ];

  const sdk = new NodeSDK({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: serviceName,
      ...(serviceVersion
        ? { [ATTR_SERVICE_VERSION]: serviceVersion }
        : {}),
      ["deployment.environment"]: environment,
    }),
    // NodeSDK ignores traceExporter once spanProcessors is set, so the exporter
    // is wired through the batch processor here instead.
    spanProcessors,
    // An empty list overrides NodeSDK's OTEL_METRICS_EXPORTER fallback so this
    // SDK does not export metrics; the collector derives them from spans.
    metricReaders: [],
    instrumentations: buildInstrumentations(excludedUrls),
  });

  sdk.start();

  return sdk;
}

const DEFAULT_EXCLUDED_URLS = ["/health", "/ready", "/favicon.ico"];

function buildInstrumentations(excludedUrls: string[] = []): Instrumentation[] {
  const urlsToExclude = new Set([...DEFAULT_EXCLUDED_URLS, ...excludedUrls]);
  const instrumentations: Instrumentation[] = [
    new HttpInstrumentation({
      ignoreIncomingRequestHook: (req) => {
        const url = req.url ?? "";
        return urlsToExclude.has(url);
      },
    }),
    new ExpressInstrumentation(),
    // registerOnInitialization keeps Fastify zero-config: the plugin is
    // registered automatically when the Fastify instance is created.
    new FastifyOtelInstrumentation({ registerOnInitialization: true }),
    new PgInstrumentation(),
    new RedisInstrumentation(),
    new MongoDBInstrumentation(),
    new MySQLInstrumentation(),
    new UndiciInstrumentation(),
  ];

  // On AWS Lambda the container freezes between invocations, which kills the
  // BatchSpanProcessor drain. The Lambda instrumentation force-flushes the
  // tracer provider at the end of every invocation. Only activated in the
  // Lambda runtime.
  if (process.env.AWS_LAMBDA_FUNCTION_NAME) {
    instrumentations.push(new AwsLambdaInstrumentation());
  }

  return instrumentations;
}

function resolveEndpoint(endpoint?: string) {
  const normalizedEndpoint = endpoint?.trim().replace(/\/+$/, "");
  return normalizedEndpoint || DEFAULT_OTEL_ENDPOINT;
}
