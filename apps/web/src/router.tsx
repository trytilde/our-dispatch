import { createRootRoute, createRoute, createRouter } from "@tanstack/react-router";
import { OpenBotApp } from "./screens/openbot-app.js";
import { SettingsApp, SettingsGeneralApp, SettingsPluginsApp } from "./screens/settings-app.js";

/**
 * Modal overlays that must be reachable by redirect (OAuth returns, deep
 * links, shared URLs) are addressed through validated search params on the
 * workspace route rather than component state: `?connector=<provider>` opens
 * the connector setup dialog and `?dialog=new-agent` opens agent creation.
 */
export interface WorkspaceSearch {
  connector?: string;
  dialog?: "new-agent";
}

function validateWorkspaceSearch(search: Record<string, unknown>): WorkspaceSearch {
  return {
    ...(typeof search.connector === "string" && search.connector
      ? { connector: search.connector }
      : {}),
    ...(search.dialog === "new-agent" ? { dialog: "new-agent" as const } : {}),
  };
}

const WorkspaceApp = () => <OpenBotApp />;

const rootRoute = createRootRoute({ notFoundComponent: WorkspaceApp });
const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: WorkspaceApp,
  validateSearch: validateWorkspaceSearch,
});

const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/settings",
  component: SettingsApp,
});

const settingsGeneralRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/settings/general",
  component: SettingsGeneralApp,
});

const settingsPluginsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/settings/plugins",
  component: SettingsPluginsApp,
});

const routeTree = rootRoute.addChildren([
  indexRoute,
  settingsRoute,
  settingsGeneralRoute,
  settingsPluginsRoute,
]);

export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
