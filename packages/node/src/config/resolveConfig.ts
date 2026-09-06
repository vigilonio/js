import { findNearestPackageJson, type PackageInfo } from "./packageJson.js";

/**
 * Settings a caller can pass explicitly. Anything left undefined is resolved
 * from the environment (and, for service name and version, from package.json).
 */
export type ConfigOverrides = {
  apiKey?: string;
  serviceName?: string;
  environment?: string;
  serviceVersion?: string;
  otelEndpoint?: string;
  excludedUrls?: string[];
};

export type ResolvedConfig = {
  apiKey: string;
  serviceName: string;
  environment: string;
  serviceVersion?: string;
  otelEndpoint?: string;
  excludedUrls?: string[];
  /** Where each value came from, for the startup log line. */
  sources: {
    apiKey: string;
    serviceName: string;
    environment: string;
    serviceVersion?: string;
  };
};

export type ResolveConfigOptions = {
  env?: NodeJS.ProcessEnv;
  /** Lazy package.json lookup; only invoked when a setting needs it. */
  packageJson?: () => PackageInfo | undefined;
};

const EXPLICIT_SOURCE = "register() argument";
const PACKAGE_JSON_SOURCE = "package.json";

/** Environment variables consulted for each setting, highest priority first. */
export const SERVICE_NAME_ENV_VARS = [
  "VIGILON_SERVICE_NAME",
  "OTEL_SERVICE_NAME",
  "npm_package_name",
  "AWS_LAMBDA_FUNCTION_NAME",
] as const;
export const ENVIRONMENT_ENV_VARS = [
  "VIGILON_ENVIRONMENT",
  "ENVIRONMENT",
  "ENV",
  "NODE_ENV",
] as const;
export const SERVICE_VERSION_ENV_VARS = [
  "VIGILON_SERVICE_VERSION",
  "npm_package_version",
] as const;

export class VigilonConfigError extends Error {
  readonly name = "VigilonConfigError";
}

/**
 * Resolves the SDK configuration from explicit overrides, environment
 * variables, and the nearest package.json, in that order of priority.
 *
 * Throws a VigilonConfigError naming every missing required setting and the
 * sources that were checked for it.
 */
export function resolveConfig(
  overrides: ConfigOverrides = {},
  { env = process.env, packageJson = memoize(findNearestPackageJson) }: ResolveConfigOptions = {},
): ResolvedConfig {
  const apiKey =
    explicit(overrides.apiKey) ?? fromEnv(env, ["VIGILON_API_KEY"]);
  const serviceName =
    explicit(overrides.serviceName) ??
    fromEnv(env, SERVICE_NAME_ENV_VARS) ??
    fromPackageJson(packageJson, "name");
  const environment =
    explicit(overrides.environment) ?? fromEnv(env, ENVIRONMENT_ENV_VARS);
  const serviceVersion =
    explicit(overrides.serviceVersion) ??
    fromEnv(env, SERVICE_VERSION_ENV_VARS) ??
    fromPackageJson(packageJson, "version");

  const missing: string[] = [];
  if (!apiKey) {
    missing.push(describeMissing("an API key", ["VIGILON_API_KEY"], "apiKey"));
  }
  if (!serviceName) {
    missing.push(
      describeMissing(
        "a service name",
        [...SERVICE_NAME_ENV_VARS, `${PACKAGE_JSON_SOURCE} "name"`],
        "serviceName",
      ),
    );
  }
  if (!environment) {
    missing.push(
      describeMissing("an environment", ENVIRONMENT_ENV_VARS, "environment"),
    );
  }
  if (!apiKey || !serviceName || !environment) {
    throw new VigilonConfigError(
      `Vigilon cannot start:\n${missing.map((line) => `  - ${line}`).join("\n")}`,
    );
  }

  const otelEndpoint =
    explicit(overrides.otelEndpoint)?.value ??
    fromEnv(env, ["VIGILON_OTEL_ENDPOINT"])?.value;
  const excludedUrls =
    overrides.excludedUrls ?? parseExcludedUrls(env.VIGILON_EXCLUDED_URLS);

  return {
    apiKey: apiKey.value,
    serviceName: serviceName.value,
    environment: environment.value,
    serviceVersion: serviceVersion?.value,
    otelEndpoint,
    excludedUrls,
    sources: {
      apiKey: apiKey.source,
      serviceName: serviceName.source,
      environment: environment.source,
      serviceVersion: serviceVersion?.source,
    },
  };
}

/** True when VIGILON_DISABLED is set to 1, true, or yes (case-insensitive). */
export function isDisabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return isTruthy(env.VIGILON_DISABLED);
}

/** True when VIGILON_DEBUG is set to 1, true, or yes (case-insensitive). */
export function isDebug(env: NodeJS.ProcessEnv = process.env): boolean {
  return isTruthy(env.VIGILON_DEBUG);
}

/** One-line summary of the effective configuration and where it came from. */
export function describeConfig(config: ResolvedConfig, endpoint: string): string {
  const parts = [
    `service.name=${config.serviceName} (${config.sources.serviceName})`,
    `deployment.environment=${config.environment} (${config.sources.environment})`,
    config.serviceVersion
      ? `service.version=${config.serviceVersion} (${config.sources.serviceVersion})`
      : "service.version=<unset>",
    `endpoint=${endpoint}`,
  ];
  return `Vigilon started: ${parts.join(", ")}`;
}

type Resolved = { value: string; source: string };

function explicit(value: string | undefined): Resolved | undefined {
  const trimmed = value?.trim();
  return trimmed ? { value: trimmed, source: EXPLICIT_SOURCE } : undefined;
}

function fromEnv(
  env: NodeJS.ProcessEnv,
  names: readonly string[],
): Resolved | undefined {
  for (const name of names) {
    const trimmed = env[name]?.trim();
    if (trimmed) {
      return { value: trimmed, source: name };
    }
  }
  return undefined;
}

function fromPackageJson(
  packageJson: () => PackageInfo | undefined,
  field: "name" | "version",
): Resolved | undefined {
  const value = packageJson()?.[field]?.trim();
  return value ? { value, source: PACKAGE_JSON_SOURCE } : undefined;
}

function describeMissing(
  what: string,
  envSources: readonly string[],
  param: string,
): string {
  return `could not determine ${what}. Checked register({ ${param} }) and ${envSources.join(", ")}.`;
}

function parseExcludedUrls(raw: string | undefined): string[] | undefined {
  if (raw === undefined) {
    return undefined;
  }
  return raw
    .split(",")
    .map((url) => url.trim())
    .filter(Boolean);
}

function isTruthy(value: string | undefined): boolean {
  return ["1", "true", "yes"].includes(value?.trim().toLowerCase() ?? "");
}

function memoize<T>(fn: () => T): () => T {
  let called = false;
  let result: T;
  return () => {
    if (!called) {
      result = fn();
      called = true;
    }
    return result;
  };
}
