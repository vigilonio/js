// CommonJS preload entrypoint for self-hosted Next.js:
// `NODE_OPTIONS='--require @vigilon/nextjs/register' next start`.
// register() is idempotent, so this preload plus a register() call from
// instrumentation.ts cannot start two SDKs.
require("./dist/server.cjs").register();
