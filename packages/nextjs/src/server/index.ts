/**
 * @vigilon/nextjs/server: the Node.js runtime half of @vigilon/nextjs, for
 * instrumentation.ts. Re-exports @vigilon/node (recordException,
 * withJobMonitor, and the rest), with a Next.js-aware register().
 */
export * from "@vigilon/node";
export { register, type VigilonNextjsRegisterParams } from "./register";
export {
  HTTP_ROUTE_ATTRIBUTE,
  NEXT_ROUTE_ATTRIBUTE,
  NextRouteSpanProcessor,
} from "./nextRouteSpanProcessor";
export { type Flushable, VercelFlushSpanProcessor } from "./vercelFlushSpanProcessor";
export {
  HTTP_RESPONSE_STATUS_CODE_ATTRIBUTE,
  patchServerResponseStatus,
  VercelResponseStatusProcessor,
} from "./vercelResponseStatusProcessor";
