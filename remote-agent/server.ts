// remote-agent/server.ts
// Standalone Hono HTTP server for Remote Agent (decoupled from extension)
// Consumes SanitizedPackage JSON payloads, routes to configured model, and returns AgentAction JSON.

import { Hono } from "hono";
import { cors } from "hono/cors";
import { serve } from "@hono/node-server";
import type { SanitizedPackage } from "../types/index.js";
import { routeAgentRequest } from "./router.js";
import { loadModelSettings } from "../extension/src/settings/models.js";

const PORT = Number(process.env.PORT || process.env.AGENT_PORT || 8080);
const HOST = process.env.HOST || "0.0.0.0";

export function createAgentApp() {
  const app = new Hono();

  // Enable CORS for web/extension clients
  app.use(
    "*",
    cors({
      origin: "*",
      allowMethods: ["GET", "POST", "OPTIONS"],
      allowHeaders: ["Content-Type", "Authorization"],
    })
  );

  // Health check endpoint
  app.get("/health", (c) => {
    return c.json({ status: "ok", service: "privis-remote-agent" });
  });

  app.get("/", (c) => {
    return c.json({ status: "ok", service: "privis-remote-agent" });
  });

  // Action / Plan endpoint
  const handlePlan = async (c: any) => {
    try {
      // Body = SanitizedPackage + optional client model preference.
      // The client NEVER sends keys; keys come from THIS server's env/storage,
      // and the preference only overrides which brain is called.
      const body = (await c.req.json()) as SanitizedPackage & { model?: string };
      const preferred =
        body.model === "chatgpt" || body.model === "gemini" ? body.model : undefined;
      const { model: _pref, ...pkg } = body;
      const serverSettings = await loadModelSettings();
      const action = await routeAgentRequest(
        pkg,
        preferred ? { settings: { ...serverSettings, model: preferred } } : undefined
      );
      return c.json({ ok: true, action }, 200);
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      return c.json({ ok: false, error: errorMsg }, 400);
    }
  };

  app.post("/plan", handlePlan);
  app.post("/action", handlePlan);
  app.post("/", handlePlan);

  // 404 handler
  app.notFound((c) => {
    return c.json({ error: "Not Found" }, 404);
  });

  return app;
}

export const app = createAgentApp();

// Auto-start if executed directly as entrypoint
if (
  process.argv[1]?.endsWith("server.ts") ||
  process.argv[1]?.endsWith("server.js") ||
  process.argv[1]?.endsWith("server.mjs")
) {
  serve(
    {
      fetch: app.fetch,
      port: PORT,
      hostname: HOST,
    },
    (info) => {
      console.log(
        `[PRIVIS Remote Agent (Hono)] Standalone server listening on http://${info.address}:${info.port}`
      );
    }
  );
}
