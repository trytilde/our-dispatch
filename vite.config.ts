import { defineConfig } from "vite-plus";

export default defineConfig({
  staged: {
    "*": "vp check --fix",
  },
  fmt: {
    ignorePatterns: [
      ".agents/**",
      "**/*.md",
      "**/*.hbs",
      "configuration/secrets.enc.yaml",
      "apps/control-service/src/generated/**",
      "apps/web/src/routeTree.gen.ts",
      "packages/computer-service-proto/src/gen/**",
      "packages/ui/src/beautiful-ui/upstream/**",
    ],
  },
  lint: {
    ignorePatterns: [
      ".agents/**",
      "**/*.hbs",
      "apps/control-service/src/generated/**",
      "apps/web/src/routeTree.gen.ts",
      "packages/computer-service-proto/src/gen/**",
      "packages/ui/src/beautiful-ui/upstream/**",
    ],
    jsPlugins: [{ name: "vite-plus", specifier: "vite-plus/oxlint-plugin" }],
    rules: { "vite-plus/prefer-vite-plus-imports": "error" },
    options: { typeAware: true, typeCheck: true },
  },
});
