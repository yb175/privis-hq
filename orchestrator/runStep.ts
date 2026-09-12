// orchestrator/runStep.ts
// CBA-6: the multi-page session loop. After each action:
// capture → Engine → Sanitizer → Gate → Remote Agent → Executor → recapture.
// Max 8 steps; reaching the cap without `done` escalates to ask_human.
//
//   while step < 8:
//     capture → sanitize → gate
//     if not Allow: stop, tell chat
//     action = remoteAgent.plan(...)
//     if done: stop
//     executor.run(action)
//
// Session state (tabId, step, last action, goal) stays on the device — see
// orchestrator/session.ts. This module previously lived as a one-shot runStep
// in background/service-worker.ts: a single click/type ended the session.
// Now every executed action recaptures, so form filling (type → type → click
// → next page) runs as one continuous session.
//
// Phase-00 split: this file is the sequencing core only. Capture lives in
// ./capture.ts, the HUD feed in ./hud.ts, and outbound-context/audit-log
// construction in ./outbound.ts. The fail-closed pipeline order pinned by
// tests/ stays here: capturePackage → runVisionPath → applyPlaceholders →
// sealAndRedact (the encoding gate) → decide → local-intent → queryServer.
// Nothing crosses the wire before the gate allows AND the redaction receipt
// verifies.

import type {
  Action,
  AgentAction,
  AgentSession,
  CapturePackage,
  StepResult,
} from "../types/index.js";
import { applyPlaceholders, resetPlaceholderTokens } from "../privacy/sanitizer/structural-redact.js";
import { sealAndRedact } from "../privacy/sanitizer/redaction-gate.js";
import { decide } from "../privacy/policy-gate/policy-gate.js";
import { loadModelSettings } from "../shared/settings.js";
import { queryServer, serverOptionsFromSettings } from "../remote-agent/client-server.js";
import { agentActionToExecutorActions } from "../executor/agent-action.js";
import { applyActions } from "../executor/local-executor.js";
import { navigateTab } from "../executor/navigate.js";
import { runVisionPath } from "../privacy/engine/vision/face-pipeline.js";
import { tokeniseGoal } from "./goal-tokenize.js";
import { tryLocalIntent } from "./local-intent.js";
import {
  notifySessionUpdate,
  runSessionLoop,
  startSession,
  waitForHumanDecision,
  tryBeginLoop,
  endLoop,
  type Outcome,
} from "./session.js";
import { capturePackage, waitForTabSettled } from "./capture.js";
import { broadcastHudStep } from "./hud.js";
import {
  stripLabels,
  buildOutboundPackage,
  buildOutboundPayload,
  logStepExchange,
} from "./outbound.js";

/**
 * Execute a full step of the privacy-preserving agent loop.
 * @param tabId Target tab ID
 * @param goal Human prompt or task instruction
 */
export async function runStep(tabId: number, goal: string): Promise<StepResult> {
  // One loop per tab at a time: a toolbar click while a chat goal is running
  // must not start a second loop interleaving the same session history.
  if (!tryBeginLoop(tabId)) {
    return { decision: "allow", reason: "A session loop is already running on this tab." };
  }
  try {
    const session = startSession(tabId, goal);
    // Session-scoped placeholder state: the previous session's real values
    // must not outlive it (minimum-lifetime rule for sensitive data).
    resetPlaceholderTokens();
    notifySessionUpdate(session);
    // CBA-6 loop: keep recapturing after each action until the agent says done,
    // the gate stops us, or the step cap is hit. Infra errors (capture, vision,
    // remote) reject the run — the session is already marked "error" + notified.
    return await runSessionLoop(session, (s) => runOneStep(s));
  } finally {
    endLoop(tabId);
  }
}

/**
 * One pipeline pass: capture → Engine → Sanitizer → Gate → Remote Agent →
 * Executor. Throws on capture/vision/remote failure (fail-closed, session
 * marked "error"); otherwise returns this pass's StepResult with `stop` set
 * when the session loop must end.
 */
async function runOneStep(session: AgentSession): Promise<Outcome> {
  const { tabId, goal } = session;
  let pkg: CapturePackage;
  try {
    pkg = await capturePackage(tabId);
  } catch (err: unknown) {
    session.status = "error";
    session.error = err instanceof Error ? err.message : String(err);
    notifySessionUpdate(session);
    throw err;
  }

  // M6-D vision path: browser-local YuNet FACE inference on the SAME in-memory
  // screenshot (no extra capture), fused with the DOM detections through the
  // M4 rules (privacy/engine/fuse.ts). FAIL-CLOSED: any decode/model/inference
  // error rejects this step before the gate — never an empty detection list
  // with an unsanitized screenshot heading to the remote agent.
  try {
    pkg.detections = await runVisionPath({
      dataUrl: pkg.dataUrl,
      elements: pkg.elements,
      domDetections: pkg.detections,
      viewport: pkg.browserState.viewport,
    });
  } catch (err: unknown) {
    session.status = "error";
    session.error = err instanceof Error ? err.message : String(err);
    notifySessionUpdate(session);
    throw err;
  }

  broadcastHudStep(1, {
    rawScreenshot: pkg.dataUrl,
    elementCount: pkg.elements.length,
    viewport: pkg.browserState.viewport,
  });

  // Vision Engine Detections
  broadcastHudStep(2, {
    detections: pkg.detections,
  });

  // Sanitizer: structural placeholders + the one-way encoding gate. Phase 01:
  // redaction and PNG encoding happen ONLY inside redaction-gate.ts
  // (seal → encode), which also stamps the receipt every outbound boundary
  // verifies. The raw screenshot buffer is closed before seal returns.
  const { sanitized, map } = applyPlaceholders(pkg.elements, pkg.detections);
  const { sanitizedScreenshot, manifest } = await sealAndRedact(
    pkg.dataUrl,
    pkg.detections,
    pkg.browserState.viewport
  );
  // Real value -> placeholder pairs, so the HUD can show the swap happening.
  // The map itself never leaves this device; only placeholders go to the agent.
  const swaps = sanitized
    .filter((el) => typeof map[el.element_id] === "string")
    .map((el) => ({ real: map[el.element_id], placeholder: el.text }));
  broadcastHudStep(3, {
    sanitizedScreenshot,
    rawScreenshot: pkg.dataUrl,
    swaps,
    detectionsCount: pkg.detections.length,
  });

  // Policy Gate: never call the remote unless the package is allowed out.
  const gate = decide({ detections: pkg.detections, browserState: pkg.browserState });
  session.gateDecision = gate.decision;
  broadcastHudStep(4, {
    decision: gate.decision,
    reason: gate.reason,
  });
  notifySessionUpdate(session, gate);

  if (gate.decision === "block") {
    session.status = "blocked";
    session.error = gate.reason;
    notifySessionUpdate(session, gate);

    // CBA-11: Log blocked step to transparency audit store with response: null.
    // The goal is TOKENISED before it enters any log (Phase 01: the raw
    // sentence — which may itself contain an Aadhaar number — is device-only).
    const settings = await loadModelSettings();
    const refusedPkg = buildOutboundPackage(
      tokeniseGoal(goal).goal,
      stripLabels(sanitized),
      sanitizedScreenshot,
      pkg.browserState,
      manifest
    );
    await logStepExchange({
      sessionId: session.sessionId,
      tabIdHint: tabId,
      goal: tokeniseGoal(goal).goal,
      step: session.history.length + 1,
      model: settings.model,
      request: refusedPkg,
      response: null,
      gate: { decision: gate.decision, reason: gate.reason },
      error: gate.reason,
    });

    return { decision: gate.decision, reason: gate.reason, stop: true };
  }

  if (gate.decision === "human_approval") {
    session.status = "waiting_human";
    session.error = gate.reason;
    notifySessionUpdate(session, gate);
    const approved = await waitForHumanDecision(session.sessionId);
    if (!approved) {
      session.status = "blocked";
      session.error = "Human rejected action";
      notifySessionUpdate(session, gate);

      // CBA-11: Log rejected step to transparency audit store
      const settings = await loadModelSettings();
      const refusedPkg = buildOutboundPackage(
        tokeniseGoal(goal).goal,
        stripLabels(sanitized),
        sanitizedScreenshot,
        pkg.browserState,
        manifest
      );
      await logStepExchange({
        sessionId: session.sessionId,
        tabIdHint: tabId,
        goal: tokeniseGoal(goal).goal,
        step: session.history.length + 1,
        model: settings.model,
        request: refusedPkg,
        response: null,
        gate: { decision: gate.decision, reason: "Human rejected action" },
        error: "Human rejected action",
      });

      return { decision: gate.decision, reason: "Human rejected action", stop: true };
    }
    session.status = "running";
    notifySessionUpdate(session, gate);
  }

  // Tier 0 (Phase 01): a simple single-intent goal ("type leo in first",
  // "click the submit button") is answered by the deterministic parser —
  // zero network calls, so the sentence and the value never leave the device.
  // First step only: a recapture loop must never re-fire a click, and a field
  // that is already filled falls through. Anything uncertain falls through to
  // the remote planner unchanged.
  if (session.history.length === 0) {
    const local = tryLocalIntent(goal, sanitized);
    if (local.handled && local.actions.length > 0) {
      const results = await applyActions(tabId, local.actions);
      const first = local.actions[0];
      const localAction: AgentAction =
        first.type === "click"
          ? { type: "click", target: { css: first.target } }
          : { type: "type", target: { css: first.target }, placeholder: "LOCAL_1" };
      session.history.push({
        step: 1,
        url: pkg.browserState.url,
        action: localAction,
        result: results[0] ?? { ok: true },
        timestamp: Date.now(),
      });
      session.step = session.history.length;
      broadcastHudStep(6, { actions: local.actions, results });
      notifySessionUpdate(session, gate);
      await waitForTabSettled(tabId);
      return { decision: "allow", reason: "tier-0 local intent", actions: results };
    }
  }

  // Remote Agent: only the sanitized package crosses the wire — never the raw
  // dataUrl, never the element_id -> real value map. applyPlaceholders swaps
  // only `text`, so strip the user-controlled `label` (accessible label /
  // placeholder / title) to keep any raw value out of the remote context.
  // Phase 01: the GOAL itself is tokenised (checksummed identifiers become
  // placeholder tokens before the sentence leaves), and the package carries
  // the redaction manifest + receipt that queryServer verifies pre-flight.
  // Privacy-first: NO LLM keys on this device — the package goes to the
  // operator's remote-agent server, which holds the keys and picks the brain.
  const outboundGoal = tokeniseGoal(goal).goal;
  const remoteElements = stripLabels(sanitized);
  const settings = await loadModelSettings();
  session.outboundPayload = buildOutboundPayload(
    sanitizedScreenshot,
    remoteElements,
    pkg.browserState.url,
    settings.model
  );
  notifySessionUpdate(session, gate);

  const outboundPkg = buildOutboundPackage(
    outboundGoal,
    remoteElements,
    sanitizedScreenshot,
    pkg.browserState,
    manifest
  );

  let agentAction: AgentAction;
  try {
    agentAction = await queryServer(
      outboundPkg,
      serverOptionsFromSettings(settings)
    );
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    session.status = "error";
    session.error = errorMsg;
    notifySessionUpdate(session, gate);

    // CBA-11: Log failed request to transparency audit store
    await logStepExchange({
      sessionId: session.sessionId,
      tabIdHint: tabId,
      goal: outboundGoal,
      step: session.history.length + 1,
      model: settings.model,
      request: outboundPkg,
      response: null,
      gate: { decision: gate.decision, reason: gate.reason },
      error: errorMsg,
    });

    throw err;
  }

  // CBA-11: Record completed outbound wire exchange in transparency log
  await logStepExchange({
    sessionId: session.sessionId,
    tabIdHint: tabId,
    goal: outboundGoal,
    step: session.history.length + 1,
    model: settings.model,
    request: outboundPkg,
    response: agentAction,
    gate: { decision: gate.decision, reason: gate.reason },
  });

  session.lastAction = agentAction;
  broadcastHudStep(5, {
    goal,
    agentAction,
  });

  // Terminal actions: the remote says the goal is complete, or gives up and
  // asks the human. Record, stop the loop, tell the chat. No executor run.
  if (agentAction.type === "done" || agentAction.type === "ask_human") {
    const stepRecord = {
      step: session.history.length + 1,
      url: pkg.browserState.url,
      action: agentAction,
      result: { ok: true },
      timestamp: Date.now(),
    };
    session.history.push(stepRecord);
    session.step = session.history.length;
    session.status = agentAction.type === "done" ? "done" : "waiting_human";
    broadcastHudStep(6, { actions: [], results: [] });
    notifySessionUpdate(session, gate);
    return { decision: gate.decision, reason: gate.reason, stop: true };
  }

  // CBA-5: navigate cannot run in the content-script executor (no chrome.tabs
  // access). Navigate the tab here, then loop to recapture the new page — the
  // gate runs again on the freshly loaded page, so a sensitive target
  // (e.g. IRCTC) is still Human/Block after load, never bypassed.
  if (agentAction.type === "navigate") {
    const result = await navigateTab(tabId, agentAction.url);
    const stepRecord = {
      step: session.history.length + 1,
      url: pkg.browserState.url,
      action: agentAction,
      result,
      timestamp: Date.now(),
    };
    session.history.push(stepRecord);
    session.step = session.history.length;
    broadcastHudStep(6, { actions: [], results: [result] });
    if (!result.ok) {
      // Failed navigation (e.g. load timeout): stop the session with the error
      // visible to chat instead of retrying the same navigate blindly.
      session.status = "error";
      session.error = result.error;
      notifySessionUpdate(session, gate);
      return { decision: gate.decision, reason: gate.reason, stop: true };
    }
    // Loop continues: next iteration recaptures the navigated page.
    notifySessionUpdate(session, gate);
    return { decision: gate.decision, reason: gate.reason };
  }

  // Convert the AgentAction contract into executor Actions (name/role/bbox
  // targets resolved against the sanitized elements; placeholder → real-value
  // swap happens HERE, on-device, from the local map — CONTRACT.md rule 2).
  const actions: Action[] = agentActionToExecutorActions(agentAction, sanitized, map);

  // A type action without a local mapping must never become a silent no-op or
  // type its placeholder. Escalate so the human can repair the mapping/page.
  if (agentAction.type === "type" && actions.length === 0) {
    const escalation = {
      type: "ask_human" as const,
      reason: `Cannot resolve local value for ${agentAction.placeholder}`,
    };
    session.lastAction = escalation;
    session.history.push({
      step: session.history.length + 1,
      url: pkg.browserState.url,
      action: escalation,
      result: { ok: false, error: escalation.reason },
      timestamp: Date.now(),
    });
    session.step = session.history.length;
    session.status = "waiting_human";
    broadcastHudStep(6, {
      actions: [],
      results: [{ ok: false, error: escalation.reason }],
      outcome: "ask_human",
      reason: escalation.reason,
    });
    notifySessionUpdate(session, gate);
    return { decision: gate.decision, reason: escalation.reason, actions: [{ ok: false, error: escalation.reason }], stop: true };
  }

  // Local Executor: apply the returned actions on the real page DOM.
  const results = await applyActions(tabId, actions);
  const stepRecord = {
    step: session.history.length + 1,
    url: pkg.browserState.url,
    action: agentAction,
    result: results[0] ?? { ok: true },
    timestamp: Date.now(),
  };
  session.history.push(stepRecord);
  session.step = session.history.length;
  broadcastHudStep(6, {
    actions,
    results,
  });

  // CBA-6: an executed click/type is NOT the end of the session (that was the
  // one-shot demo behaviour). Wait for any navigation it triggered to settle,
  // then loop and recapture the new page.
  notifySessionUpdate(session, gate);
  await waitForTabSettled(tabId);
  return { decision: gate.decision, reason: gate.reason, actions: results };
}
