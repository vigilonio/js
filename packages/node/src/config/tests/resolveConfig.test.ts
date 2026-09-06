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

describe("service name resolution", () => {
  it("prefers the explicit register() argument over everything", () => {
    const config = resolve(
      { ...baseEnv, VIGILON_SERVICE_NAME: "from-env" },
      { serviceName: "explicit" },
      packageJson,
    );

    expect(config.serviceName).toBe("explicit");
    expect(config.sources.serviceName).toBe("register() argument");
  });

  it.each([
    ["VIGILON_SERVICE_NAME", { OTEL_SERVICE_NAME: "x", npm_package_name: "x" }],
    ["OTEL_SERVICE_NAME", { npm_package_name: "x", AWS_LAMBDA_FUNCTION_NAME: "x" }],
    ["npm_package_name", { AWS_LAMBDA_FUNCTION_NAME: "x" }],
    ["AWS_LAMBDA_FUNCTION_NAME", {}],
  ])("reads %s ahead of lower-priority variables", (name, lower) => {
    const config = resolve({ ...baseEnv, ...lower, [name]: "winner" }, {}, packageJson);

    expect(config.serviceName).toBe("winner");
    expect(config.sources.serviceName).toBe(name);
  });

  it("falls back to the nearest package.json name", () => {
    const config = resolve(baseEnv, {}, packageJson);

    expect(config.serviceName).toBe("@acme/api");
    expect(config.sources.serviceName).toBe("package.json");
  });

  it("reports the name as missing when the nearest package.json has only a version", () => {
    const versionOnly = () => ({ version: "1.2.3", path: "/app/package.json" });

    expect(() => resolve(baseEnv, {}, versionOnly)).toThrow(/VIGILON_SERVICE_NAME/);

    const config = resolve({ ...baseEnv, VIGILON_SERVICE_NAME: "svc" }, {}, versionOnly);
    expect(config.serviceVersion).toBe("1.2.3");
    expect(config.sources.serviceVersion).toBe("package.json");
  });

  it("does not read package.json when the environment covers name and version", () => {
    let reads = 0;
    resolve(
      { ...baseEnv, VIGILON_SERVICE_NAME: "svc", VIGILON_SERVICE_VERSION: "1" },
      {},
      () => {
        reads += 1;
        return undefined;
      },
    );

    expect(reads).toBe(0);
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
      VIGILON_SERVICE_NAME: "svc",
      ...lower,
      [name]: "staging",
    });

    expect(config.environment).toBe("staging");
    expect(config.sources.environment).toBe(name);
  });

  it("lets the explicit argument beat a generic ENV variable", () => {
    const config = resolve(
      { VIGILON_API_KEY: "key", VIGILON_SERVICE_NAME: "svc", ENV: "staging" },
      { environment: "production" },
    );

    expect(config.environment).toBe("production");
  });
});

describe("service version resolution", () => {
  it("prefers VIGILON_SERVICE_VERSION, then npm_package_version, then package.json", () => {
    const env = { ...baseEnv, VIGILON_SERVICE_NAME: "svc" };

    expect(
      resolve({ ...env, VIGILON_SERVICE_VERSION: "a", npm_package_version: "b" }, {}, packageJson)
        .serviceVersion,
    ).toBe("a");
    expect(
      resolve({ ...env, npm_package_version: "b" }, {}, packageJson).serviceVersion,
    ).toBe("b");
    expect(resolve(env, {}, packageJson).serviceVersion).toBe("1.2.3");
    expect(resolve(env).serviceVersion).toBeUndefined();
  });
});

describe("validation", () => {
  it("treats blank and whitespace-only values as missing", () => {
    expect(() =>
      resolve({ VIGILON_API_KEY: "  ", VIGILON_SERVICE_NAME: "", ENVIRONMENT: " " }),
    ).toThrow(VigilonConfigError);
  });

  it("trims the values it keeps", () => {
    const config = resolve({
      VIGILON_API_KEY: " key ",
      VIGILON_SERVICE_NAME: " svc ",
      ENVIRONMENT: " prod ",
    });

    expect(config).toMatchObject({ apiKey: "key", serviceName: "svc", environment: "prod" });
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
    expect(message).toContain("VIGILON_SERVICE_NAME");
    expect(message).toContain("OTEL_SERVICE_NAME");
    expect(message).toContain('package.json "name"');
    expect(message).toContain("VIGILON_ENVIRONMENT");
    expect(message).toContain("NODE_ENV");
  });
});

describe("other settings", () => {
  const env = { ...baseEnv, VIGILON_SERVICE_NAME: "svc" };

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
      "Vigilon started: service.name=svc (VIGILON_SERVICE_NAME), deployment.environment=production (VIGILON_ENVIRONMENT), service.version=1.2.3 (package.json), endpoint=https://ingest.vigilon.io",
    );
    expect(describeConfig(resolve(env), "http://x")).toContain("service.version=<unset>");
  });
});
