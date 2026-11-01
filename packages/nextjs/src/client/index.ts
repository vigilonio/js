/**
 * @vigilon/nextjs: the browser half, for instrumentation-client.ts and client
 * components. Re-exports @vigilon/react, with an init() that links events to
 * the server request that rendered the page.
 */
export * from "@vigilon/react";
export { init, linkServerTrace } from "./init";
export { useReportError } from "./use-report-error";
