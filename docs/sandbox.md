# Sandbox files and secrets

Files under `configuration/sandbox/assets/` are copied into `/workspace` whenever a sandbox starts or resumes. `configuration/sandbox/bootstrap.sh`, when present, runs afterward from `/workspace` on every start. Make it idempotent and fail fast.

Declare sandbox-only secret names in `configuration/sandbox/secrets.example.yaml`. Provide values through `OPENBOT_SANDBOX_SECRET_<NAME>` in hosted environments or ignored `configuration/sandbox/secrets.yaml` locally. Only declared names are passed to bootstrap and subsequent shell commands.

Never declare OpenAI, Tilde, GitHub, Vercel, database, or other control-plane credentials merely to make them available in a sandbox. Create a narrow application-specific credential instead. Plaintext `configuration/sandbox/secrets.yaml` is ignored; portable SOPS encryption is not part of v1.
