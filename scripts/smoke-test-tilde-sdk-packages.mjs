import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const temporaryDirectory = mkdtempSync(join(tmpdir(), "tilde-sdk-package-smoke-"));
const packages = [
  "packages/api-client",
  "packages/sdk",
  "packages/sdk-claude-code",
  "packages/sdk-codex",
  "packages/sdk-cursor",
  "packages/sdk-gemini-cli",
  "packages/sdk-opencode",
  "packages/sdk-react",
  "packages/sdk-vercel-ai-node",
  "packages/sdk-vercel-ai-react",
];

try {
  const tarballs = new Map();
  for (const packageDirectory of packages) {
    const packageJson = JSON.parse(
      readFileSync(resolve(repositoryRoot, packageDirectory, "package.json")),
    );
    const filesBeforePack = new Set(readdirSync(temporaryDirectory));
    run("pnpm", ["--filter", packageJson.name, "pack", "--pack-destination", temporaryDirectory]);
    const newTarballs = readdirSync(temporaryDirectory).filter(
      (file) => file.endsWith(".tgz") && !filesBeforePack.has(file),
    );
    if (newTarballs.length !== 1) {
      throw new Error(`Expected one tarball for ${packageJson.name}, found ${newTarballs.length}.`);
    }
    tarballs.set(packageJson.name, resolve(temporaryDirectory, newTarballs[0]));
  }

  const apiClientTarball = tarballs.get("@trytilde/api-client");
  const sdkTarball = tarballs.get("@trytilde/sdk");
  const sdkReactTarball = tarballs.get("@trytilde/sdk-react");
  writeFileSync(
    resolve(temporaryDirectory, "package.json"),
    `${JSON.stringify(
      {
        name: "tilde-sdk-package-smoke",
        private: true,
        type: "module",
        scripts: {
          build: "tsc",
          start: "node dist/index.js",
        },
        dependencies: {
          "@ai-sdk/mcp": "1.0.59",
          "@trytilde/api-client": `file:${apiClientTarball}`,
          "@trytilde/sdk": `file:${sdkTarball}`,
          "@trytilde/sdk-claude-code": `file:${tarballs.get("@trytilde/sdk-claude-code")}`,
          "@trytilde/sdk-codex": `file:${tarballs.get("@trytilde/sdk-codex")}`,
          "@trytilde/sdk-cursor": `file:${tarballs.get("@trytilde/sdk-cursor")}`,
          "@trytilde/sdk-gemini-cli": `file:${tarballs.get("@trytilde/sdk-gemini-cli")}`,
          "@trytilde/sdk-opencode": `file:${tarballs.get("@trytilde/sdk-opencode")}`,
          "@trytilde/sdk-react": `file:${sdkReactTarball}`,
          "@trytilde/sdk-vercel-ai-node": `file:${tarballs.get("@trytilde/sdk-vercel-ai-node")}`,
          "@trytilde/sdk-vercel-ai-react": `file:${tarballs.get("@trytilde/sdk-vercel-ai-react")}`,
          ai: "6.0.220",
          react: "19.2.0",
          "react-dom": "19.2.0",
        },
        devDependencies: {
          "@types/json-schema": "7.0.15",
          typescript: "5.9.3",
        },
        pnpm: {
          overrides: {
            "@trytilde/api-client": `file:${apiClientTarball}`,
            "@trytilde/sdk": `file:${sdkTarball}`,
            "@trytilde/sdk-react": `file:${sdkReactTarball}`,
          },
        },
      },
      null,
      2,
    )}\n`,
  );
  writeFileSync(
    resolve(temporaryDirectory, "tsconfig.json"),
    `${JSON.stringify(
      {
        compilerOptions: {
          module: "NodeNext",
          moduleResolution: "NodeNext",
          outDir: "dist",
          strict: true,
          target: "ES2022",
        },
        include: ["index.ts"],
      },
      null,
      2,
    )}\n`,
  );
  writeFileSync(
    resolve(temporaryDirectory, "index.ts"),
    `import { whoami } from "@trytilde/api-client/generated";
import {
  createClient,
  createTildeGrpcReverseProxy,
  reverseProxyPath,
} from "@trytilde/sdk";
import { isJsonObject } from "@trytilde/sdk/json";
import { normalizeClaudeCodeHook } from "@trytilde/sdk-claude-code";
import { normalizeCodexHook } from "@trytilde/sdk-codex";
import { normalizeCursorHook } from "@trytilde/sdk-cursor";
import { normalizeGeminiCliHook } from "@trytilde/sdk-gemini-cli";
import { normalizeOpenCodeHook } from "@trytilde/sdk-opencode";
import {
  parseChatKitRequestBody,
  type ChatKitRequestBody,
} from "@trytilde/sdk-vercel-ai-node";

const client = createClient({
  apiKey: "smoke-test",
  baseUrl: "https://api.trytilde.ai",
  orgId: "example",
  orgSubdomain: false,
  teamId: "team-id",
});
const proxy = createTildeGrpcReverseProxy({
  client,
  profileId: "profile-id",
});
const body: ChatKitRequestBody = parseChatKitRequestBody({
  messages: [],
  session_id: "session-id",
});

if (
  proxy.endpoint !== "https://api.trytilde.ai" ||
  typeof whoami !== "function" ||
  !isJsonObject({ ok: true }) ||
  normalizeClaudeCodeHook({}) !== null ||
  normalizeCodexHook({}) !== null ||
  normalizeCursorHook({}) !== null ||
  normalizeGeminiCliHook({}) !== null ||
  normalizeOpenCodeHook({}) !== null ||
  body.messages.length !== 0 ||
  reverseProxyPath({ profileId: "profile-id", teamId: "team-id" }) !==
    "/api/v1/team/team-id/reverse-proxy/profile-id"
) {
  throw new Error("Packed SDK runtime smoke test failed.");
}
console.log("Packed SDK consumer smoke test passed.");
`,
  );

  run("pnpm", ["install", "--frozen-lockfile=false"], temporaryDirectory);
  run("pnpm", ["build"], temporaryDirectory);
  run("pnpm", ["start"], temporaryDirectory);
} finally {
  rmSync(temporaryDirectory, { force: true, recursive: true });
}

function run(command, args, cwd = repositoryRoot) {
  const result = spawnSync(command, args, {
    cwd,
    env: process.env,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} exited with status ${result.status}`);
  }
}
