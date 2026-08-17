/** Resolve workspace packages from their TypeScript sources while creating deploy artifacts. */
export function workspaceSourceInputOptions() {
  return {
    resolve: {
      conditionNames: ["development", "import", "node", "default"],
      extensionAlias: {
        ".js": [".ts", ".tsx", ".js"],
      },
    },
  };
}
