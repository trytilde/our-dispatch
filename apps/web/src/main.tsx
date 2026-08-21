import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "@tanstack/react-router";
import "@tryopenbot/ui/openbot-ui.css";
import { initTheme } from "@tryopenbot/ui";
import { router } from "./router.js";
import { AuthGate } from "./auth-gate.js";
import { ClientWorkspaceGate } from "./workspaces.js";

initTheme();

const root = document.getElementById("root");
if (!root) throw new Error("OpenBot root element is missing");

createRoot(root).render(
  <StrictMode>
    <ClientWorkspaceGate>
      <AuthGate skipOnboarding>
        <RouterProvider router={router} />
      </AuthGate>
    </ClientWorkspaceGate>
  </StrictMode>,
);
