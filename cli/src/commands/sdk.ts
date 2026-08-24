import { resolve } from "node:path";
import { repositoryRoot } from "../paths.js";
import { runChecked } from "../processes.js";

type SdkAction = "publish" | "refresh" | "smoke" | "validate";

export async function runSdk(args: readonly string[]): Promise<void> {
  if (args.includes("--help") || args.includes("-h") || args.length === 0) {
    process.stdout.write(sdkHelpText());
    return;
  }
  const [action, ...rest] = args;
  if (!isSdkAction(action)) throw new Error(sdkUsage());
  if (action === "publish") {
    if (rest.length !== 1 || rest[0] !== "--yes")
      throw new Error("Publishing Tilde SDK packages requires `openbot sdk publish --yes`.");
    await runScript("scripts/publish-tilde-sdk-packages.mjs", "node");
    return;
  }
  if (rest.length > 0) throw new Error(sdkUsage());

  if (action === "refresh") {
    await runScript("scripts/sync-tilde-openapi.ts");
    await validateOpenApi();
    await runTildePackages("build");
    await runTildePackages("test");
    return;
  }
  if (action === "validate") {
    await validateOpenApi();
    await runTildePackages("build");
    await runScript("scripts/validate-tilde-sdk-packages.mjs", "node");
    return;
  }
  await runTildePackages("build");
  await runScript("scripts/smoke-test-tilde-sdk-packages.mjs", "node");
}

export function sdkHelpText(): string {
  return `${sdkUsage()}

Commands:
  refresh   Regenerate the Tilde API client, then build and test the SDK
  validate  Validate the OpenAPI surface and built package artifacts
  smoke     Pack the SDK and run a clean consumer smoke test
  publish   Publish missing SDK package versions; requires --yes
`;
}

function sdkUsage(): string {
  return "Usage: openbot sdk <refresh|validate|smoke|publish>";
}

async function validateOpenApi(): Promise<void> {
  await runScript("scripts/validate-tilde-openapi-surface.ts");
}

async function runTildePackages(script: "build" | "test"): Promise<void> {
  await runChecked("pnpm", ["--filter", "@trytilde/*", script], process.env);
}

async function runScript(path: string, runtime = "pnpm"): Promise<void> {
  const absolutePath = resolve(repositoryRoot, path);
  const args = runtime === "node" ? [absolutePath] : ["exec", "tsx", absolutePath];
  await runChecked(runtime, args, process.env);
}

function isSdkAction(value: string | undefined): value is SdkAction {
  return value === "publish" || value === "refresh" || value === "validate" || value === "smoke";
}
