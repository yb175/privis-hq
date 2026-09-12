// remote-agent/server.ts
// Standalone Hono HTTP server for Remote Agent (decoupled from extension)
// Consumes SanitizedPackage JSON payloads, routes to configured model, and returns AgentAction JSON.
// Security: /plan requires a bearer token when AGENT_AUTH_TOKEN is configured,
// and CORS is restricted to AGENT_ALLOWED_ORIGINS (comma-separated). Secrets in
// .env are loaded only at real startup (not on import) so tests stay hermetic.

import { Hono } from "hono";
import { cors } from "hono/cors";
import { serve } from "@hono/node-server";
import type { SanitizedPackage } from "../types/index.js";
import { routeAgentRequest } from "./router.js";
import { redactPii } from "./guard.js";
import { verifyReceipt } from "./receipt.js";
import { loadModelSettings } from "../shared/settings.js";

export function createAgentApp() {
  const app = new Hono();

  // Request logger (outermost): one line per request with status + timing.
  // Body digests for /plan are logged inside handlePlan, which consumes the
  // body — no payloads are read twice.
  app.use("*", async (c, next) => {
    const started = Date.now();
    await next();
    console.log(
      `[agent] ${c.req.method} ${c.req.path} -> ${c.res.status} (${Date.now() - started}ms)`
    );
  });

  // CORS restricted to configured trusted origins. Dev fallback (when
  // AGENT_ALLOWED_ORIGINS is unset): localhost/127.0.0.1 and chrome-extension://
  // so local extension + tooling work, arbitrary websites do not.
  const allowedOrigins = (process.env.AGENT_ALLOWED_ORIGINS || "")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
  const isAllowedOrigin = (origin: string): boolean => {
    if (allowedOrigins.includes(origin)) return true;
    if (!allowedOrigins.length) {
      // Dev default allowlist
      try {
        const u = new URL(origin);
        if (
          u.hostname === "localhost" ||
          u.hostname === "127.0.0.1" ||
          u.protocol === "chrome-extension:"
        ) {
          return true;
        }
      } catch {
        return false;
      }
    }
    return false;
  };

  app.use(
    "*",
    cors({
      origin: (origin) => (isAllowedOrigin(origin) ? origin : undefined),
      allowMethods: ["GET", "POST", "OPTIONS"],
      allowHeaders: ["Content-Type", "Authorization"],
    })
  );

  // Health check endpoint (unauthenticated, no sensitive data)
  app.get("/health", (c) => {
    return c.json({ status: "ok", service: "privis-remote-agent" });
  });

  app.get("/", (c) => {
    return c.json({ status: "ok", service: "privis-remote-agent" });
  });

  // Auth gate: when AGENT_AUTH_TOKEN is set, /plan requires it. Prevents any
  // website from spending the server's paid LLM keys on its own prompts.
  // Token is read per-request so tests can toggle it via env.
  const requireAuth = async (c: any, next: () => Promise<void>) => {
    const token = process.env.AGENT_AUTH_TOKEN;
    if (token) {
      const provided = (c.req.header("Authorization") || "").replace(/^Bearer\s+/i, "");
      if (provided !== token) {
        return c.json({ ok: false, error: "Unauthorized — missing or invalid bearer token" }, 401);
      }
    }
    await next();
  };

  app.use("/plan", requireAuth);
  app.use("/action", requireAuth);

  // Action / Plan endpoint
  const handlePlan = async (c: any) => {
    const started = Date.now();
    try {
      // Body = SanitizedPackage + optional client model preference.
      // The client NEVER sends keys; keys come from THIS server's env/storage,
      // and the preference only overrides which brain is called.
      const body = (await c.req.json()) as SanitizedPackage & { model?: string };
      const preferred =
        body.model === "chatgpt" || body.model === "gemini" ? body.model : undefined;
      const { model: _pref, ...pkg } = body;
      const serverSettings = await loadModelSettings();

      // Compact digest of what arrived — lengths only, never element contents
      // (keeps the log small and PII-free even though payloads are sanitized).
      const short = (v: unknown, n = 80) => {
        const s = typeof v === "string" ? v : JSON.stringify(v);
        return s.length > n ? s.slice(0, n) + "…" : s;
      };
      console.log(
        `[agent] /plan request goal=${short(redactPii(body.goal))} model=${preferred ?? serverSettings.model} ` +
          `redacted=${pkg.redacted} elements=${pkg.sanitizedContext?.elements?.length ?? 0} ` +
          `screenshotChars=${pkg.sanitizedScreenshot?.length ?? 0}`
      );

      // Phase 01: server-side receipt verification (SIH26171 worker-side
      // check, ported). The client verifies before transmitting; this is the
      // independent re-check at the receiving boundary — the operator refuses
      // a payload whose screenshot bytes do not match the receipt the gate
      // stamped, whatever path it took to get here. 422, not 400: the request
      // was well-formed; its provenance was not.
      const receipt = await verifyReceipt(pkg.sanitizedScreenshot, pkg.redactionManifest);
      if (!receipt.ok) {
        console.error(`[agent] /plan receipt verification failed: ${receipt.reason}`);
        return c.json(
          { ok: false, error: `redaction receipt verification failed (${receipt.reason})` },
          422
        );
      }

      const action = await routeAgentRequest(
        pkg,
        preferred ? { settings: { ...serverSettings, model: preferred } } : undefined
      );
      const detail =
        action.type === "type" || action.type === "click"
          ? (action.target?.name || action.target?.css || "").toString()
          : action.type === "scroll"
            ? `${action.dy}px`
            : (action as { reason?: string }).reason || "";
      console.log(
        `[agent] /plan OK after ${Date.now() - started}ms action=${action.type} detail=${short(detail)}`
      );
      return c.json({ ok: true, action }, 200);
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error(`[agent] /plan FAILED after ${Date.now() - started}ms: ${errorMsg}`);
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
  // Load the documented .env ONLY at real startup — importing this module
  // (tests) must stay hermetic and never pick up developer .env secrets.
  try {
    process.loadEnvFile("remote-agent/.env");
  } catch {
    // .env optional; env may also come from the shell environment
  }

  const PORT = Number(process.env.PORT || process.env.AGENT_PORT || 3201);
  const HOST = process.env.HOST || "0.0.0.0";
  serve(
    {
      fetch: app.fetch,
      port: PORT,
      hostname: HOST,
    },
    (info) => {
      const authOn = Boolean(process.env.AGENT_AUTH_TOKEN);
      console.log(
        `[PRIVIS Remote Agent (Hono)] listening on http://${info.address}:${info.port}` +
          ` (auth: ${authOn ? "bearer token required" : "OFF — set AGENT_AUTH_TOKEN before exposing"})`
      );
    }
  );
}
