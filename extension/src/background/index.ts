// extension/src/background/index.ts
// Background entry barrel for CBA-9: single legal entry point runGoal

export { runGoal, resolveActiveTabId } from "../../../orchestrator/runGoal.js";
export { runStep, capturePackage, getLiveSteps } from "../../../orchestrator/runStep.js";
export {
  sessionsByTab,
  pendingHumanDecisions,
  startSession,
  endLoop,
  tryBeginLoop,
  waitForHumanDecision,
} from "../../../orchestrator/session.js";
