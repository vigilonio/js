// CommonJS preload entrypoint: `node --require @vigilon/node/register app.js`.
// Only works for CommonJS apps; prefer `--import`, which handles both formats.
// register() is idempotent (guards on Symbol.for("vigilon.register.started")),
// so a preload plus an in-process register() call cannot start two SDKs.
require("./dist/cjs/index.js").registerFromEnv();
