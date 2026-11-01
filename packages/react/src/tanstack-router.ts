import { setRoute } from "@vigilon/browser";
import { normalizeTemplate } from "./route-template";

interface MatchedRoute {
  fullPath?: string;
}

/** The parts of a TanStack Router instance this integration reads. */
export interface TanStackRouterLike {
  state: { location: { pathname: string } };
  getMatchedRoutes(pathname: string): unknown;
  subscribe(
    eventType: "onBeforeLoad",
    listener: (event: { toLocation: { pathname: string } }) => void,
  ): () => void;
}

/**
 * Keeps the reported page in step with TanStack Router: every error carries
 * the template of the route being shown, such as `/users/$id`, rather than a
 * path with IDs in it. The template is set before the route's loaders run, so
 * a loader error carries the page it was loading. Call it once after creating
 * the router; it returns a function that stops tracking.
 *
 * ```ts
 * const router = createRouter({ routeTree });
 * trackTanStackRouter(router);
 * ```
 */
export function trackTanStackRouter(router: TanStackRouterLike): () => void {
  const update = (pathname: string) => setRoute(tanStackRouteTemplate(router, pathname));
  update(router.state.location.pathname);
  return router.subscribe("onBeforeLoad", (event) => update(event.toLocation.pathname));
}

/**
 * The template of the route that matches `pathname`, or null when none does
 * (a not-found page then falls back to the URL path).
 */
export function tanStackRouteTemplate(
  router: Pick<TanStackRouterLike, "getMatchedRoutes">,
  pathname: string,
): string | null {
  const matched = router.getMatchedRoutes(pathname);
  // Current versions return [matchedRoutes, rawParams, foundRoute]; earlier
  // ones returned { foundRoute }.
  const foundRoute = (
    Array.isArray(matched) ? matched[2] : (matched as { foundRoute?: unknown } | null)?.foundRoute
  ) as MatchedRoute | undefined;
  const template = foundRoute?.fullPath;
  return typeof template === "string" && template !== "" ? normalizeTemplate(template) : null;
}
