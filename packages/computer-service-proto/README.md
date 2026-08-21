# @tryopenbot/computer-service-proto

Generated ConnectRPC and protobuf types for the API-key-protected service inside an OpenBot Computer. This is an internal provider transport, not an API for the web or desktop UI.

## Public API

The root and `gen/*` subpath re-export generated `openbot.computer.v1` symbols:

- `ComputerService` describes health, lifecycle-bundle, foreground/background command and await, file, Cua catalog/call, screenshot/input compatibility, port, and VNC tunnel RPCs.
- Request and response schemas cover each RPC, with `LifecyclePhase`, lifecycle file/script/result schemas, and `Port` as shared generated types.

`ExecRequest`, `AwaitExecRequest`, `ReadFileRequest`, `WriteFileRequest`, `ScreenshotRequest`, and `InputRequest` carry the agent ID that computer-service uses for its default `/workspace/<id>` directory and background-job ownership. The package contains no hand-written public functions. Edit `proto/openbot/computer/v1/computer.proto` and run `pnpm contracts:generate`; never hand-edit `src/gen/`.

`CallCuaToolResponse` retains ordered text/image content, structured and raw JSON, verification and degradation flags, error codes, action details, and explicit action-completion state.
