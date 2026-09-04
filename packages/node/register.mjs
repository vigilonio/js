// ESM preload entrypoint: `node --import @vigilon/node/register app.mjs`.
import { register as registerLoaderHook } from "node:module";

// ESM imports never go through require(), so OpenTelemetry's require-hook
// instrumentation cannot patch modules such as express or pg when the app is
// ESM. Registering OpenTelemetry's loader hook here — before the SDK and the
// app are loaded — lets the same instrumentations intercept ESM imports.
// module.register() needs Node 20.6+, which is this package's engine floor.
registerLoaderHook("@opentelemetry/instrumentation/hook.mjs", import.meta.url);

// register() is idempotent (guards on Symbol.for("vigilon.register.started")),
// so a preload plus an in-process register() call cannot start two SDKs.
const { registerFromEnv } = await import("./dist/esm/index.mjs");
registerFromEnv();
