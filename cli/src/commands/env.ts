import arg from "arg";
import { setEnvironmentValue, unsetEnvironmentValue } from "../initialization.js";
import { repositoryRoot } from "../paths.js";

export interface EnvironmentRunResult {
  json: boolean;
  operation: "set" | "unset";
  name: string;
}

export async function runEnvironment(argv: readonly string[]): Promise<EnvironmentRunResult> {
  const parsed = arg({ "--description": String, "--json": Boolean }, { argv: [...argv] });
  const [operation, name, value, ...extra] = parsed._;
  if (!operation || !name || extra.length)
    throw new Error("Usage: openbot env <set NAME VALUE --description TEXT|unset NAME> [--json]");
  if (operation === "set") {
    if (!value) throw new Error("env set requires a non-empty VALUE");
    const description = parsed["--description"]?.trim();
    if (!description) throw new Error("env set requires --description TEXT");
    await setEnvironmentValue(repositoryRoot, name, value, description);
    return { json: parsed["--json"] ?? false, operation, name };
  }
  if (operation === "unset") {
    if (value || parsed["--description"])
      throw new Error("env unset accepts only the environment variable name");
    await unsetEnvironmentValue(repositoryRoot, name);
    return { json: parsed["--json"] ?? false, operation, name };
  }
  throw new Error(`Unknown env operation: ${operation}`);
}
