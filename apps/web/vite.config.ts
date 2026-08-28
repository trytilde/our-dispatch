import { defineConfig, lazyPlugins } from "vite-plus";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const controlOrigin = `http://127.0.0.1:${process.env.OPENBOT_CONTROL_PORT || process.env.PORT || "4100"}`;
const controlProxy = () => ({ target: controlOrigin, xfwd: true });
const computerVncTarget = process.env.EXE_DEV_COMPUTER_VNC_TARGET?.trim();
const exeDevPublicOrigin = process.env.EXE_DEV_PUBLIC_ORIGIN?.trim();

export default defineConfig({
  base: "./",
  plugins: lazyPlugins(() => [react(), tailwindcss()]),
  server: {
    ...(exeDevPublicOrigin ? { allowedHosts: [new URL(exeDevPublicOrigin).hostname] } : {}),
    proxy: {
      ...(computerVncTarget
        ? {
            "/computer-vnc": {
              target: computerVncTarget,
              ws: true,
              xfwd: true,
              rewrite: (path: string) => path.replace(/^\/computer-vnc/, ""),
            },
          }
        : {}),
      "/healthz": controlProxy(),
      "/api/chat": controlProxy(),
      "/api/computer": controlProxy(),
      "/api/agents": controlProxy(),
      "/api/connectors": controlProxy(),
      "/connectors": controlProxy(),
      "/auth": controlProxy(),
    },
  },
  build: { target: "es2024" },
});
