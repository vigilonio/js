import { setRoute } from "@vigilon/browser";
import { reportReactError } from "./report";
import { normalizeTemplate } from "./route-template";

interface RouteMatchLike {
  route: { path?: string };
}

interface RouterStateLike {
  matches: RouteMatchLike[];
  /** Errors thrown by loaders and actions, by route ID. */
  errors?: Record<string, unknown> | null;
}

/** The parts of a React Router data router this integration reads. */
export interface ReactRouterLike {
  state: RouterStateLike;
  subscribe(listener: (state: RouterStateLike) => void): () => void;
}

/**
 * Keeps the reported page in step with a React Router data router (one made
 * with `createBrowserRouter`): every error carries the route's path pattern,
 * such as `/users/:id`, rather than a path with IDs in it. Call it once after
 * creating the router; it returns a function that stops tracking.
 *
 * It also reports errors thrown by loaders and actions. React Router renders
 * the route's `errorElement` for those without throwing, so no React error
 * handler sees them. Of the error responses a loader or action throws, such
 * as a `Response` or a `data()` error, only server errors (status 500 and
 * above) are reported; a 404 or other client error response is expected
 * control flow.
 *
 * ```ts
 * const router = createBrowserRouter(routes);
 * trackReactRouter(router);
 * ```
 */
export function trackReactRouter(router: ReactRouterLike): () => void {
  let errors = router.state.errors ?? null;
  setRoute(reactRouterRouteTemplate(router.state.matches));
  reportRouteErrors(errors, null);
  return router.subscribe((state) => {
    // The route first, so the errors carry the page they happened on.
    setRoute(reactRouterRouteTemplate(state.matches));
    const previous = errors;
    errors = state.errors ?? null;
    reportRouteErrors(errors, previous);
  });
}

/** Reports the route errors that were not in the previous state. */
function reportRouteErrors(
  errors: Record<string, unknown> | null,
  previous: Record<string, unknown> | null,
): void {
  if (errors === null || errors === previous) {
    return;
  }
  for (const [routeId, error] of Object.entries(errors)) {
    if (previous?.[routeId] === error) {
      continue;
    }
    if (!isRouteErrorResponse(error)) {
      reportReactError(error, "react_error_boundary", true, null);
    } else if (error.status >= 500 && !error.internal) {
      reportReactError(serverErrorResponse(error), "react_error_boundary", true, null);
    }
  }
}

interface RouteErrorResponseLike {
  status: number;
  statusText: string;
  internal: boolean;
  data: unknown;
}

/**
 * React Router's own check for an error response: a thrown `Response`, a
 * `data()` error, or one the router makes itself (`internal`), such as its
 * 404 for a URL no route matches.
 */
function isRouteErrorResponse(error: unknown): error is RouteErrorResponseLike {
  if (typeof error !== "object" || error === null) {
    return false;
  }
  const response = error as Record<string, unknown>;
  return (
    typeof response.status === "number" &&
    typeof response.statusText === "string" &&
    typeof response.internal === "boolean" &&
    "data" in response
  );
}

/**
 * The error reported for a 5xx error response, such as a loader rethrowing a
 * failed upstream `fetch` response. An error response has no stack, so it is
 * reported by its status alone; its body is left out, since it may hold data
 * the app never meant to send.
 */
function serverErrorResponse(response: RouteErrorResponseLike): Error {
  const error = new Error(`${response.status} ${response.statusText}`.trim());
  error.name = "RouteErrorResponse";
  return error;
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
