import { serve } from "@hono/node-server";
import { app } from "./app.js";

const port = Number.parseInt(process.env.PORT ?? process.env.PORT ?? "4100", 10);
if (!Number.isSafeInteger(port) || port < 1 || port > 65_535)
  throw new Error("PORT must be a valid TCP port");

serve({ fetch: app.fetch, port, hostname: "127.0.0.1" }, () => {
  console.log(`OpenBot control service listening at http://127.0.0.1:${port}`);
});
