import { describe, expect, it } from "vitest";
import {
  VigilonConfigError,
  describeConfig,
  isDebug,
  isDisabled,
  resolveConfig,
} from "../resolveConfig.js";

const noPackageJson = () => undefined;
const packageJson = () => ({
  name: "@acme/api",
  version: "1.2.3",
  path: "/app/package.json",
});

const baseEnv = { VIGILON_API_KEY: "key", VIGILON_ENVIRONMENT: "production" };

function resolve(
  env: NodeJS.ProcessEnv,
  overrides = {},
  pkg: () => ReturnType<typeof packageJson> | undefined = noPackageJson,
) {
  return resolveConfig(overrides, { env, packageJson: pkg });
}

describe("app name resolution", () => {
  it("prefers the explicit register() argument over everything", () => {
    const config = resolve(
      { ...baseEnv, VIGILON_APP_NAME: "from-env" },
      { appName: "explicit" },
      packageJson,
    );

    expect(config.appName).toBe("explicit");
    expect(config.sources.appName).toBe("register() argument");
  });

  it.each([
    ["VIGILON_APP_NAME", { VIGILON_SERVICE_NAME: "x", OTEL_SERVICE_NAME: "x" }],
    ["VIGILON_SERVICE_NAME", { OTEL_SERVICE_NAME: "x", npm_package_name: "x" }],
    ["OTEL_SERVICE_NAME", { npm_package_name: "x", AWS_LAMBDA_FUNCTION_NAME: "x" }],
    ["npm_package_name", { AWS_LAMBDA_FUNCTION_NAME: "x" }],
    ["AWS_LAMBDA_FUNCTION_NAME", {}],
  ])("reads %s ahead of lower-priority variables", (name, lower) => {
    const config = resolve({ ...baseEnv, ...lower, [name]: "winner" }, {}, packageJson);

    expect(config.appName).toBe("winner");
    expect(config.sources.appName).toBe(name);
  });

  it("falls back to the nearest package.json name", () => {
    const config = resolve(baseEnv, {}, packageJson);

    expect(config.appName).toBe("@acme/api");
    expect(config.sources.appName).toBe("package.json");
  });

  it("reports the name as missing when the nearest package.json has only a version", () => {
    const versionOnly = () => ({ version: "1.2.3", path: "/app/package.json" });

    expect(() => resolve(baseEnv, {}, versionOnly)).toThrow(/VIGILON_APP_NAME/);

    const config = resolve({ ...baseEnv, VIGILON_APP_NAME: "svc" }, {}, versionOnly);
    expect(config.appVersion).toBe("1.2.3");
    expect(config.sources.appVersion).toBe("package.json");
  });

  it("does not read package.json when the environment covers name and version", () => {
    let reads = 0;
    resolve(
      { ...baseEnv, VIGILON_APP_NAME: "svc", VIGILON_APP_VERSION: "1" },
      {},
      () => {
        reads += 1;
        return undefined;
      },
    );

    expect(reads).toBe(0);
  });
});

describe("deprecated settings", () => {
  it("has no deprecations when only the new names are used", () => {
    const config = resolve(
      { ...baseEnv, VIGILON_APP_NAME: "svc", VIGILON_APP_VERSION: "1" },
      { appName: "api", appVersion: "2" },
    );

    expect(config.deprecations).toEqual([]);
  });

  it("uses serviceName and serviceVersion when the new arguments are unset, and says to rename them", () => {
    const config = resolve(
      { ...baseEnv, VIGILON_APP_NAME: "from-env", VIGILON_APP_VERSION: "env" },
      { serviceName: "api", serviceVersion: "2" },
    );

    expect(config).toMatchObject({
      appName: "api",
      appVersion: "2",
      sources: { appName: "register() argument", appVersion: "register() argument" },
    });
    expect(config.deprecations).toEqual([
      "serviceName is deprecated and will be removed in 0.3.0. Rename it to appName.",
      "serviceVersion is deprecated and will be removed in 0.3.0. Rename it to appVersion.",
    ]);
  });

  it("ignores serviceName and serviceVersion when appName and appVersion are set", () => {
    const config = resolve(baseEnv, {
      appName: "new",
      serviceName: "old",
      appVersion: "2",
      serviceVersion: "1",
    });

    expect(config).toMatchObject({ appName: "new", appVersion: "2" });
    expect(config.deprecations).toEqual([
      "serviceName is deprecated and ignored because appName is set. Remove serviceName.",
      "serviceVersion is deprecated and ignored because appVersion is set. Remove serviceVersion.",
    ]);
  });

  it("uses VIGILON_SERVICE_NAME and VIGILON_SERVICE_VERSION when nothing above them is set, and says to rename them", () => {
    const config = resolve({
      ...baseEnv,
      VIGILON_SERVICE_NAME: "svc",
      VIGILON_SERVICE_VERSION: "1",
    });

    expect(config).toMatchObject({
      appName: "svc",
      appVersion: "1",
      sources: { appName: "VIGILON_SERVICE_NAME", appVersion: "VIGILON_SERVICE_VERSION" },
    });
    expect(config.deprecations).toEqual([
      "VIGILON_SERVICE_NAME is deprecated and will be removed in 0.3.0. Rename it to VIGILON_APP_NAME.",
      "VIGILON_SERVICE_VERSION is deprecated and will be removed in 0.3.0. Rename it to VIGILON_APP_VERSION.",
    ]);
  });

  it("names the setting that took priority over an ignored deprecated variable", () => {
    const env = { ...baseEnv, VIGILON_SERVICE_NAME: "old", VIGILON_SERVICE_VERSION: "1" };

    expect(
      resolve({ ...env, VIGILON_APP_NAME: "new", VIGILON_APP_VERSION: "2" }).deprecations,
    ).toEqual([
      "VIGILON_SERVICE_NAME is deprecated and ignored because VIGILON_APP_NAME is set. Remove VIGILON_SERVICE_NAME.",
      "VIGILON_SERVICE_VERSION is deprecated and ignored because VIGILON_APP_VERSION is set. Remove VIGILON_SERVICE_VERSION.",
    ]);
    expect(resolve(env, { appName: "api", appVersion: "2" }).deprecations).toEqual([
      "VIGILON_SERVICE_NAME is deprecated and ignored because appName is set. Remove VIGILON_SERVICE_NAME.",
      "VIGILON_SERVICE_VERSION is deprecated and ignored because appVersion is set. Remove VIGILON_SERVICE_VERSION.",
    ]);
  });

  it("does not count blank deprecated settings as set", () => {
    const config = resolve(
      { ...baseEnv, VIGILON_APP_NAME: "svc", VIGILON_SERVICE_NAME: " " },
      { serviceVersion: "" },
    );

    expect(config.deprecations).toEqual([]);
  });
});

describe("environment resolution", () => {
  it.each([
    ["VIGILON_ENVIRONMENT", { ENVIRONMENT: "x", ENV: "x", NODE_ENV: "x" }],
    ["ENVIRONMENT", { ENV: "x", NODE_ENV: "x" }],
    ["ENV", { NODE_ENV: "x" }],
    ["NODE_ENV", {}],
  ])("reads %s ahead of lower-priority variables", (name, lower) => {
    const config = resolve({
      VIGILON_API_KEY: "key",
      VIGILON_APP_NAME: "svc",
      ...lower,
      [name]: "staging",
    });

    expect(config.environment).toBe("staging");
    expect(config.sources.environment).toBe(name);
  });

  it("lets the explicit argument beat a generic ENV variable", () => {
    const config = resolve(
      { VIGILON_API_KEY: "key", VIGILON_APP_NAME: "svc", ENV: "staging" },
      { environment: "production" },
    );

    expect(config.environment).toBe("production");
  });
});

describe("app version resolution", () => {
  it("prefers VIGILON_APP_VERSION, then VIGILON_SERVICE_VERSION, then npm_package_version, then package.json", () => {
    const env = { ...baseEnv, VIGILON_APP_NAME: "svc" };

    expect(
      resolve(
        { ...env, VIGILON_APP_VERSION: "a", VIGILON_SERVICE_VERSION: "x", npm_package_version: "b" },
        {},
        packageJson,
      ).appVersion,
    ).toBe("a");
    expect(
      resolve({ ...env, VIGILON_SERVICE_VERSION: "x", npm_package_version: "b" }, {}, packageJson)
        .appVersion,
    ).toBe("x");
    expect(
      resolve({ ...env, npm_package_version: "b" }, {}, packageJson).appVersion,
    ).toBe("b");
    expect(resolve(env, {}, packageJson).appVersion).toBe("1.2.3");
    expect(resolve(env).appVersion).toBeUndefined();
  });
});

describe("validation", () => {
  it("treats blank and whitespace-only values as missing", () => {
    expect(() =>
      resolve({ VIGILON_API_KEY: "  ", VIGILON_APP_NAME: "", ENVIRONMENT: " " }),
    ).toThrow(VigilonConfigError);
  });

  it("trims the values it keeps", () => {
    const config = resolve({
      VIGILON_API_KEY: " key ",
      VIGILON_APP_NAME: " svc ",
      ENVIRONMENT: " prod ",
    });

    expect(config).toMatchObject({ apiKey: "key", appName: "svc", environment: "prod" });
  });

  it("refuses a placeholder API key from the environment", () => {
    const run = () =>
      resolve({ ...baseEnv, VIGILON_API_KEY: "[YOUR_API_KEY]" }, { appName: "api" });

    expect(run).toThrow(VigilonConfigError);
    expect(run).toThrow("the API key from VIGILON_API_KEY is a placeholder");
  });

  it("refuses a placeholder API key passed to register(), naming that source", () => {
    expect(() =>
      resolve(baseEnv, { apiKey: "  [YOUR_API_KEY]  ", appName: "api" }),
    ).toThrow("the API key from register() argument is a placeholder");
  });

  it("lists a placeholder API key alongside other missing settings", () => {
    const run = () => resolve({ VIGILON_API_KEY: "[YOUR_API_KEY]" }, { appName: "api" });

    expect(run).toThrow("is a placeholder");
    expect(run).toThrow("could not determine an environment");
  });

  it("does not validate the format of any other key", () => {
    for (const apiKey of ["key", "vg_live_abc123", "[open", "close]", "a[b]c"]) {
      expect(resolve(baseEnv, { apiKey, appName: "api" }).apiKey).toBe(apiKey);
    }
  });

  it("lists every missing setting and the sources checked in one error", () => {
    let error: unknown;
    try {
      resolve({});
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(VigilonConfigError);
    const message = (error as Error).message;
    expect(message).toContain("VIGILON_API_KEY");
    expect(message).toContain("register({ appName })");
    expect(message).toContain("VIGILON_APP_NAME");
    expect(message).toContain("VIGILON_SERVICE_NAME");
    expect(message).toContain("OTEL_SERVICE_NAME");
    expect(message).toContain('package.json "name"');
    expect(message).toContain("VIGILON_ENVIRONMENT");
    expect(message).toContain("NODE_ENV");
  });
});

describe("other settings", () => {
  const env = { ...baseEnv, VIGILON_APP_NAME: "svc" };

  it("parses VIGILON_EXCLUDED_URLS unless excludedUrls is passed explicitly", () => {
    const fromEnv = resolve({ ...env, VIGILON_EXCLUDED_URLS: " /a , /b ,, " });
    expect(fromEnv.excludedUrls).toEqual(["/a", "/b"]);

    const explicit = resolve(
      { ...env, VIGILON_EXCLUDED_URLS: "/a" },
      { excludedUrls: ["/c"] },
    );
    expect(explicit.excludedUrls).toEqual(["/c"]);

    expect(resolve(env).excludedUrls).toBeUndefined();
  });

  it("reads the endpoint from the argument, then VIGILON_OTEL_ENDPOINT", () => {
    expect(resolve({ ...env, VIGILON_OTEL_ENDPOINT: "http://env" }).otelEndpoint).toBe("http://env");
    expect(
      resolve({ ...env, VIGILON_OTEL_ENDPOINT: "http://env" }, { otelEndpoint: "http://arg" })
        .otelEndpoint,
    ).toBe("http://arg");
    expect(resolve(env).otelEndpoint).toBeUndefined();
  });

  it.each(["1", "true", "YES", " True "])("treats VIGILON_DISABLED=%j as disabled", (value) => {
    expect(isDisabled({ VIGILON_DISABLED: value })).toBe(true);
  });

  it.each(["", "0", "false", "no"])("treats VIGILON_DISABLED=%j as enabled", (value) => {
    expect(isDisabled({ VIGILON_DISABLED: value })).toBe(false);
  });

  it("recognises VIGILON_DEBUG the same way", () => {
    expect(isDebug({ VIGILON_DEBUG: "1" })).toBe(true);
    expect(isDebug({})).toBe(false);
  });

  it("describes the effective configuration with its sources", () => {
    const line = describeConfig(
      resolve({ ...env, ENVIRONMENT: "ignored" }, {}, packageJson),
      "https://ingest.vigilon.io",
    );

    expect(line).toBe(
      "Vigilon started: service.name=svc (VIGILON_APP_NAME), deployment.environment=production (VIGILON_ENVIRONMENT), service.version=1.2.3 (package.json), endpoint=https://ingest.vigilon.io",
    );
    expect(describeConfig(resolve(env), "http://x")).toContain("service.version=<unset>");
  });
});
