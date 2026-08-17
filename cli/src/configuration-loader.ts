import { pathToFileURL } from "node:url";

/** Load a fork-owned TypeScript configuration under an explicit environment. */
export async function loadConfigurationModule<T>(
  path: string,
  environment: NodeJS.ProcessEnv = process.env,
): Promise<T> {
  const previous = new Map<string, string | undefined>();
  for (const [name, value] of Object.entries(environment)) {
    previous.set(name, process.env[name]);
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  try {
    return (await import(pathToFileURL(path).href)) as T;
  } finally {
    for (const [name, value] of previous) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}
