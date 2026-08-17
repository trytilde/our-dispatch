import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { chmod, mkdir, readFile, rename, rm, symlink, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { Code, ConnectError } from "@connectrpc/connect";
import {
  LifecyclePhase,
  type ApplyLifecycleBundleRequest,
} from "@tryopenbot/computer-service-proto";
import { materializeFileTemplate } from "@tryopenbot/utilities";

const execute = promisify(execFile);
const manifestTemplate = fileURLToPath(new URL("./assets/manifest.json.hbs", import.meta.url));
function lifecycleRoot(): string {
  return resolve(process.env.COMPUTER_LIFECYCLE_ROOT ?? "/opt/openbot/lifecycle");
}

function currentRoot(): string {
  return resolve(lifecycleRoot(), "current");
}

interface StoredLifecycle {
  digest: string;
  scripts: Array<{ id: string; path: string; phases: number[] }>;
}

function childPath(base: string, path: string): string {
  if (!path || isAbsolute(path))
    throw new ConnectError("Lifecycle paths must be non-empty and relative", Code.InvalidArgument);
  const target = resolve(base, path);
  const child = relative(base, target);
  if (child.startsWith("..") || isAbsolute(child))
    throw new ConnectError("Lifecycle path escapes its root", Code.InvalidArgument);
  return target;
}

async function stored(): Promise<StoredLifecycle | undefined> {
  try {
    return JSON.parse(
      await readFile(resolve(currentRoot(), "manifest.json"), "utf8"),
    ) as StoredLifecycle;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

export async function lifecycleDigest(): Promise<string> {
  return (await stored())?.digest ?? "";
}

export async function applyLifecycleBundle(request: ApplyLifecycleBundleRequest): Promise<boolean> {
  if (!/^sha256:[a-f0-9]{64}$/.test(request.digest)) {
    throw new ConnectError("Lifecycle digest must be a sha256 digest", Code.InvalidArgument);
  }
  if (request.digest !== lifecycleBundleDigest(request))
    throw new ConnectError(
      "Lifecycle bundle digest does not match its content",
      Code.InvalidArgument,
    );
  if ((await stored())?.digest === request.digest) return false;

  const root = lifecycleRoot();
  const bundleName = request.digest.slice("sha256:".length);
  const bundles = resolve(root, "bundles");
  const target = resolve(bundles, bundleName);
  const staging = resolve(root, `.staging-${process.pid}-${Date.now()}`);
  await mkdir(bundles, { recursive: true, mode: 0o700 });
  await mkdir(staging, { recursive: true, mode: 0o700 });
  try {
    for (const file of request.files) {
      const target = childPath(staging, file.path);
      const actual = createHash("sha256").update(file.content).digest("hex");
      if (file.sha256 && file.sha256 !== actual)
        throw new ConnectError(
          `Lifecycle file digest mismatch: ${file.path}`,
          Code.InvalidArgument,
        );
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, file.content, { mode: file.mode || 0o644 });
      if (file.mode) await chmod(target, file.mode);
    }
    const scripts = request.scripts.map((script) => {
      childPath(staging, script.path);
      return { id: script.id, path: script.path, phases: script.phases };
    });
    await materializeFileTemplate(
      manifestTemplate,
      resolve(staging, "manifest.json"),
      {
        DIGEST: JSON.stringify(request.digest),
        SCRIPTS: JSON.stringify(scripts, undefined, 2),
      },
      { mode: 0o600 },
    );
    await rm(target, { recursive: true, force: true });
    await rename(staging, target);
    const nextLink = resolve(root, `.current-${process.pid}-${Date.now()}`);
    await symlink(`bundles/${bundleName}`, nextLink);
    await rename(nextLink, resolve(root, "current"));
    return true;
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    throw error;
  }
}

export async function runLifecycle(
  phase: LifecyclePhase,
  expectedDigest: string,
  signal?: AbortSignal,
): Promise<Array<{ scriptId: string; exitCode: number; stdout: string; stderr: string }>> {
  if (phase === LifecyclePhase.UNSPECIFIED)
    throw new ConnectError("Lifecycle phase is required", Code.InvalidArgument);
  const manifest = await stored();
  if (!manifest)
    throw new ConnectError("No lifecycle bundle is installed", Code.FailedPrecondition);
  if (expectedDigest && expectedDigest !== manifest.digest)
    throw new ConnectError("Lifecycle bundle digest changed", Code.FailedPrecondition);

  const results: Array<{ scriptId: string; exitCode: number; stdout: string; stderr: string }> = [];
  for (const script of manifest.scripts.filter((candidate) => candidate.phases.includes(phase))) {
    const path = childPath(currentRoot(), script.path);
    try {
      const result = await execute("bash", [path], {
        cwd: "/workspace",
        env: process.env,
        signal,
        timeout: 20 * 60 * 1000,
        maxBuffer: 16 * 1024 * 1024,
      });
      results.push({
        scriptId: script.id,
        exitCode: 0,
        stdout: result.stdout,
        stderr: result.stderr,
      });
    } catch (error) {
      const failure = error as Error & { code?: number | string; stdout?: string; stderr?: string };
      results.push({
        scriptId: script.id,
        exitCode: typeof failure.code === "number" ? failure.code : 1,
        stdout: failure.stdout ?? "",
        stderr: failure.stderr ?? failure.message,
      });
      break;
    }
  }
  return results;
}

export function lifecycleBundleDigest(
  request: Pick<ApplyLifecycleBundleRequest, "files" | "scripts">,
): string {
  const hash = createHash("sha256");
  for (const file of [...request.files].sort((left, right) =>
    left.path.localeCompare(right.path),
  )) {
    hash
      .update("file\0")
      .update(file.path)
      .update("\0")
      .update(String(file.mode))
      .update("\0")
      .update(file.content)
      .update("\0");
  }
  for (const script of [...request.scripts].sort((left, right) =>
    left.id.localeCompare(right.id),
  )) {
    hash.update("script\0").update(script.id).update("\0").update(script.path).update("\0");
    for (const phase of [...script.phases].sort((left, right) => left - right))
      hash.update(String(phase)).update(",");
    hash.update("\0");
  }
  return `sha256:${hash.digest("hex")}`;
}
