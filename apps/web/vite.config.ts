import { defineConfig, lazyPlugins } from "vite-plus";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const controlOrigin = `http://127.0.0.1:${process.env.OPENBOT_CONTROL_PORT || process.env.PORT || "4100"}`;
const controlProxy = () => ({ target: controlOrigin, xfwd: true });

export default defineConfig({
  base: "./",
  plugins: lazyPlugins(() => [react(), tailwindcss()]),
  server: {
    proxy: {
      "/healthz": controlProxy(),
      "/api/chat": controlProxy(),
      "/api/computer": controlProxy(),
      "/api/agents": controlProxy(),
      "/auth": controlProxy(),
    },
  },
  build: { target: "es2024" },
});
