import { defineConfig, lazyPlugins } from "vite-plus";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const controlOrigin = `http://127.0.0.1:${process.env.OPENBOT_CONTROL_PORT || process.env.PORT || "4100"}`;

export default defineConfig({
  base: "./",
  plugins: lazyPlugins(() => [react(), tailwindcss()]),
  server: {
    proxy: {
      "/healthz": controlOrigin,
      "/api/chat": controlOrigin,
      "/api/computer": controlOrigin,
      "/auth": controlOrigin,
    },
  },
  build: { target: "es2024" },
});
