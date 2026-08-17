# @tryopenbot/computer-service

The API-key-protected ConnectRPC server that runs inside an OpenBot Computer image. It executes lifecycle bundles, agent-scoped commands and file operations, desktop input and screenshots, port discovery, and VNC tunneling.

## Public API

This package is a service executable and declares no importable package exports. Its network contract is `@tryopenbot/computer-service-proto`, mounted under `/rpc`; the listening port is `COMPUTER_SERVICE_PORT` or `4101`.

Model-facing requests include an agent ID. The service validates it and defaults relative command and file operations to `/workspace/<agent-id>`. Agents otherwise share the computer's process identity and filesystem, so this directory is not a security boundary. Agent tools call this service through the generated typed client. The web and desktop applications do not call it directly.

Every RPC requires `Authorization: Bearer <COMPUTER_SERVICE_API_KEY>`. Init creates this static key only inside `configuration/secrets.enc.yaml`; deployment installs the same secret into the computer, agent service, and control service without returning it in provider outputs.

Model-controlled processes start with an allowlisted environment, so the service key and other computer-service environment variables are not inherited. `HOME` is the agent directory, allowing its seeded `.profile` to initialize Bash login shells.

Background shell commands detach from the service process and keep private job metadata, bounded output, and an exit-status file under `/workspace/.openbot/jobs`. `AwaitExec` validates the originating agent ID and can recover a running or completed job after computer-service restarts; jobs still belong to the lifetime of the Computer itself.
