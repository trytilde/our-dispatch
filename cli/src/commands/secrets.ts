import arg from "arg";
import { setEncryptedSecret, unsetEncryptedSecret } from "../initialization.js";
import { repositoryRoot } from "../paths.js";
import { inkPrompts } from "./init.js";

export interface SecretsRunResult {
  json: boolean;
  operation: "set" | "unset";
  name: string;
}

export async function runSecrets(argv: readonly string[]): Promise<SecretsRunResult> {
  const parsed = arg(
    { "--stdin": Boolean, "--json": Boolean, "--description": String },
    { argv: [...argv] },
  );
  const [operation, name, ...extra] = parsed._;
  if (!operation || !name || extra.length)
    throw new Error(
      "Usage: openbot secrets <set|unset> NAME [--description TEXT] [--stdin] [--json]",
    );
  if (operation === "set") {
    const description = parsed["--description"]?.trim();
    if (!description) throw new Error("secrets set requires --description TEXT");
    const fromStdin = parsed["--stdin"] ?? false;
    if (!fromStdin && (!process.stdin.isTTY || !process.stdout.isTTY))
      throw new Error("Non-interactive secret input requires --stdin");
    const value = fromStdin
      ? await readSecretFromStdin()
      : await inkPrompts.input(`Value for ${name}`, { secret: true, required: true });
    await setEncryptedSecret(repositoryRoot, name, value, {
      description,
      prompts: process.stdin.isTTY && process.stdout.isTTY ? inkPrompts : undefined,
    });
    return { json: parsed["--json"] ?? false, operation, name };
  }
  if (operation === "unset") {
    if (parsed["--stdin"] || parsed["--description"])
      throw new Error("--stdin and --description are only valid with secrets set");
    await unsetEncryptedSecret(repositoryRoot, name, {
      prompts: process.stdin.isTTY && process.stdout.isTTY ? inkPrompts : undefined,
    });
    return { json: parsed["--json"] ?? false, operation, name };
  }
  throw new Error(`Unknown secrets operation: ${operation}`);
}

async function readSecretFromStdin(): Promise<string> {
  let value = "";
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) value += chunk;
  if (value.endsWith("\n")) value = value.slice(0, -1);
  if (!value) throw new Error("Secret input on stdin must not be empty");
  return value;
}
