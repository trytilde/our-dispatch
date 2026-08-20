import { createRootRoute, createRoute, createRouter } from "@tanstack/react-router";
import { OpenBotApp } from "./screens/openbot-app.js";
import { SettingsApp } from "./screens/settings-app.js";

const rootRoute = createRootRoute({ notFoundComponent: OpenBotApp });
const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: OpenBotApp,
});

const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/settings",
  component: SettingsApp,
});

const routeTree = rootRoute.addChildren([indexRoute, settingsRoute]);

export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
