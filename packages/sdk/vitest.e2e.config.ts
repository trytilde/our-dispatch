import { defineConfig } from "vite-plus";

export default defineConfig({
  test: {
    environment: "node",
    hookTimeout: 120_000,
    include: ["e2e/**/*.test.ts"],
    sequence: { concurrent: false },
    testTimeout: 120_000,
  },
});
