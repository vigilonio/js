import { setRoute } from "@vigilon/browser";
import { normalizeTemplate } from "./route-template";

interface RouteMatchLike {
  route: { path?: string };
}

/** The parts of a React Router data router this integration reads. */
export interface ReactRouterLike {
  state: { matches: RouteMatchLike[] };
  subscribe(listener: (state: { matches: RouteMatchLike[] }) => void): () => void;
}

/**
 * Keeps the reported page in step with a React Router data router (one made
 * with `createBrowserRouter`): every error carries the route's path pattern,
 * such as `/users/:id`, rather than a path with IDs in it. Call it once after
 * creating the router; it returns a function that stops tracking.
 *
 * ```ts
 * const router = createBrowserRouter(routes);
 * trackReactRouter(router);
 * ```
 */
export function trackReactRouter(router: ReactRouterLike): () => void {
  setRoute(reactRouterRouteTemplate(router.state.matches));
  return router.subscribe((state) => setRoute(reactRouterRouteTemplate(state.matches)));
}

/**
 * Joins the path patterns of the matched routes into one template, or returns
 * null when nothing matched. A nested route may give an absolute path, which
 * React Router requires to start with its parents' full path, so it replaces
 * the template built so far rather than extending it.
 */
export function reactRouterRouteTemplate(matches: readonly RouteMatchLike[]): string | null {
  if (matches.length === 0) {
    return null;
  }
  let segments: string[] = [];
  for (const match of matches) {
    const path = match.route.path ?? "";
    if (path.startsWith("/")) {
      segments = [];
    }
    const segment = path.replace(/^\/+|\/+$/g, "");
    if (segment !== "") {
      segments.push(segment);
    }
  }
  return normalizeTemplate(`/${segments.join("/")}`);
}
