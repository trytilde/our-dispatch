import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import type { InitializationCommandRunner, InitializationPrompts } from "./initialization.js";

const canonicalRepository = "trytilde/openbot";
const canonicalRepositoryUrl = "https://github.com/trytilde/openbot.git";

export const repositoryVisibilityChoices = [
  {
    value: "private",
    label: "Private",
    description: "Create an independent private mirror of OpenBot.",
  },
  {
    value: "public",
    label: "Public",
    description: "Create a public GitHub fork of OpenBot.",
  },
] as const;

export interface RepositoryBootstrapOptions {
  destination: string;
  prompts: InitializationPrompts;
  runner: InitializationCommandRunner;
}

export async function bootstrapOpenBotRepository(
  options: RepositoryBootstrapOptions,
): Promise<void> {
  await assertEmptyDirectory(options.destination);
  await options.runner.run("git", ["--version"], { cwd: options.destination });
  await options.runner.run("gh", ["auth", "status"], { cwd: options.destination });
  const canonicalHead = parseCanonicalHead(
    await options.runner.run(
      "git",
      ["ls-remote", `git@github.com:${canonicalRepository}.git`, "HEAD"],
      { cwd: options.destination },
    ),
  );
  await assertCanonicalRevisionCompatible(options, canonicalHead);
  const owner = (
    await options.runner.run("gh", ["api", "user", "--jq", ".login"], {
      cwd: options.destination,
    })
  ).stdout.trim();
  if (!owner) throw new Error("GitHub CLI did not return the authenticated account name");

  const repositoryInput = await options.prompts.input("GitHub repository (owner/name)", {
    id: "repository-name",
    description:
      "Enter name to use your GitHub account, or owner/name to create it in an organization.",
    required: true,
  });
  const ownedRepository = parseOwnedRepository(repositoryInput, owner);
  const [repositoryOwner, name] = ownedRepository.split("/") as [string, string];
  const visibility = await options.prompts.select(
    "GitHub repository visibility",
    repositoryVisibilityChoices,
    { id: "repository-visibility" },
  );

  if (visibility === "public") {
    const organizationArguments = repositoryOwner === owner ? [] : ["--org", repositoryOwner];
    await options.runner.run(
      "gh",
      [
        "repo",
        "fork",
        canonicalRepository,
        ...organizationArguments,
        "--fork-name",
        name,
        "--clone=false",
      ],
      { cwd: options.destination },
    );
  } else if (visibility === "private") {
    await createPrivateMirror(options, ownedRepository);
  } else {
    throw new Error(`Unsupported GitHub repository visibility: ${visibility}`);
  }

  await options.runner.run("gh", ["repo", "clone", ownedRepository, "."], {
    cwd: options.destination,
  });
  await ensureUpstreamRemote(options);
  await assertClonedRepository(options, ownedRepository, canonicalHead);
}

function parseCanonicalHead(result: { stdout: string }): string {
  const head = result.stdout.trim().split(/\s+/)[0];
  if (!head || !/^[0-9a-f]{40}$/i.test(head))
    throw new Error("Git did not return the canonical OpenBot HEAD revision");
  return head;
}

async function assertCanonicalRevisionCompatible(
  options: RepositoryBootstrapOptions,
  canonicalHead: string,
): Promise<void> {
  const encoded = (
    await options.runner.run(
      "gh",
      [
        "api",
        `repos/${canonicalRepository}/contents/package.json?ref=${canonicalHead}`,
        "--jq",
        ".content",
      ],
      { cwd: options.destination },
    )
  ).stdout.trim();
  let manifest: { name?: unknown };
  try {
    manifest = JSON.parse(Buffer.from(encoded.replace(/\s/g, ""), "base64").toString("utf8")) as {
      name?: unknown;
    };
  } catch {
    throw new Error("GitHub returned an invalid canonical OpenBot package manifest");
  }
  if (manifest.name !== "@tryopenbot/workspace")
    throw new Error(
      "The canonical OpenBot repository is older than this CLI; publish the matching OpenBot source before running init",
    );
}

function parseOwnedRepository(input: string, defaultOwner: string): string {
  const value = input.trim();
  const parts = value.split("/");
  const [owner, name] = parts.length === 1 ? [defaultOwner, parts[0]] : parts;
  if (
    parts.length > 2 ||
    !owner ||
    !name ||
    !/^[A-Za-z0-9-]+$/.test(owner) ||
    !/^[A-Za-z0-9._-]+$/.test(name) ||
    name === "." ||
    name === ".."
  )
    throw new Error("GitHub repository must use name or owner/name format");
  return `${owner}/${name}`;
}

async function ensureUpstreamRemote(options: RepositoryBootstrapOptions): Promise<void> {
  try {
    const existing = (
      await options.runner.run("git", ["remote", "get-url", "upstream"], {
        cwd: options.destination,
      })
    ).stdout.trim();
    if (existing.replace(/\.git$/, "") === canonicalRepositoryUrl.replace(/\.git$/, "")) return;
    throw new Error("Existing upstream remote does not point to canonical OpenBot");
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === "Existing upstream remote does not point to canonical OpenBot"
    )
      throw error;
  }
  await options.runner.run("git", ["remote", "add", "upstream", canonicalRepositoryUrl], {
    cwd: options.destination,
  });
}

async function assertEmptyDirectory(destination: string): Promise<void> {
  const entries = await readdir(destination);
  if (entries.length)
    throw new Error(
      "openbot init requires a completely empty directory, including no hidden files",
    );
}

async function createPrivateMirror(
  options: RepositoryBootstrapOptions,
  ownedRepository: string,
): Promise<void> {
  await options.runner.run("gh", ["repo", "create", ownedRepository, "--private"], {
    cwd: options.destination,
  });
  const temporaryDirectory = await mkdtemp(resolve(tmpdir(), "openbot-mirror-"));
  const bareRepository = resolve(temporaryDirectory, "openbot.git");
  try {
    await options.runner.run("git", ["clone", "--bare", canonicalRepositoryUrl, bareRepository], {
      cwd: options.destination,
    });
    await options.runner.run("git", ["push", "--mirror", `git@github.com:${ownedRepository}.git`], {
      cwd: bareRepository,
    });
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

async function assertClonedRepository(
  options: RepositoryBootstrapOptions,
  ownedRepository: string,
  canonicalHead: string,
): Promise<void> {
  const manifest = JSON.parse(
    await readFile(resolve(options.destination, "package.json"), "utf8"),
  ) as { name?: unknown };
  if (manifest.name !== "@tryopenbot/workspace")
    throw new Error("The cloned repository is not a compatible OpenBot workspace");
  const clonedHead = (
    await options.runner.run("git", ["rev-parse", "HEAD"], { cwd: options.destination })
  ).stdout.trim();
  if (clonedHead !== canonicalHead)
    throw new Error("The cloned repository does not match the OpenBot revision verified by init");
  const origin = (
    await options.runner.run("git", ["remote", "get-url", "origin"], {
      cwd: options.destination,
    })
  ).stdout.trim();
  const upstream = (
    await options.runner.run("git", ["remote", "get-url", "upstream"], {
      cwd: options.destination,
    })
  ).stdout.trim();
  if (!origin.includes(ownedRepository))
    throw new Error(`OpenBot origin does not point to ${ownedRepository}`);
  if (upstream.replace(/\.git$/, "") !== canonicalRepositoryUrl.replace(/\.git$/, ""))
    throw new Error("OpenBot upstream does not point to the canonical repository");
}
