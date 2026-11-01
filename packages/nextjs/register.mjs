// Preload entrypoint for self-hosted Next.js:
// `NODE_OPTIONS='--import @vigilon/nextjs/register' next start`.
import { register as registerLoaderHook } from "node:module";

// Lets OpenTelemetry's instrumentations intercept ESM imports as well as
// require(), as @vigilon/node/register does.
registerLoaderHook("@opentelemetry/instrumentation/hook.mjs", import.meta.url);

// register() is idempotent, so this preload plus a register() call from
// instrumentation.ts cannot start two SDKs.
const { register } = await import("./dist/server.mjs");
register();
