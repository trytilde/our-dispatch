# @tryopenbot/computer-service-provider

Computer provisioning and lifecycle adapters for the local Linux host, Microsandbox, exe.dev, and Vercel Sandbox. The public `ComputerProvider` contract contains only deployment operations used by OpenBot:

- deploy seed-once agent workspaces to the shared Computer;
- deploy the trusted development Computer;
- participate in initialization, image build, and phased deployment lifecycles.

Concrete adapters keep their low-level create, wake, exec, file, desktop, and image operations as implementation details used to fulfill those lifecycles. They are not an authored-agent API.

Programmatic screenshots and input are not provider operations. The Computer image installs the checksum-pinned Cua executable and SDK runtime; computer-service owns all model-facing GUI calls. Providers retain only owner preview routing through noVNC.

Reusable Vercel AI SDK Computer tools live separately in `@tryopenbot/computer-tools`. This package does not depend on or re-export them. Authored agents call those typed tools, which route through the capability-protected Computer service; they never import this provider package or call Microsandbox or Vercel Sandbox directly.

Builds create the Computer service image from provider-owned Handlebars assets. Vercel provisioning creates and publishes to the managed image repository; Microsandbox saves the local content-addressed Docker image into an archive, imports it into its own image cache, and disables registry pulls for Computers. A configured Vercel Sandbox provider delegates its complete development lifecycle to an internal Microsandbox provider, so development never creates Vercel Sandbox or registry resources.

`openbot dev` watches the exact Computer image inputs. A change rebuilds the content-addressed local
image and replaces the development Microsandbox when its image reference changes. Its stable ID and
named `/workspace` volume remain intact. Production Computers retain their original image and disk.

The trusted development Computer is intentionally secret-bearing. Every deployment refreshes the
fork's `.env`, `.sops.yaml`, and encrypted secrets in `/workspace/openbot/configuration`, writes its
age identity under `/workspace/.openbot/development` with mode `0400`, and installs a Bash-profile
loader that exports dotenv and decrypted SOPS values for that Linux user. Ordinary agent Computers
do not receive these files or the identity.

All agents share one Computer filesystem and process identity. Populated workspace trees from the primary `configuration/agent/` or one of its `subagents/<id>/` seed `/workspace/<id>` once. The path is a default working directory, not a security boundary.

## Public API

- `ComputerProvider`: deploys agent workspaces and the trusted development Computer through the shared lifecycle.
- `BaseComputerProvider`, `HostComputerProvider`, `MicrosandboxComputerProvider`,
  `ExeDevComputerProvider`, and `VercelSandboxComputerProvider`: concrete lifecycle implementations
  and their image configuration types. The exe.dev composition makes the Linux host itself the
  Computer with no inner isolation and publishes noVNC through the owner origin.
- `ComputerProviderError`, call context, Computer specifications, handles, image records, deployment request types, and `ComputerSeedEntry`: contracts used by lifecycle implementations. Seed entries preserve regular files and trusted-development symlinks.
- `computerServiceApiKey()` and `scopedCapability()`: validate and scope access to the Computer service.
- `computerImageAssets`, `computerImageWatchPaths()`, and `materializeComputerImageContext()`: expose provider-owned image inputs and render a build context.
- `developmentSandboxSourceFiles()` and `developmentSandboxConfigurationFiles()`: materialize trusted development Computer files.
- `randomCapability()`, `deterministicComputerId()`, `imageSourceDigest()`, `computerWorkspacePath()`, `scopeComputerExecRequest()`, `logicalComputerPath()`, and `agentWorkspaceRoot()`: deterministic lifecycle and path helpers.
