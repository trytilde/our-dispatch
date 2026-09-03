# `@tryopenbot/git-provider`

Reconciles hosted git access for an OpenBot installation. The default GitHub implementation
brokers a GitHub App credential through Tilde (`server_token_exchange`) and reconciles two
reverse-proxy profiles: `openbot-github-rest` for the REST API and `openbot-github-git` for
authenticated git-over-HTTPS. Sandboxes and agent tools consume the persisted profile IDs; no
GitHub token is ever written into the repository or a Computer.

Deployment is idempotent. While the GitHub App authorization is pending, the lifecycle reports a
`git.github.authorization.required` event containing the owner-facing action and leaves the proxy
profile environment unset until the credential connects.

`LocalGitProvider` is the managed-computer alternative. It creates an ignored bare repository at
`.openbot/git/openbot.git`, points the checkout's `origin` at that repository, and pushes the current
branch on every reconciliation. It never provisions a forge account or exports a source-control
credential from the Computer.

`CodeStorageGitProvider` is the machine-oriented hosted alternative. Interactive setup accepts the
organization PKCS8 key transiently, creates or reuses a stable repository with optional GitHub App
or public sync, and persists only an effectively long-lived, repository-scoped read/write JWT with force-push
protection. Deployment keeps the checkout's remote URL credential-free. A host-scoped helper reads
the JWT from the managed process environment only when Git authenticates a fetch or push. The
organization key never enters OpenBot configuration or lifecycle events.
