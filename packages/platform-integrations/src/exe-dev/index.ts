import type { Platform, ProviderInitialization } from "@tryopenbot/runtime-provider";

export const exeDevVmEnvironmentName = "EXE_DEV_VM";
export const exeDevCpuEnvironmentName = "EXE_DEV_CPU";
export const exeDevMemoryEnvironmentName = "EXE_DEV_MEMORY";
export const exeDevRemoteDirectoryEnvironmentName = "EXE_DEV_REMOTE_DIRECTORY";
export const exeDevPublicOriginEnvironmentName = "EXE_DEV_PUBLIC_ORIGIN";

const initialization: ProviderInitialization = {
  id: "exe-dev",
  label: "exe.dev",
  description: "Run the complete trusted OpenBot development stack on one persistent exe.dev VM.",
  questions: [
    {
      id: "exe-dev-vm",
      prompt: "exe.dev VM name",
      description: "Existing or desired VM name, without the .exe.xyz suffix.",
      input: "text",
      required: true,
      validation: {
        pattern: "^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$",
        message: "exe.dev VM names use lowercase letters, digits, and hyphens.",
      },
      destination: { kind: "environment", key: exeDevVmEnvironmentName },
    },
    {
      id: "exe-dev-cpu",
      prompt: "exe.dev VM CPU count",
      defaultValue: "2",
      input: "text",
      required: true,
      validation: { pattern: "^[1-9][0-9]*$", message: "CPU count must be a positive integer." },
      destination: { kind: "environment", key: exeDevCpuEnvironmentName },
    },
    {
      id: "exe-dev-memory",
      prompt: "exe.dev VM memory",
      defaultValue: "8GB",
      input: "text",
      required: true,
      validation: {
        pattern: "^[1-9][0-9]*(?:GB|G)$",
        message: "Memory must look like 8GB or 8G.",
      },
      destination: { kind: "environment", key: exeDevMemoryEnvironmentName },
    },
    {
      id: "exe-dev-remote-directory",
      prompt: "OpenBot directory on the exe.dev VM",
      defaultValue: "/home/exedev/openbot",
      input: "text",
      required: true,
      validation: { pattern: "^/[^\\r\\n\\0]+$", message: "Use an absolute Linux path." },
      destination: { kind: "environment", key: exeDevRemoteDirectoryEnvironmentName },
    },
    {
      id: "exe-dev-public-origin",
      prompt: "Public OpenBot origin (blank for the exe.xyz hostname)",
      description: "Optional custom HTTPS origin already routed to this VM.",
      input: "text",
      destination: { kind: "environment", key: exeDevPublicOriginEnvironmentName },
    },
  ],
};

export interface ExeDevPlatformConfig {
  vm?: string;
  cpu?: number;
  memory?: string;
  remoteDirectory?: string;
  publicOrigin?: string;
}

export interface ExeDevConnection {
  vm: string;
  sshHost: string;
  cpu: number;
  memory: string;
  remoteDirectory: string;
  publicOrigin: string;
}

/** Account-free exe.dev connection identity shared by runtime and Computer providers. */
export class ExeDevPlatform implements Platform {
  readonly id = "exe-dev";
  readonly initialization = initialization;

  constructor(private readonly config: ExeDevPlatformConfig = {}) {}

  connection(environment: NodeJS.ProcessEnv = process.env): ExeDevConnection {
    const vm = this.config.vm ?? environment[exeDevVmEnvironmentName]?.trim();
    const cpu = this.config.cpu ?? Number(environment[exeDevCpuEnvironmentName] ?? "2");
    const memory = this.config.memory ?? environment[exeDevMemoryEnvironmentName]?.trim() ?? "8GB";
    const remoteDirectory =
      this.config.remoteDirectory ??
      environment[exeDevRemoteDirectoryEnvironmentName]?.trim() ??
      "/home/exedev/openbot";
    if (!vm || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(vm))
      throw new Error(`${exeDevVmEnvironmentName} must be a valid exe.dev VM name`);
    if (!Number.isSafeInteger(cpu) || cpu < 1)
      throw new Error(`${exeDevCpuEnvironmentName} must be a positive integer`);
    if (!/^[1-9][0-9]*(?:GB|G)$/.test(memory))
      throw new Error(`${exeDevMemoryEnvironmentName} must look like 8GB or 8G`);
    if (!remoteDirectory.startsWith("/") || /[\r\n\0]/.test(remoteDirectory))
      throw new Error(`${exeDevRemoteDirectoryEnvironmentName} must be an absolute Linux path`);
    const configuredOrigin =
      this.config.publicOrigin ?? environment[exeDevPublicOriginEnvironmentName]?.trim();
    const publicOrigin = (configuredOrigin || `https://${vm}.exe.xyz`).replace(/\/$/, "");
    const origin = new URL(publicOrigin);
    if (origin.protocol !== "https:")
      throw new Error(`${exeDevPublicOriginEnvironmentName} must use HTTPS`);
    return { vm, sshHost: `${vm}.exe.xyz`, cpu, memory, remoteDirectory, publicOrigin };
  }
}

export const exeDevPlatform = new ExeDevPlatform();
