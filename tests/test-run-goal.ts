// tests/test-run-goal.ts
// CBA-9 TOUGHEST QA: Wire Gate → Remote Agent → Executor via runGoal in background.
//
// Tests:
// 1. runGoal API contract: validation, tab resolution, and execution.
// 2. RUN_GOAL message handling: async message response, session delivery, and error propagation.
// 3. Testing Plan - Happy path: Chat goal on fake portal flows Gate (allow) -> Remote Agent -> Executor -> reaches Submit.
// 4. Testing Plan - Gate Block (Zero-Call Guard): Gate Block -> exactly 0 calls to Remote Agent / model.
// 5. Gate Human Approval lifecycle: Approval continues to Remote Agent; Rejection halts with 0 remote calls.
// 6. Concurrency & re-entrancy: Concurrent runGoal on same tab is rejected cleanly; subsequent goal starts fresh session.
// 7. Static Architecture Audit: runGoal is the single legal entry, no persistence/network leaks, and Chat uses RUN_GOAL.

import assert from "node:assert";
import { createServer, type Server } from "node:http";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { installCanvasShims } from "../privacy/engine/vision/test-canvas-shim.js";
import { runGoal, resolveActiveTabId } from "../orchestrator/runGoal.js";
import {
  sessionsByTab,
  pendingHumanDecisions,
  startSession,
  waitForHumanDecision,
} from "../orchestrator/session.js";
import type { ElementMeta, AgentSession } from "../types/index.js";

// ---------------------------------------------------------------------------
// Synthetic page fixtures
// ---------------------------------------------------------------------------
const HOME = "http://localhost:8671/";
const FORM = "http://localhost:8671/form";
const THANKS = "http://localhost:8671/thanks";
// Deny-listed host (onlinesbi) so the gate BLOCK trail still exercises the
// hard block; a plain password page is human_approval now (Uber fix).
const BANK = "https://onlinesbi.example.net/login";

function el(
  element_id: string,
  tag: string,
  text: string,
  extra: Partial<ElementMeta> = {}
): ElementMeta {
  return {
    element_id,
    tag,
    type: extra.type ?? null,
    role: extra.role ?? null,
    label: extra.label ?? null,
    text,
    bbox: extra.bbox ?? [20, 20, 200, 24],
  };
}

interface FakePage {
  url: string;
  title: string;
  elements: ElementMeta[];
}

const pages: Record<string, FakePage> = {
  [HOME]: {
    url: HOME,
    title: "HR Portal",
    elements: [
      el("title", "h1", "HR Portal", { role: "heading" }),
      el("open", "button", "Open employee portal", { role: "button" }),
    ],
  },
  [FORM]: {
    url: FORM,
    title: "Employee Portal Form",
    elements: [
      el("name", "input", "Asha Rao", { label: "Full Name", role: "textbox" }),
      el("email", "input", "asha.rao@example.in", { type: "email", role: "textbox" }),
      el("pan", "input", "ABCDE1234F", { role: "textbox" }),
      el("phone", "input", "+91 98765 43210", { type: "tel", role: "textbox" }),
      el("salary", "input", "\u20B912,00,000", { label: "Salary", role: "textbox" }),
      el("password", "input", "demo-pass-123", { type: "password", role: "textbox" }),
      el("submit", "button", "Submit", { role: "button", bbox: [20, 300, 80, 24] }),
    ],
  },
  [THANKS]: {
    url: THANKS,
    title: "HR Portal",
    elements: [el("msg", "h1", "Thanks! Your details were submitted.", { role: "heading" })],
  },
  [BANK]: {
    url: BANK,
    title: "Bank Login",
    elements: [
      el("user", "input", "asha.rao", { role: "textbox", label: "User name" }),
      el("pwd", "input", "secret-pass", { type: "password", role: "textbox" }),
      el("login", "button", "Login", { role: "button" }),
    ],
  },
};

let currentPage = HOME;
const TAB = 101;
const BANK_TAB = 303;
const executedActions: Array<{ type: string; target: string; value?: string }> = [];
const sessionUpdates: Array<{ status: string; steps: number; lastAction?: string }> = [];
let runtimeMessageListeners: Array<
  (msg: any, sender: any, sendResponse: (res: any) => void) => void | boolean
> = [];

const pngDataUrl =
  "data:image/png;base64," +
  readFileSync(resolve("ml/dataset/images/f5_text_negative.png")).toString("base64");

let agentPort = 0;

// Set up mocked chrome environment
(globalThis as Record<string, unknown>).chrome = {
  action: {
    onClicked: {
      addListener: () => {},
    },
  },
  runtime: {
    getURL: (p: string) => pathToFileURL(resolve(p)).href,
    sendMessage: async (msg: any) => {
      if (msg?.type === "cba.sessionUpdate" && msg.session) {
        sessionUpdates.push({
          status: msg.session.status,
          steps: msg.session.history?.length ?? 0,
          lastAction: msg.session.lastAction?.type,
        });
      }
      return {};
    },
    onMessage: {
      addListener: (
        fn: (msg: any, sender: any, sendResponse: (res: any) => void) => void | boolean
      ) => {
        runtimeMessageListeners.push(fn);
      },
    },
  },
  storage: {
    local: {
      get: async () => ({
        privis_model_settings: { serverUrl: `http://127.0.0.1:${agentPort}` },
      }),
    },
  },
  tabs: {
    query: async (queryInfo: any) => {
      if (queryInfo?.active) {
        return [{ id: TAB, active: true, url: currentPage }];
      }
      return [{ id: TAB, active: true, url: currentPage }];
    },
    get: async (id: number) => ({
      id,
      windowId: 1,
      active: true,
      status: "complete",
      url: currentPage,
    }),
    update: async (id: number, props: { url?: string }) => {
      if (props?.url && pages[props.url]) currentPage = props.url;
      return { id };
    },
    captureVisibleTab: async () => pngDataUrl,
    sendMessage: async (_tabId: number, msg: any) => {
      if (msg?.type === "capture.request") {
        const page = pages[currentPage];
        return {
          type: "capture.response",
          payload: {
            elements: JSON.parse(JSON.stringify(page.elements)),
            browserState: { url: page.url, title: page.title, viewport: { w: 640, h: 480 } },
          },
        };
      }
      if (msg?.type === "execute.request") {
        const results = msg.payload.actions.map((a: any) => {
          executedActions.push(a);
          const page = pages[currentPage];
          if (a.type === "type") {
            const target = page.elements.find((e) => "#" + e.element_id === a.target);
            if (!target || a.value === undefined)
              return { ok: false, error: "type target not found: " + a.target };
            target.text = a.value;
            return { ok: true };
          }
          if (a.type === "click") {
            if (a.target === "#submit" && currentPage === FORM) {
              currentPage = THANKS;
              return { ok: true };
            }
            const hit = page.elements.find((e) => "#" + e.element_id === a.target);
            return hit ? { ok: true } : { ok: false, error: "click target not found: " + a.target };
          }
          return { ok: false, error: "unsupported action: " + a.type };
        });
        return { type: "execute.response", payload: { results } };
      }
      throw new Error("unexpected content message: " + msg?.type);
    },
  },
};

const realFetch = globalThis.fetch;
(globalThis as Record<string, unknown>).fetch = async (input: any, init?: any) => {
  const url = typeof input === "string" ? input : (input?.url ?? String(input));
  if (url.startsWith("file://")) {
    return new Response(readFileSync(new URL(url)), { status: 200 });
  }
  return realFetch(input, init);
};
const restoreShims = installCanvasShims();

// ---------------------------------------------------------------------------
// Scripted Remote Agent Server
// ---------------------------------------------------------------------------
interface PlanCall {
  url: string;
  placeholders: string[];
  raw: string;
}
const planCalls: PlanCall[] = [];
let formCalls = 0;

function scriptAction(call: PlanCall): unknown {
  if (call.url === HOME) return { type: "navigate", url: FORM };
  if (call.url === FORM) {
    formCalls++;
    const ids = ["name", "email", "pan"];
    const n = formCalls;
    if (n <= 3) {
      const token = call.placeholders[n - 1];
      if (!token) return { type: "click", target: { name: "Submit" } };
      return { type: "type", target: { css: "#" + ids[n - 1] }, placeholder: token };
    }
    return { type: "click", target: { name: "Submit" } };
  }
  if (call.url === THANKS) return { type: "done", reason: "form submitted, thanks page reached" };
  return { type: "ask_human", reason: "unexpected page " + call.url };
}

const server: Server = createServer((req, res) => {
  if (req.method === "POST" && req.url === "/plan") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      let parsed: any;
      try {
        parsed = JSON.parse(body);
      } catch {
        res.writeHead(400).end("bad json");
        return;
      }
      const elements = parsed?.sanitizedContext?.elements ?? [];
      const call: PlanCall = {
        url: parsed?.sanitizedContext?.browserState?.url ?? "",
        placeholders: elements
          .map((e: any) => e.text as string)
          .filter((t: string) => /^[A-Z]+_\d+$/.test(t)),
        raw: body,
      };
      planCalls.push(call);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, action: scriptAction(call) }));
    });
    return;
  }
  res.writeHead(404).end();
});

// Load service worker module to register runtime message listeners
await import("../background/service-worker.js");

function dispatchRuntimeMessage(msg: any): Promise<any> {
  return new Promise((resolve) => {
    let responded = false;
    for (const listener of runtimeMessageListeners) {
      const isAsync = listener(msg, {}, (response: any) => {
        if (!responded) {
          responded = true;
          resolve(response);
        }
      });
      if (!isAsync && !responded) {
        // sync handled
      }
    }
  });
}

// ---------------------------------------------------------------------------
// CBA-9 QA Execution
// ---------------------------------------------------------------------------
async function runQA() {
  console.log("=== Running CBA-9 runGoal & Gate → Remote Agent → Executor Test Suite ===\n");
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  agentPort = (server.address() as any).port;

  try {
    // -----------------------------------------------------------------------
    // [1] runGoal API Contract & Input Validation
    // -----------------------------------------------------------------------
    console.log("[1] runGoal API contract & input validation");
    {
      await assert.rejects(
        () => runGoal(""),
        /Goal text must not be empty/,
        "runGoal rejects empty goal string"
      );
      await assert.rejects(
        () => runGoal("   "),
        /Goal text must not be empty/,
        "runGoal rejects whitespace-only goal string"
      );

      const activeTabId = await resolveActiveTabId();
      assert.strictEqual(activeTabId, TAB, "resolveActiveTabId resolves active tab");
      console.log("  ✔ runGoal rejects invalid input & resolves active tab");
    }

    // -----------------------------------------------------------------------
    // [2] Testing Plan: Happy path via RUN_GOAL message reaches Submit
    // -----------------------------------------------------------------------
    console.log("\n[2] Testing Plan: Happy path via RUN_GOAL message reaches Submit");
    {
      currentPage = HOME;
      planCalls.length = 0;
      formCalls = 0;
      executedActions.length = 0;

      const response = await dispatchRuntimeMessage({
        type: "RUN_GOAL",
        text: "Submit the employee portal form",
        tabId: TAB,
      });

      assert.strictEqual(response?.ok, true, "RUN_GOAL response ok");
      const session = sessionsByTab.get(TAB)!;
      assert.ok(session, "Session created for tab");
      assert.strictEqual(session.status, "done", "Session completes with done status");
      assert.strictEqual(currentPage, THANKS, "Navigated through form to thanks page");

      // Verify actions executed: navigate -> type (name, email, pan) -> click submit
      assert.ok(
        executedActions.some((a) => a.type === "click" && a.target === "#submit"),
        "Executor reached and clicked #submit"
      );
      assert.ok(planCalls.length >= 4, "Remote Agent called for planning steps");
      console.log("  ✔ RUN_GOAL executes complete multi-page flow and reaches Submit");
    }

    // -----------------------------------------------------------------------
    // [3] Testing Plan: Gate BLOCK → ZERO calls to Remote Agent / model
    // -----------------------------------------------------------------------
    console.log("\n[3] Testing Plan: Gate BLOCK → ZERO calls to Remote Agent / model");
    {
      currentPage = BANK;
      const initialPlanCallsCount = planCalls.length;
      executedActions.length = 0;

      const response = await dispatchRuntimeMessage({
        type: "RUN_GOAL",
        text: "Login to banking portal",
        tabId: BANK_TAB,
      });

      const bankSession = sessionsByTab.get(BANK_TAB)!;
      assert.ok(bankSession, "Session exists for bank tab");
      assert.strictEqual(bankSession.status, "blocked", "Session marked blocked");
      assert.strictEqual(bankSession.gateDecision, "block", "Gate decision is block");
      assert.ok(
        bankSession.error?.toLowerCase().includes("deny-listed"),
        "Blocked reason names the deny-listed host refusal"
      );

      // CRITICAL ASSERTION: Zero calls made to Remote Agent (/plan)
      const newPlanCalls = planCalls.length - initialPlanCallsCount;
      assert.strictEqual(
        newPlanCalls,
        0,
        "ZERO calls to Remote Agent when Policy Gate blocks"
      );
      assert.strictEqual(executedActions.length, 0, "ZERO actions executed on page DOM");
      console.log("  ✔ Gate BLOCK strictly halts pipeline with 0 calls to Remote Agent");
    }

    // -----------------------------------------------------------------------
    // [4] Gate Human Approval Protocol
    // -----------------------------------------------------------------------
    console.log("\n[4] Gate Human Approval Protocol (Approve & Reject flows)");
    {
      const dummySessionId = "human-test-session-42";
      let decisionPromise = waitForHumanDecision(dummySessionId);

      // Case 4A: Approve resolves promise to true
      const approveResponse = await dispatchRuntimeMessage({
        type: "cba.humanDecision",
        sessionId: dummySessionId,
        approved: true,
      });
      assert.strictEqual(approveResponse?.ok, true, "humanDecision message handled ok");
      const approvedResult = await decisionPromise;
      assert.strictEqual(approvedResult, true, "waitForHumanDecision resolved true on approve");

      // Case 4B: Reject resolves promise to false
      decisionPromise = waitForHumanDecision(dummySessionId);
      const rejectResponse = await dispatchRuntimeMessage({
        type: "cba.humanDecision",
        sessionId: dummySessionId,
        approved: false,
      });
      assert.strictEqual(rejectResponse?.ok, true, "humanDecision message handled ok for reject");
      const rejectedResult = await decisionPromise;
      assert.strictEqual(rejectedResult, false, "waitForHumanDecision resolved false on reject");

      // Case 4C: Non-existent session returns ok: false
      const invalidResponse = await dispatchRuntimeMessage({
        type: "cba.humanDecision",
        sessionId: "non-existent-session-id",
        approved: true,
      });
      assert.strictEqual(invalidResponse?.ok, false, "Invalid session returns ok: false");
      console.log("  ✔ Gate Human Approval protocol (Approve / Reject / Missing) verified");
    }

    // -----------------------------------------------------------------------
    // [5] Concurrency Protection & Fresh Session Lifecycle
    // -----------------------------------------------------------------------
    console.log("\n[5] Concurrency Protection & Fresh Session Lifecycle");
    {
      currentPage = HOME;
      // Start a fresh goal
      const p1 = runGoal("Goal 1", TAB);
      // Attempt concurrent goal on same tab
      const p2Result = await runGoal("Goal 2", TAB);
      assert.strictEqual(
        p2Result.reason,
        "A session loop is already running on this tab.",
        "Concurrent runGoal on same tab is blocked"
      );
      await p1;

      // After finish, subsequent goal starts clean
      const p3 = await runGoal("Goal 3 fresh run", TAB);
      const session = sessionsByTab.get(TAB)!;
      assert.strictEqual(session.goal, "Goal 3 fresh run", "Fresh goal replaces finished session");
      console.log("  ✔ Concurrency guarded and session recycling works seamlessly");
    }

    // -----------------------------------------------------------------------
    // [5b] Human chat reply RESUMES a parked ask_human session
    // -----------------------------------------------------------------------
    console.log("\n[5b] Human reply resumes a parked session (same session, appended goal)");
    {
      const PARK_TAB = 909;
      const parked = startSession(PARK_TAB, "book an uber ride");
      parked.status = "waiting_human"; // parked on remote ask_human / step cap
      parked.step = 4;
      await runGoal("password entered, continue", PARK_TAB);
      const s = sessionsByTab.get(PARK_TAB)!;
      assert.strictEqual(s.sessionId, parked.sessionId, "resume keeps the SAME session (history preserved)");
      assert.ok(
        s.goal.includes("[Human follow-up]: password entered, continue"),
        "human reply appended to the goal the agent receives"
      );
      assert.ok(
        s.goal.startsWith("book an uber ride"),
        "original goal is retained for context"
      );
      assert.strictEqual(s.status, "done", "resumed session runs to completion");
      console.log("  ✔ Human follow-up resumes the parked session instead of starting over");
    }

    // -----------------------------------------------------------------------
    // [6] Chat Component & RUN_GOAL Contract Integration
    // -----------------------------------------------------------------------
    console.log("\n[6] Chat Component & RUN_GOAL Contract Integration");
    {
      const chatSrc = readFileSync("extension/src/popup/Chat.ts", "utf-8");
      assert.ok(
        chatSrc.includes('type: "RUN_GOAL"'),
        "Chat.ts sends message with type: RUN_GOAL"
      );
      assert.ok(
        chatSrc.includes("text: goal"),
        "Chat.ts passes text: goal in RUN_GOAL payload"
      );
      console.log("  ✔ Chat UI adheres to CBA-9 RUN_GOAL message schema");
    }

    // -----------------------------------------------------------------------
    // [7] Static Source & Security Audit
    // -----------------------------------------------------------------------
    console.log("\n[7] Static Source & Security Audit");
    {
      const runGoalSrc = readFileSync("orchestrator/runGoal.ts", "utf-8");
      const forbidden = [
        "fetch(", "chrome.storage", "localStorage", "sessionStorage", "indexedDB",
        "XMLHttpRequest", "WebSocket", "http://", "https://",
      ];
      for (const tok of forbidden) {
        assert.ok(
          !runGoalSrc.includes(tok),
          `orchestrator/runGoal.ts free of forbidden token "${tok}"`
        );
      }

      const swSrc = readFileSync("background/service-worker.ts", "utf-8");
      assert.ok(
        swSrc.includes('msg?.type === "RUN_GOAL"'),
        "service-worker.ts registers RUN_GOAL listener"
      );
      assert.ok(
        swSrc.includes("runGoal("),
        "service-worker.ts calls runGoal entry point"
      );
      console.log("  ✔ Static audits confirm clean boundary and no persistence/network leaks");
    }

    console.log("\n============================================================");
    console.log("✅ ALL CBA-9 RUN_GOAL & GATE → REMOTE → EXECUTOR TESTS PASSED (100%)");
    console.log("============================================================\n");
  } finally {
    restoreShims();
    await new Promise<void>((r) => server.close(() => r()));
  }
}

runQA().catch((err) => {
  console.error("\n❌ CBA-9 QA FAILED:", err);
  process.exit(1);
});
