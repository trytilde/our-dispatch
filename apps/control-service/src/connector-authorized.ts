import type { Hono } from "hono";

/** Public OAuth completion page; it carries no state or secrets. */
export function registerConnectorAuthorizedRoute(app: Hono): void {
  app.get("/connectors/authorized", (context) => {
    const requested = context.req.query("client");
    const client =
      requested === "electron" || requested === "mobile" ? requested : ("web" as const);
    context.header("cache-control", "no-store");
    return context.html(connectorAuthorizedPage(client));
  });
}

function connectorAuthorizedPage(client: "electron" | "mobile" | "web"): string {
  const deepLinked = client === "electron" || client === "mobile";
  const hint = deepLinked
    ? "Returning you to OpenBot… If nothing happens, switch back to the OpenBot app."
    : "You can close this tab and return to OpenBot.";
  const redirect = deepLinked
    ? '<script>setTimeout(function () { location.replace("openbot://connectors/authorized"); }, 150);</script>'
    : "";
  return [
    "<!doctype html>",
    '<html lang="en"><head><meta charset="utf-8" /><title>OpenBot</title>',
    "<style>body{font-family:system-ui,sans-serif;display:grid;place-items:center;min-height:90vh;color:#171718;background:#fafafb}main{text-align:center;max-width:26rem}h1{font-size:1.1rem}p{color:#666;font-size:.9rem}</style>",
    "</head><body><main>",
    "<h1>Authorization complete</h1>",
    `<p>${hint}</p>`,
    "</main>",
    redirect,
    "</body></html>",
  ].join("");
}
