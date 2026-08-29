// Publication of the OpenBot desktop app to the shared app-updates bucket.
//
// Official publication is upstream-only; forks select their own bucket (ADR-0028).
// A fork inherits every tracked file, so the official bucket name sitting in this
// file is precisely why the refusal has to be code here rather than a comment in a
// config file. A fork publishes its own builds by setting the bucket override.
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import arg from "arg";
import { optionalEnvironment } from "../../environment-overrides.js";
import { isUpstreamRepository, remoteRepository, upstreamRepository } from "../../upstream.js";
import { repositoryRoot } from "../../workspace.js";

/**
 * The shared Tilde bucket, defined in infrastructure-terraform/shared/app_updates.tf.
 * It already carries Tilde's own Electrobun feed under `desktop/`, so OpenBot takes a
 * nested prefix; public read is granted to `desktop/*` and therefore covers it.
 */
const officialUpdatesBucket = "tilde-app-updates-prod";
/**
 * Reverse-DNS of the publisher, not of the product or platform. A fork may override it
 * through OPENBOT_APP_ID.
 */
const officialAppId = "ai.trytilde.openbot";
const officialUpdatesPrefix = "desktop/openbot";
const officialUpdatesRegion = "us-east-1";

export const releaseSubcommands: readonly (readonly [string, string])[] = [
  ["build", "Package, sign, and notarize this platform's artifacts (--platform)"],
  ["publish", "Upload this platform's artifacts and its release entry (--yes)"],
  ["manifest", "Rebuild version.json from the entries already in the bucket (--yes)"],
  ["status", "Print the resolved publication target and what the bucket holds"],
];

/** The Electron appId, defaulting to the official identifier. */
export function resolveAppId(): string {
  return optionalEnvironment("OPENBOT_APP_ID") ?? officialAppId;
}

export interface PublicationTarget {
  readonly bucket: string;
  readonly prefix: string;
  readonly baseUrl: string;
  readonly channel: string;
}

/**
 * Resolves where a release goes. Everything is overridable because a fork must be able
 * to publish its own builds; nothing here is required for a fork that never publishes.
 */
export function resolveTarget(channel: string): PublicationTarget {
  const bucket = optionalEnvironment("OPENBOT_DESKTOP_UPDATES_BUCKET") ?? officialUpdatesBucket;
  const root = optionalEnvironment("OPENBOT_DESKTOP_UPDATES_PREFIX") ?? officialUpdatesPrefix;
  const region = optionalEnvironment("AWS_REGION") ?? officialUpdatesRegion;
  const prefix = `${trimSlashes(root)}/${channel}`;
  const configuredBase = optionalEnvironment("OPENBOT_DESKTOP_UPDATES_BASE_URL");
  const base = configuredBase
    ? trimTrailingSlash(configuredBase)
    : `https://${bucket}.s3.${region}.amazonaws.com`;
  return { bucket, prefix, baseUrl: `${base}/${prefix}`, channel };
}

/** Returns a refusal message when this checkout must not publish, otherwise undefined. */
export function publicationGuard(root: string, bucket: string): string | undefined {
  if (bucket !== officialUpdatesBucket) return undefined;
  if (isUpstreamRepository(root)) return undefined;
  const found = remoteRepository(root) ?? "an unknown remote";
  return (
    `Refusing to publish to the official OpenBot updates bucket from ${found}.\n` +
    `Desktop publication belongs to ${upstreamRepository} (ADR-0028). To publish a fork's ` +
    `own builds, create a bucket for it and set OPENBOT_DESKTOP_UPDATES_BUCKET, plus ` +
    `optionally OPENBOT_DESKTOP_UPDATES_PREFIX and OPENBOT_DESKTOP_UPDATES_BASE_URL.`
  );
}

export interface ManifestArtifact {
  readonly kind: string;
  readonly file: string;
  readonly url: string;
  readonly size: number;
  readonly sha512: string;
}

export interface ManifestPlatform {
  readonly version: string;
  readonly releasedAt: string;
  readonly signed: boolean;
  readonly notarized: boolean;
  readonly artifacts: readonly ManifestArtifact[];
}

export interface UpdateManifest {
  readonly schemaVersion: 1;
  readonly channel: string;
  readonly generatedAt: string;
  readonly platforms: Readonly<Record<string, ManifestPlatform>>;
}

/** The `${os}-${arch}` key a client looks itself up under, matching Node's own naming. */
export function platformKey(platform: string, architecture: string): string {
  return `${platform}-${architecture}`;
}

const artifactKinds: readonly (readonly [RegExp, string])[] = [
  [/\.dmg$/i, "dmg"],
  [/\.zip$/i, "zip"],
  [/\.AppImage$/i, "appimage"],
  [/\.deb$/i, "deb"],
];

/** Undefined for anything that is not a user-installable artifact: blockmaps, feeds, builder debris. */
export function artifactKind(file: string): string | undefined {
  return artifactKinds.find(([pattern]) => pattern.test(file))?.[1];
}

/**
 * Builds one platform's manifest entry. Pure so the merge behaviour is testable without
 * packaging an Electron app or reaching S3.
 */
export function platformEntry(input: {
  readonly version: string;
  readonly releasedAt: string;
  readonly signed: boolean;
  readonly notarized: boolean;
  readonly baseUrl: string;
  readonly files: readonly {
    readonly name: string;
    readonly size: number;
    readonly sha512: string;
  }[];
}): ManifestPlatform {
  const artifacts = input.files.flatMap((file) => {
    const kind = artifactKind(file.name);
    if (!kind) return [];
    return [
      {
        kind,
        file: file.name,
        url: `${input.baseUrl}/${file.name}`,
        size: file.size,
        sha512: file.sha512,
      },
    ];
  });
  return {
    version: input.version,
    releasedAt: input.releasedAt,
    signed: input.signed,
    notarized: input.notarized,
    artifacts,
  };
}

/**
 * Merges the per-platform entries already in the bucket into one manifest. Keyed by
 * platform rather than carrying a single global version so a mac-only release reports
 * honestly instead of claiming linux moved too.
 */
export function mergeManifest(input: {
  readonly channel: string;
  readonly generatedAt: string;
  readonly entries: readonly (readonly [string, ManifestPlatform])[];
}): UpdateManifest {
  const platforms: Record<string, ManifestPlatform> = {};
  for (const [key, entry] of [...input.entries].sort(([a], [b]) => a.localeCompare(b)))
    platforms[key] = entry;
  return {
    schemaVersion: 1,
    channel: input.channel,
    generatedAt: input.generatedAt,
    platforms,
  };
}

/** The subset of object storage this command needs, injectable so tests stay offline. */
export interface ObjectStore {
  putFile(localPath: string, key: string): Promise<void>;
  putText(text: string, key: string, contentType: string): Promise<void>;
  list(prefix: string): Promise<readonly string[]>;
  getText(key: string): Promise<string | undefined>;
}

export async function runRelease(argv: readonly string[], store?: ObjectStore): Promise<number> {
  const [subcommand, ...rest] = argv;
  const root = repositoryRoot();
  const options = arg(
    {
      "--platform": String,
      "--channel": String,
      "--yes": Boolean,
      "--overwrite": Boolean,
    },
    { argv: [...rest], permissive: true },
  );
  const channel = options["--channel"] ?? "latest";
  const target = resolveTarget(channel);

  switch (subcommand) {
    case "build":
      return runBuild(root, target, options["--platform"]);
    case "publish":
      return runPublish(root, target, {
        confirmed: Boolean(options["--yes"]),
        overwrite: Boolean(options["--overwrite"]),
        store,
      });
    case "manifest":
      return runManifest(root, target, Boolean(options["--yes"]), store);
    case "status":
      return runStatus(root, target, store);
    default:
      console.error(
        `Usage: openbot desktop release <${releaseSubcommands.map(([name]) => name).join("|")}>`,
      );
      return 1;
  }
}

interface SigningSetup {
  readonly signed: boolean;
  readonly notarized: boolean;
  readonly environment: Record<string, string>;
  readonly warnings: readonly string[];
}

/**
 * Resolves macOS signing from the environment.
 *
 * Missing credentials produce an unsigned build rather than a failure: a fork with no
 * Apple Developer account should still be able to produce artifacts. The cost is that
 * an upstream run with misconfigured secrets also succeeds, so the outcome is recorded
 * in the manifest as `signed: false` where it is visible rather than silent.
 */
export function resolveSigning(environment: NodeJS.ProcessEnv = process.env): SigningSetup {
  const certificate = environment.MACOS_CERTIFICATE;
  const certificatePassword = environment.MACOS_CERTIFICATE_PASSWORD;
  const apiKey = environment.APPLE_API_KEY;
  const apiKeyId = environment.APPLE_API_KEY_ID;
  const apiIssuer = environment.APPLE_API_ISSUER;
  const warnings: string[] = [];

  if (!certificate || !certificatePassword) {
    warnings.push(
      "No MACOS_CERTIFICATE/MACOS_CERTIFICATE_PASSWORD: building UNSIGNED. macOS Gatekeeper will refuse these artifacts.",
    );
    return {
      signed: false,
      notarized: false,
      environment: { CSC_IDENTITY_AUTO_DISCOVERY: "false" },
      warnings,
    };
  }

  const directory = mkdtempSync(join(tmpdir(), "openbot-signing-"));
  const certificatePath = join(directory, "certificate.p12");
  writeFileSync(certificatePath, Buffer.from(certificate, "base64"), { mode: 0o600 });
  const resolved: Record<string, string> = {
    CSC_LINK: certificatePath,
    CSC_KEY_PASSWORD: certificatePassword,
  };

  if (!apiKey || !apiKeyId || !apiIssuer) {
    warnings.push(
      "Signing without notarization: APPLE_API_KEY, APPLE_API_KEY_ID, and APPLE_API_ISSUER are required to notarize.",
    );
    return { signed: true, notarized: false, environment: resolved, warnings };
  }

  const apiKeyPath = join(directory, "AuthKey.p8");
  writeFileSync(apiKeyPath, Buffer.from(apiKey, "base64"), { mode: 0o600 });
  return {
    signed: true,
    notarized: true,
    environment: {
      ...resolved,
      APPLE_API_KEY: apiKeyPath,
      APPLE_API_KEY_ID: apiKeyId,
      APPLE_API_ISSUER: apiIssuer,
    },
    warnings,
  };
}

async function runBuild(
  root: string,
  target: PublicationTarget,
  requested: string | undefined,
): Promise<number> {
  const platform = requested ?? hostPlatform();
  if (platform !== "mac" && platform !== "linux") {
    console.error(`Unsupported --platform ${platform}. OpenBot desktop releases mac and linux.`);
    return 1;
  }
  const signing = platform === "mac" ? resolveSigning() : unsignedLinux();
  for (const warning of signing.warnings) console.warn(`! ${warning}`);
  // Both of these are command-line overrides rather than package.json config. Notarization,
  // so an ordinary `openbot desktop package` never tries to reach Apple; appId, because
  // electron-builder strips `${env.*}` macros out of that field and would otherwise bake a
  // literal `env.OPENBOTAPPID` into the bundle.
  //
  // Passed without a `--` separator: pnpm forwards `--` through to the script verbatim
  // rather than consuming it, and electron-builder then ignores everything after it.
  const overrides = [`-c.appId=${resolveAppId()}`];
  if (signing.notarized) overrides.push("-c.mac.notarize=true");
  const code = await spawnProcess(
    "pnpm",
    [
      "--filter",
      "@tryopenbot/desktop",
      platform === "mac" ? "release:mac" : "release:linux",
      ...overrides,
    ],
    root,
    {
      ...signing.environment,
      // Interpolated into latest-*.yml by the generic publish provider.
      OPENBOT_DESKTOP_UPDATES_URL: target.baseUrl,
    },
  );
  if (code !== 0) return code;
  // Written after the build because electron-builder creates `out/`, and read by
  // `publish` so the manifest reports what the build actually did rather than
  // re-deriving it from an environment the publish step may not share.
  const statePath = releaseStatePath(root);
  mkdirSync(dirname(statePath), { recursive: true });
  writeFileSync(
    statePath,
    `${JSON.stringify({ signed: signing.signed, notarized: signing.notarized })}\n`,
  );
  return 0;
}

/** Linux artifacts are not code-signed; recording that keeps the manifest honest. */
function unsignedLinux(): SigningSetup {
  return { signed: false, notarized: false, environment: {}, warnings: [] };
}

async function runPublish(
  root: string,
  target: PublicationTarget,
  options: { confirmed: boolean; overwrite: boolean; store?: ObjectStore },
): Promise<number> {
  const guard = publicationGuard(root, target.bucket);
  if (guard) {
    console.error(guard);
    return 1;
  }
  if (!options.confirmed) {
    console.error(
      `Would upload to s3://${target.bucket}/${target.prefix}/. Publishing is public. Re-run with --yes.`,
    );
    return 1;
  }

  const version = desktopVersion(root);
  const outputDirectory = join(desktopAppDirectory(root), "out");
  if (!existsSync(outputDirectory)) {
    console.error(
      `No build output at ${outputDirectory}. Run \`openbot desktop release build\` first.`,
    );
    return 1;
  }
  const files = readdirSync(outputDirectory)
    .filter((name) => artifactKind(name) !== undefined)
    .map((name) => {
      const path = join(outputDirectory, name);
      return { name, path, size: statSync(path).size, sha512: sha512Of(path) };
    });
  if (files.length === 0) {
    console.error(`No publishable artifacts in ${outputDirectory}.`);
    return 1;
  }

  const store = options.store ?? awsCliStore(target.bucket);
  const key = platformKey(hostNodePlatform(), process.arch);
  const entryKey = `${target.prefix}/release-${key}.json`;
  if (!options.overwrite) {
    const existing = await store.getText(entryKey);
    if (existing) {
      const parsed = JSON.parse(existing) as ManifestPlatform;
      if (parsed.version === version) {
        console.error(
          `${key} version ${version} is already published. Re-run with --overwrite to replace it.`,
        );
        return 1;
      }
    }
  }

  const state = readReleaseState(root);
  const entry = platformEntry({
    version,
    releasedAt: new Date().toISOString(),
    signed: state.signed,
    notarized: state.notarized,
    baseUrl: target.baseUrl,
    files,
  });

  for (const file of files) {
    console.log(`upload ${file.name}`);
    await store.putFile(file.path, `${target.prefix}/${file.name}`);
  }
  // The electron-builder feeds ride along unused today so that adopting electron-updater
  // later is a client change rather than a re-run of every release.
  for (const feed of readdirSync(outputDirectory).filter((name) => /^latest.*\.yml$/.test(name))) {
    console.log(`upload ${feed}`);
    await store.putFile(join(outputDirectory, feed), `${target.prefix}/${feed}`);
  }
  await store.putText(`${JSON.stringify(entry, null, 2)}\n`, entryKey, "application/json");
  console.log(`published ${key} ${version} to s3://${target.bucket}/${target.prefix}/`);
  return 0;
}

async function runManifest(
  root: string,
  target: PublicationTarget,
  confirmed: boolean,
  injected?: ObjectStore,
): Promise<number> {
  const guard = publicationGuard(root, target.bucket);
  if (guard) {
    console.error(guard);
    return 1;
  }
  const store = injected ?? awsCliStore(target.bucket);
  const keys = await store.list(`${target.prefix}/`);
  const entryKeys = keys.filter((key) => /release-[^/]+\.json$/.test(key));
  const entries: (readonly [string, ManifestPlatform])[] = [];
  for (const key of entryKeys) {
    const text = await store.getText(key);
    if (!text) continue;
    const platform = /release-([^/]+)\.json$/.exec(key)?.[1];
    if (!platform) continue;
    entries.push([platform, JSON.parse(text) as ManifestPlatform]);
  }
  if (entries.length === 0) {
    console.error(`No release entries under s3://${target.bucket}/${target.prefix}/.`);
    return 1;
  }
  const manifest = mergeManifest({
    channel: target.channel,
    generatedAt: new Date().toISOString(),
    entries,
  });
  const body = `${JSON.stringify(manifest, null, 2)}\n`;
  if (!confirmed) {
    console.log(body);
    console.error("Re-run with --yes to upload this manifest.");
    return 1;
  }
  await store.putText(body, `${target.prefix}/version.json`, "application/json");
  console.log(`published version.json for ${Object.keys(manifest.platforms).join(", ")}`);
  return 0;
}

async function runStatus(
  root: string,
  target: PublicationTarget,
  injected?: ObjectStore,
): Promise<number> {
  console.log(`bucket   s3://${target.bucket}/${target.prefix}/`);
  console.log(`base url ${target.baseUrl}`);
  console.log(`version  ${desktopVersion(root)} (from apps/desktop/package.json)`);
  const guard = publicationGuard(root, target.bucket);
  if (guard) {
    console.log("publish  refused");
    console.error(guard);
    return 1;
  }
  console.log("publish  allowed");
  const store = injected ?? awsCliStore(target.bucket);
  const manifest = await store.getText(`${target.prefix}/version.json`);
  console.log(manifest ? `\n${manifest}` : "\nNo version.json published yet.");
  return 0;
}

/** Records what the build actually did so `publish` reports it rather than guessing. */
function releaseStatePath(root: string): string {
  return join(desktopAppDirectory(root), "out", ".openbot-release-state.json");
}

function readReleaseState(root: string): { signed: boolean; notarized: boolean } {
  try {
    return JSON.parse(readFileSync(releaseStatePath(root), "utf8")) as {
      signed: boolean;
      notarized: boolean;
    };
  } catch {
    return { signed: false, notarized: false };
  }
}

export function desktopAppDirectory(root: string): string {
  return join(root, optionalEnvironment("OPENBOT_DESKTOP_DIR") ?? "apps/desktop");
}

function desktopVersion(root: string): string {
  const manifest = JSON.parse(
    readFileSync(join(desktopAppDirectory(root), "package.json"), "utf8"),
  ) as { version?: string };
  if (!manifest.version) throw new Error("apps/desktop/package.json has no version");
  return manifest.version;
}

function sha512Of(path: string): string {
  return createHash("sha512").update(readFileSync(path)).digest("base64");
}

function hostPlatform(): string {
  return process.platform === "darwin"
    ? "mac"
    : process.platform === "linux"
      ? "linux"
      : "unsupported";
}

function hostNodePlatform(): string {
  return process.platform;
}

function trimSlashes(value: string): string {
  return value.replace(/^\/+|\/+$/g, "");
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

/**
 * S3 access through the AWS CLI rather than an SDK dependency. The CLI is present on
 * every GitHub runner and this package already shells out to pnpm and npx; adding the
 * S3 SDK would grow a published npm package for one command most installs never run.
 */
function awsCliStore(bucket: string): ObjectStore {
  const run = async (args: readonly string[]): Promise<{ code: number; stdout: string }> => {
    const child = spawn("aws", [...args], { stdio: ["ignore", "pipe", "inherit"] });
    let stdout = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    return await new Promise((resolvePromise, rejectPromise) => {
      child.on("error", (error) =>
        rejectPromise(new Error(`Failed to start the aws CLI: ${error.message}`)),
      );
      child.on("exit", (code) => resolvePromise({ code: code ?? 1, stdout }));
    });
  };
  const require0 = async (args: readonly string[]): Promise<string> => {
    const result = await run(args);
    if (result.code !== 0) throw new Error(`aws ${args.join(" ")} failed with ${result.code}`);
    return result.stdout;
  };
  return {
    async putFile(localPath, key) {
      await require0(["s3", "cp", localPath, `s3://${bucket}/${key}`]);
    },
    async putText(text, key, contentType) {
      const directory = mkdtempSync(join(tmpdir(), "openbot-upload-"));
      const path = join(directory, basename(key));
      writeFileSync(path, text);
      await require0(["s3", "cp", path, `s3://${bucket}/${key}`, "--content-type", contentType]);
    },
    async list(prefix) {
      const output = await require0([
        "s3api",
        "list-objects-v2",
        "--bucket",
        bucket,
        "--prefix",
        prefix,
        "--query",
        "Contents[].Key",
        "--output",
        "text",
      ]);
      return output.trim() === "" || output.trim() === "None" ? [] : output.trim().split(/\s+/);
    },
    async getText(key) {
      const directory = mkdtempSync(join(tmpdir(), "openbot-download-"));
      const path = join(directory, "object");
      const result = await run(["s3", "cp", `s3://${bucket}/${key}`, path]);
      if (result.code !== 0) return undefined;
      return readFileSync(path, "utf8");
    },
  };
}

function spawnProcess(
  command: string,
  args: readonly string[],
  cwd: string,
  environment: Record<string, string>,
): Promise<number> {
  const child = spawn(command, [...args], {
    cwd,
    stdio: "inherit",
    env: { ...process.env, ...environment },
  });
  return new Promise<number>((resolvePromise, rejectPromise) => {
    child.on("error", (error) =>
      rejectPromise(new Error(`Failed to start ${command}: ${error.message}`)),
    );
    child.on("exit", (code, signal) => {
      if (signal) {
        process.kill(process.pid, signal);
        return;
      }
      resolvePromise(code ?? 0);
    });
  });
}
