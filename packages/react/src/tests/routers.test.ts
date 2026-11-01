import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { createMemoryRouter, data } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { reactRouterRouteTemplate, trackReactRouter } from "../react-router";
import { tanStackRouteTemplate, trackTanStackRouter } from "../tanstack-router";

const { setRoute, captureException } = vi.hoisted(() => ({
  setRoute: vi.fn(),
  captureException: vi.fn((_error: unknown, _context?: unknown) => "event-1"),
}));
vi.mock("@vigilon/browser", () => ({ setRoute, captureException }));

beforeEach(() => {
  setRoute.mockClear();
  captureException.mockClear();
});

describe("trackTanStackRouter", () => {
  function tanStackRouter(initialPath: string, loader?: () => void) {
    const rootRoute = createRootRoute();
    const routeTree = rootRoute.addChildren([
      createRoute({ getParentRoute: () => rootRoute, path: "/" }),
      createRoute({ getParentRoute: () => rootRoute, path: "/users/$id", loader }),
      createRoute({ getParentRoute: () => rootRoute, path: "/settings/" }),
    ]);
    return createRouter({
      routeTree,
      history: createMemoryHistory({ initialEntries: [initialPath] }),
    });
  }

  it("sets the current route's template, then each destination's", async () => {
    const router = tanStackRouter("/");
    const stop = trackTanStackRouter(router);
    expect(setRoute).toHaveBeenLastCalledWith("/");

    await router.navigate({ to: "/users/$id", params: { id: "42" } });
    expect(setRoute).toHaveBeenLastCalledWith("/users/$id");

    await router.navigate({ to: "/settings/" });
    expect(setRoute).toHaveBeenLastCalledWith("/settings");
    stop();
  });

  it("sets the template before the destination's loader runs", async () => {
    const seen: unknown[] = [];
    const router = tanStackRouter("/", () => {
      seen.push(setRoute.mock.lastCall?.[0]);
    });
    trackTanStackRouter(router);
    await router.navigate({ to: "/users/$id", params: { id: "7" } });
    expect(seen).toEqual(["/users/$id"]);
  });

  it("returns null for a path no route matches, so the URL is used instead", () => {
    const router = tanStackRouter("/");
    expect(tanStackRouteTemplate(router, "/nowhere/at/all")).toBeNull();
  });

  it("reads the older object-shaped getMatchedRoutes result too", () => {
    const legacy = { getMatchedRoutes: () => ({ foundRoute: { fullPath: "/teams/$teamId/" } }) };
    expect(tanStackRouteTemplate(legacy, "/teams/1/")).toBe("/teams/$teamId");
  });

  it("stops tracking when the returned function is called", async () => {
    const router = tanStackRouter("/");
    trackTanStackRouter(router)();
    setRoute.mockClear();
    await router.navigate({ to: "/users/$id", params: { id: "42" } });
    expect(setRoute).not.toHaveBeenCalled();
  });
});

describe("trackReactRouter", () => {
  const routes = [
    {
      path: "/",
      children: [
        { index: true },
        { path: "users/:id", children: [{ path: "edit" }] },
        { path: "/settings/" },
      ],
    },
  ];

  it("sets the matched path pattern now and on every navigation", async () => {
    const router = createMemoryRouter(routes, { initialEntries: ["/"] });
    const stop = trackReactRouter(router);
    expect(setRoute).toHaveBeenLastCalledWith("/");

    await router.navigate("/users/42/edit");
    expect(setRoute).toHaveBeenLastCalledWith("/users/:id/edit");

    await router.navigate("/settings");
    expect(setRoute).toHaveBeenLastCalledWith("/settings");
    stop();
    router.dispose();
  });

  it("lets an absolute nested path replace its parents' path rather than repeat it", async () => {
    const router = createMemoryRouter(
      [
        {
          path: "/teams/:teamId",
          children: [{ path: "/teams/:teamId/settings", children: [{ path: "members" }] }],
        },
      ],
      { initialEntries: ["/teams/7/settings"] },
    );
    const stop = trackReactRouter(router);
    expect(setRoute).toHaveBeenLastCalledWith("/teams/:teamId/settings");

    await router.navigate("/teams/7/settings/members");
    expect(setRoute).toHaveBeenLastCalledWith("/teams/:teamId/settings/members");
    stop();
    router.dispose();
  });

  it("clears the route when nothing matches", () => {
    expect(reactRouterRouteTemplate([])).toBeNull();
  });

  it("reports a loader error once, after setting the page it was loading", async () => {
    const error = new Error("user could not be loaded");
    const router = createMemoryRouter(
      [
        {
          path: "/",
          children: [
            { index: true },
            {
              path: "users/:id",
              loader: () => {
                throw error;
              },
            },
            { path: "settings" },
          ],
        },
      ],
      { initialEntries: ["/"] },
    );
    let routeWhenReported: unknown;
    captureException.mockImplementation(() => {
      routeWhenReported = setRoute.mock.lastCall?.[0];
      return "event-1";
    });
    const stop = trackReactRouter(router);

    await router.navigate("/users/7");
    expect(captureException).toHaveBeenCalledTimes(1);
    expect(captureException).toHaveBeenCalledWith(error, {
      mechanism: "react_error_boundary",
      handled: true,
    });
    expect(routeWhenReported).toBe("/users/:id");

    // The error stays in the router state until the next navigation; it is
    // not reported again on later state changes.
    await router.navigate("/settings");
    expect(captureException).toHaveBeenCalledTimes(1);
    stop();
    router.dispose();
  });

  it("reports a server error response, by its status, once", async () => {
    let attempt = 0;
    const router = createMemoryRouter(
      [
        {
          path: "/",
          children: [
            { path: "settings" },
            {
              path: "users/:id",
              loader: () => {
                attempt += 1;
                // A loader rethrowing a failed upstream response, then a data() error.
                if (attempt === 1) throw new Response("upstream down", { status: 503, statusText: "Service Unavailable" });
                throw data({ reason: "secret detail" }, { status: 500 });
              },
            },
          ],
        },
      ],
      { initialEntries: ["/"] },
    );
    const stop = trackReactRouter(router);

    await router.navigate("/users/7");
    expect(captureException).toHaveBeenCalledTimes(1);
    const [reported, context] = captureException.mock.calls[0] ?? [];
    expect(reported).toBeInstanceOf(Error);
    expect(reported).toMatchObject({ name: "RouteErrorResponse", message: "503 Service Unavailable" });
    expect(context).toEqual({ mechanism: "react_error_boundary", handled: true });

    await router.navigate("/settings");
    expect(captureException).toHaveBeenCalledTimes(1);

    await router.navigate("/users/8");
    expect(captureException).toHaveBeenCalledTimes(2);
    // Reported by status alone: the response body is not sent.
    const serverError = captureException.mock.calls[1]?.[0] as Error;
    expect(serverError.message).toBe("500 Internal Server Error");
    expect(serverError.cause).toBeUndefined();
    expect(Object.keys(serverError)).toEqual(["name"]);
    stop();
    router.dispose();
  });

  it("does not report error responses a loader throws on purpose, or an unmatched URL", async () => {
    const router = createMemoryRouter(
      [
        {
          path: "/",
          children: [
            {
              path: "users/:id",
              loader: () => {
                throw data("Not found", { status: 404 });
              },
            },
          ],
        },
      ],
      { initialEntries: ["/"] },
    );
    const stop = trackReactRouter(router);
    await router.navigate("/users/7");
    await router.navigate("/nowhere");
    expect(router.state.errors).not.toBeNull();
    expect(captureException).not.toHaveBeenCalled();
    stop();
    router.dispose();
  });
});
