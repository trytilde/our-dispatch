import { createHash } from "node:crypto";
import { cp, mkdir, readFile, readdir, rm } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { materializeFileTemplate } from "@tryopenbot/utilities";

const providerAssetDirectory = fileURLToPath(new URL("./assets/", import.meta.url));

export const computerImageAssets = {
  bootstrap: resolve(providerAssetDirectory, "bootstrap.sh.hbs"),
  containerfile: resolve(providerAssetDirectory, "Containerfile.hbs"),
  desktopSession: resolve(providerAssetDirectory, "desktop-session.sh.hbs"),
  desktopWallpaper: resolve(providerAssetDirectory, "desktop-wallpaper.svg.hbs"),
  developmentProfile: resolve(providerAssetDirectory, "development-profile.sh.hbs"),
  developmentSetup: resolve(providerAssetDirectory, "development-setup.sh.hbs"),
  marker: resolve(providerAssetDirectory, "marker.hbs"),
  openboxConfig: resolve(providerAssetDirectory, "openbox-rc.xml.hbs"),
  openbotBrowser: resolve(providerAssetDirectory, "openbot-browser.sh.hbs"),
  openbotBrowserDesktop: resolve(providerAssetDirectory, "openbot-browser.desktop.hbs"),
  openbotFilesDesktop: resolve(providerAssetDirectory, "openbot-files.desktop.hbs"),
  openbotVnc: resolve(providerAssetDirectory, "openbot-vnc.html.hbs"),
  start: resolve(providerAssetDirectory, "start.sh.hbs"),
  tint2: resolve(providerAssetDirectory, "tint2rc.hbs"),
} as const;

const sourcePaths = [
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "tsconfig.base.json",
  "tsconfig.browser.json",
  "tsconfig.node.json",
  "tsdown.browser.config.ts",
  "tsdown.node.config.ts",
  "apps/computer-service/package.json",
  "apps/computer-service/src",
  "apps/computer-service/tsconfig.json",
  "apps/computer-service/tsdown.config.ts",
  "packages/computer-service-proto/package.json",
  "packages/computer-service-proto/src",
  "packages/computer-service-proto/tsconfig.json",
  "packages/utilities/package.json",
  "packages/utilities/src",
  "packages/utilities/tsconfig.json",
] as const;

/** Exact repository inputs whose changes invalidate the shared Computer image. */
export function computerImageWatchPaths(repositoryRoot: string): string[] {
  return [...sourcePaths.map((path) => resolve(repositoryRoot, path)), providerAssetDirectory];
}

export interface MaterializedComputerImageContext {
  contextDirectory: string;
  dockerfilePath: string;
  sourceDigest: string;
}

/** Copies the exact image inputs into an ignored, reproducible Docker context. */
export async function materializeComputerImageContext(
  repositoryRoot: string,
  providerId: string,
): Promise<MaterializedComputerImageContext> {
  const contextDirectory = resolve(
    repositoryRoot,
    ".openbot-deploy",
    "computer-images",
    providerId,
    "context",
  );
  await rm(contextDirectory, { recursive: true, force: true });
  await mkdir(contextDirectory, { recursive: true });

  for (const path of sourcePaths) {
    const destination = resolve(contextDirectory, path);
    await mkdir(dirname(destination), { recursive: true });
    await cp(resolve(repositoryRoot, path), destination, { recursive: true });
  }

  const assetDestination = resolve(
    contextDirectory,
    "packages/computer-service-provider/src/base/assets",
  );
  await mkdir(assetDestination, { recursive: true });
  await Promise.all([
    materializeFileTemplate(
      computerImageAssets.bootstrap,
      resolve(assetDestination, "bootstrap.sh"),
    ),
    materializeFileTemplate(
      computerImageAssets.containerfile,
      resolve(assetDestination, "Containerfile"),
    ),
    materializeFileTemplate(
      computerImageAssets.desktopSession,
      resolve(assetDestination, "desktop-session.sh"),
    ),
    materializeFileTemplate(
      computerImageAssets.desktopWallpaper,
      resolve(assetDestination, "desktop-wallpaper.svg"),
    ),
    materializeFileTemplate(
      computerImageAssets.developmentSetup,
      resolve(assetDestination, "development-setup.sh"),
    ),
    materializeFileTemplate(
      computerImageAssets.developmentProfile,
      resolve(assetDestination, "development-profile.sh"),
    ),
    materializeFileTemplate(
      computerImageAssets.openbotVnc,
      resolve(assetDestination, "openbot-vnc.html"),
    ),
    materializeFileTemplate(
      computerImageAssets.openboxConfig,
      resolve(assetDestination, "openbox-rc.xml"),
    ),
    materializeFileTemplate(
      computerImageAssets.openbotBrowser,
      resolve(assetDestination, "openbot-browser.sh"),
    ),
    materializeFileTemplate(
      computerImageAssets.openbotBrowserDesktop,
      resolve(assetDestination, "openbot-browser.desktop"),
    ),
    materializeFileTemplate(
      computerImageAssets.openbotFilesDesktop,
      resolve(assetDestination, "openbot-files.desktop"),
    ),
    materializeFileTemplate(computerImageAssets.start, resolve(assetDestination, "start.sh")),
    materializeFileTemplate(computerImageAssets.tint2, resolve(assetDestination, "tint2rc")),
  ]);

  return {
    contextDirectory,
    dockerfilePath: resolve(assetDestination, "Containerfile"),
    sourceDigest: await directoryDigest(contextDirectory),
  };
}

async function directoryDigest(root: string): Promise<string> {
  const hash = createHash("sha256");
  for (const path of await filesBelow(root)) {
    hash
      .update(relative(root, path))
      .update("\0")
      .update(await readFile(path))
      .update("\0");
  }
  return `sha256:${hash.digest("hex")}`;
}

async function filesBelow(root: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = resolve(root, entry.name);
    if (entry.isDirectory()) files.push(...(await filesBelow(path)));
    else if (entry.isFile()) files.push(path);
  }
  return files.sort();
}
