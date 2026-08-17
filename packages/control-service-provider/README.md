# @tryopenbot/control-service-provider

Build and deployment providers for the control service plus web UI. Local deployment installs a user service; Vercel deployment creates a provider-owned Build Output artifact and serves static UI through Vercel's CDN.

## Public API

### Functions

- `deploymentUrl(output)` extracts and validates the deployment URL from Vercel CLI output.
- `ensureVercelProject(runner, context, project)` ensures the configured Vercel project exists before artifact deployment.
- `installLocalService(context, runner, options)` writes a private environment file and installs systemd on Linux or launchd on macOS.
- `waitForHealth(request, origin)` polls `/healthz` until the installed local service is ready or times out.

`processRunner` is the default `CommandRunner` implementation for child processes.

### Classes

- `LocalControlServiceProvider` builds and installs the local control/web service and accepts `LocalControlServiceProviderOptions`.
- `VercelControlServiceProvider` builds and deploys the prebuilt Vercel control/web artifact and accepts `VercelControlServiceProviderOptions`.

Both service providers leave development startup to OpenBot's watched Hono process. The Vercel
adapter performs its check but skips artifact creation, project configuration, and remote deployment
when `DeploymentContext.devMode` is `true`.

### Critical interfaces

- `ControlServiceProvider` combines `Buildable`, `Deployable`, and `InitializableProvider`.
- `CommandRunner` and `CommandResult` are injectable command boundaries used by provider code and tests.

Generated Vercel configuration and entrypoint files come from Handlebars assets in the Vercel provider folder; no repository-root `vercel.json` is required.
