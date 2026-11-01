import type { SpanProcessor } from "@opentelemetry/sdk-trace-node";
import { register as registerNode, type VigilonRegisterParams } from "@vigilon/node";
import { NextRouteSpanProcessor } from "./nextRouteSpanProcessor";
import { VercelFlushSpanProcessor } from "./vercelFlushSpanProcessor";
import {
  patchServerResponseStatus,
  VercelResponseStatusProcessor,
} from "./vercelResponseStatusProcessor";

export type VigilonNextjsRegisterParams = Omit<VigilonRegisterParams, "extendSpanProcessors">;

// Shared with @vigilon/node: set once any register() variant has started an
// SDK in this process.
const NODE_REGISTER_STATE_KEY = Symbol.for("vigilon.register.started");
// Set only by this register(), so a plain @vigilon/node start followed by
// this call is told apart from a harmless second call of this one.
const NEXTJS_REGISTER_STATE_KEY = Symbol.for("vigilon.register.nextjs");

/**
 * Starts Vigilon in the Next.js Node.js runtime: @vigilon/node's register()
 * plus route attribution from Next's own spans and, on Vercel, the
 * end-of-request flush and real response status. Call it from
 * instrumentation.ts. Every parameter is optional, as with @vigilon/node.
 */
export function register(
  params: VigilonNextjsRegisterParams = {},
): ReturnType<typeof registerNode> {
  const globalState = globalThis as Record<symbol, unknown>;
  if (globalState[NODE_REGISTER_STATE_KEY] && !globalState[NEXTJS_REGISTER_STATE_KEY]) {
    console.warn(
      "Vigilon is already registered by plain @vigilon/node (most likely a NODE_OPTIONS preload of @vigilon/node/register), so the Next.js extensions (route attribution and the Vercel runtime fixes) are not active. Preload @vigilon/nextjs/register instead, or remove the preload and register from instrumentation.ts.",
    );
    return undefined;
  }
  const sdk = registerNode({
    ...params,
    extendSpanProcessors: ({ batchSpanProcessor }) => {
      const append: SpanProcessor[] = [];
      // Vercel suspends the instance as soon as the response is sent, which
      // stops the batch and export timers, so telemetry would leave late or
      // not at all. Flush when each entry span ends instead. Must come after
      // the batch processor so the ending span is already enqueued.
      if (process.env.VERCEL) {
        append.push(new VercelFlushSpanProcessor([batchSpanProcessor]));
        // Vercel's bundled Next.js runtime stamps the entry span's status
        // before the response is written (always 200), so the real status is
        // recorded from ServerResponse.writeHead instead.
        const responseStatusProcessor = new VercelResponseStatusProcessor();
        append.push(responseStatusProcessor);
        patchServerResponseStatus(responseStatusProcessor);
      }
      return { prepend: [new NextRouteSpanProcessor()], append };
    },
  });
  globalState[NEXTJS_REGISTER_STATE_KEY] = true;
  return sdk;
}
