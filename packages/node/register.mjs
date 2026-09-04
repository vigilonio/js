import { register } from "./dist/esm/index.mjs";

const apiKey = process.env.VIGILON_API_KEY;
const serviceName = process.env.VIGILON_SERVICE_NAME;
const environment = process.env.VIGILON_ENVIRONMENT;
const serviceVersion = process.env.VIGILON_SERVICE_VERSION;
const excludedUrls = process.env.VIGILON_EXCLUDED_URLS?.split(",")
  .map((url) => url.trim())
  .filter(Boolean);

if (!apiKey || !serviceName || !environment) {
  throw new Error(
    "Vigilon register preload requires VIGILON_API_KEY, VIGILON_SERVICE_NAME, and VIGILON_ENVIRONMENT.",
  );
}

if (!serviceVersion) {
  console.warn(
    "Vigilon recommends setting VIGILON_SERVICE_VERSION to track new deployments and generate better insights.",
  );
}

// register() is idempotent (guards on Symbol.for("vigilon.register.started")),
// so a preload plus an in-process register() call cannot start two SDKs.
register({
  apiKey,
  serviceName,
  environment,
  serviceVersion,
  excludedUrls,
});
