# Sandbox files

Agent workspace seeds live only under `configuration/agent/sandbox/workspace/**` for the primary or `configuration/agent/subagents/<id>/sandbox/workspace/**` for a subagent. Global `configuration/sandbox/` assets and bootstrap scripts are unsupported. One computer, filesystem, and process identity are shared across agents. A populated seed is copied once to `/workspace/<id>` and commands default there; empty seeds create no directory. These directories are organizational, not isolation boundaries, and editing a seed never changes an already deployed directory automatically.

The authored folder is called `sandbox/` only for compatibility with Eve's project layout. OpenBot runtime terminology uses Computer, including computer-service, computer-provider, environment variables, and tool filenames.

OpenBot does not load secrets from repository configuration or copy control-plane credentials into an agent workspace. Workspace seeds must not contain OpenAI, Tilde, Vercel, database, or other control-plane credentials.
