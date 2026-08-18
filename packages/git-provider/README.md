# `@tryopenbot/git-provider`

Reconciles hosted git access for an OpenBot installation. The default GitHub implementation
brokers a GitHub App credential through Tilde (`server_token_exchange`) and reconciles two
reverse-proxy profiles: `openbot-github-rest` for the REST API and `openbot-github-git` for
authenticated git-over-HTTPS. Sandboxes and agent tools consume the persisted profile IDs; no
GitHub token is ever written into the repository or a Computer.

Deployment is idempotent. While the GitHub App authorization is pending, the lifecycle reports a
`git.github.authorization.required` event containing the owner-facing action and leaves the proxy
profile environment unset until the credential connects.
