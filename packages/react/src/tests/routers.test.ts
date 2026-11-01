import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { createMemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { reactRouterRouteTemplate, trackReactRouter } from "../react-router";
import { tanStackRouteTemplate, trackTanStackRouter } from "../tanstack-router";

const { setRoute } = vi.hoisted(() => ({ setRoute: vi.fn() }));
vi.mock("@vigilon/browser", () => ({ setRoute }));

beforeEach(() => {
  setRoute.mockClear();
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
});
