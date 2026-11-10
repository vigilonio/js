import { findNearestPackageJson, type PackageInfo } from "./packageJson.js";

/**
 * Settings a caller can pass explicitly. Anything left undefined is resolved
 * from the environment (and, for app name and version, from package.json).
 */
export type ConfigOverrides = {
  apiKey?: string;
  appName?: string;
  /** @deprecated Renamed to `appName`; will be removed in 0.3.0. */
  serviceName?: string;
  environment?: string;
  appVersion?: string;
  /** @deprecated Renamed to `appVersion`; will be removed in 0.3.0. */
  serviceVersion?: string;
  otelEndpoint?: string;
  excludedUrls?: string[];
};

export type ResolvedConfig = {
  apiKey: string;
  /** Exported as the `service.name` resource attribute. */
  appName: string;
  environment: string;
  /** Exported as the `service.version` resource attribute. */
  appVersion?: string;
  otelEndpoint?: string;
  excludedUrls?: string[];
  /** Where each value came from, for the startup log line. */
  sources: {
    apiKey: string;
    appName: string;
    environment: string;
    appVersion?: string;
  };
  /** One warning for each deprecated setting that is set. */
  deprecations: string[];
};

export type ResolveConfigOptions = {
  env?: NodeJS.ProcessEnv;
  /** Lazy package.json lookup; only invoked when a setting needs it. */
  packageJson?: () => PackageInfo | undefined;
};

const EXPLICIT_SOURCE = "register() argument";
const PACKAGE_JSON_SOURCE = "package.json";

/** Environment variables consulted for each setting, highest priority first. */
export const APP_NAME_ENV_VARS = [
  "VIGILON_APP_NAME",
  // Deprecated: renamed to VIGILON_APP_NAME, will be removed in 0.3.0.
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
export const APP_VERSION_ENV_VARS = [
  "VIGILON_APP_VERSION",
  // Deprecated: renamed to VIGILON_APP_VERSION, will be removed in 0.3.0.
  "VIGILON_SERVICE_VERSION",
  "npm_package_version",
] as const;
/** @deprecated Renamed to `APP_NAME_ENV_VARS`; will be removed in 0.3.0. */
export const SERVICE_NAME_ENV_VARS = APP_NAME_ENV_VARS;
/** @deprecated Renamed to `APP_VERSION_ENV_VARS`; will be removed in 0.3.0. */
export const SERVICE_VERSION_ENV_VARS = APP_VERSION_ENV_VARS;

export class VigilonConfigError extends Error {
  readonly name = "VigilonConfigError";
}

/**
 * Resolves the SDK configuration from explicit overrides, environment
 * variables, and the nearest package.json, in that order of priority.
 *
 * Throws a VigilonConfigError naming every missing required setting and the
 * sources that were checked for it. A placeholder API key counts as missing.
 */
export function resolveConfig(
  overrides: ConfigOverrides = {},
  { env = process.env, packageJson = memoize(findNearestPackageJson) }: ResolveConfigOptions = {},
): ResolvedConfig {
  const providedApiKey =
    explicit(overrides.apiKey) ?? fromEnv(env, ["VIGILON_API_KEY"]);
  const placeholderApiKey =
    providedApiKey && isPlaceholder(providedApiKey.value)
      ? providedApiKey
      : undefined;
  const apiKey = placeholderApiKey ? undefined : providedApiKey;
  const appName =
    explicit(overrides.appName) ??
    explicit(overrides.serviceName) ??
    fromEnv(env, APP_NAME_ENV_VARS) ??
    fromPackageJson(packageJson, "name");
  const environment =
    explicit(overrides.environment) ?? fromEnv(env, ENVIRONMENT_ENV_VARS);
  const appVersion =
    explicit(overrides.appVersion) ??
    explicit(overrides.serviceVersion) ??
    fromEnv(env, APP_VERSION_ENV_VARS) ??
    fromPackageJson(packageJson, "version");

  const missing: string[] = [];
  if (placeholderApiKey) {
    missing.push(
      `the API key from ${placeholderApiKey.source} is a placeholder. Set a real API key.`,
    );
  } else if (!apiKey) {
    missing.push(describeMissing("an API key", ["VIGILON_API_KEY"], "apiKey"));
  }
  if (!appName) {
    missing.push(
      describeMissing(
        "an app name",
        [...APP_NAME_ENV_VARS, `${PACKAGE_JSON_SOURCE} "name"`],
        "appName",
      ),
    );
  }
  if (!environment) {
    missing.push(
      describeMissing("an environment", ENVIRONMENT_ENV_VARS, "environment"),
    );
  }
  if (!apiKey || !appName || !environment) {
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
    appName: appName.value,
    environment: environment.value,
    appVersion: appVersion?.value,
    otelEndpoint,
    excludedUrls,
    sources: {
      apiKey: apiKey.source,
      appName: appName.source,
      environment: environment.source,
      appVersion: appVersion?.source,
    },
    deprecations: [
      ...deprecation("serviceName", "appName", overrides.serviceName, [
        ["appName", overrides.appName],
      ]),
      ...deprecation("VIGILON_SERVICE_NAME", "VIGILON_APP_NAME", env.VIGILON_SERVICE_NAME, [
        ["appName", overrides.appName],
        ["serviceName", overrides.serviceName],
        ["VIGILON_APP_NAME", env.VIGILON_APP_NAME],
      ]),
      ...deprecation("serviceVersion", "appVersion", overrides.serviceVersion, [
        ["appVersion", overrides.appVersion],
      ]),
      ...deprecation("VIGILON_SERVICE_VERSION", "VIGILON_APP_VERSION", env.VIGILON_SERVICE_VERSION, [
        ["appVersion", overrides.appVersion],
        ["serviceVersion", overrides.serviceVersion],
        ["VIGILON_APP_VERSION", env.VIGILON_APP_VERSION],
      ]),
    ],
  };
}

/**
 * The warning for a deprecated setting, when it is set: rename it, or remove
 * it when one of the settings that take priority over it is set too.
 */
function deprecation(
  old: string,
  current: string,
  value: string | undefined,
  higherPriority: Array<[name: string, value: string | undefined]>,
): string[] {
  if (!value?.trim()) {
    return [];
  }
  const winner = higherPriority.find(([, candidate]) => candidate?.trim())?.[0];
  return [
    winner === undefined
      ? `${old} is deprecated and will be removed in 0.3.0. Rename it to ${current}.`
      : `${old} is deprecated and ignored because ${winner} is set. Remove ${old}.`,
  ];
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
    `service.name=${config.appName} (${config.sources.appName})`,
    `deployment.environment=${config.environment} (${config.sources.environment})`,
    config.appVersion
      ? `service.version=${config.appVersion} (${config.sources.appVersion})`
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

/** A value in square brackets, such as [YOUR_API_KEY], left over from a guide. */
function isPlaceholder(value: string): boolean {
  return /^\[.*\]$/.test(value);
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
