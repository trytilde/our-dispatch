import { createServer } from "node:http";
import { connectNodeAdapter } from "@connectrpc/connect-node";
import { registerComputerService } from "./services.js";
import { shutdownCuaWorkers } from "./cua.js";

const port = Number.parseInt(process.env.COMPUTER_SERVICE_PORT ?? "4101", 10);
if (!Number.isSafeInteger(port) || port < 1 || port > 65_535)
  throw new Error("COMPUTER_SERVICE_PORT must be a valid port");

const server = createServer(
  connectNodeAdapter({ routes: registerComputerService, requestPathPrefix: "/rpc" }),
);
server.listen(port, "0.0.0.0", () =>
  console.log(`OpenBot computer service listening on port ${port}`),
);

async function stop() {
  await shutdownCuaWorkers();
  server.close((error) => {
    if (error) process.exitCode = 1;
  });
}
process.once("SIGINT", stop);
process.once("SIGTERM", stop);
