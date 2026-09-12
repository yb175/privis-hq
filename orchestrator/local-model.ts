// orchestrator/local-model.ts
// Tier 1 Local Model Execution, Tier Selection, and Bounded Failure Taxonomy.
//
// PROVENANCE: ported from approved reference PravAl2028/SIH26171,
// extension/src/worker/local.ts (author-granted permission).
//
// Defines failure classes, tier selection logic, and bounded retry policies.

import type { Action, ElementMeta, SanitizedPackage } from "../types/index.js";
import { tryLocalIntent, type LocalIntentResult } from "./local-intent.js";

/**
 * Standard failure taxonomy across all execution tiers.
 */
export type FailureClass =
  | "TARGET_NOT_FOUND"
  | "TARGET_AMBIGUOUS"
  | "TARGET_BLOCKED"
  | "ACTION_REJECTED"
  | "PAGE_NOT_SETTLED"
  | "VERIFICATION_FAILED"
  | "PLANNER_INVALID"
  | "PLANNER_TIMEOUT"
  | "LOCAL_MODEL_FAILURE"
  | "REMOTE_MODEL_FAILURE"
  | "PRIVACY_GATE_FAILURE";

export interface AgentFailure {
  failureClass: FailureClass;
  message: string;
  recoverable: boolean;
  tier: 0 | 1 | 2;
  detail?: Record<string, unknown>;
}

export type ExecutionTier = 0 | 1 | 2;

export interface TierSelection {
  tier: ExecutionTier;
  reason: string;
  localIntent?: LocalIntentResult;
}

export interface LocalModelOptions {
  timeoutMs?: number;
  maxRetries?: number;
}

/**
 * Evaluates goal and page context to select the most efficient deterministic tier:
 * - Tier 0: Deterministic intent grammar and weighted element resolver (0 ms, 0 network).
 * - Tier 1: Local on-device model if available.
 * - Tier 2: Sanitized remote planner (OpenAI/Gemini/Hono backend).
 */
export function selectExecutionTier(
  goal: string,
  elements: readonly ElementMeta[],
  options?: { allowTier1?: boolean; localPlanner?: (goal: string, elements: readonly ElementMeta[]) => Action[] | null }
): TierSelection {
  // 1. Try Tier 0: Deterministic grammar & resolution
  const t0Result = tryLocalIntent(goal, elements as ElementMeta[]);
  if (t0Result.handled && t0Result.actions.length > 0) {
    return {
      tier: 0,
      reason: "tier-0-deterministic-match",
      localIntent: t0Result,
    };
  }

  // 2. If Tier 1 is enabled and local reasoning can handle it
  if (options?.allowTier1 && typeof options?.localPlanner === "function") {
    const plan = options.localPlanner(goal, elements);
    if (plan && plan.length > 0) {
      return {
        tier: 1,
        reason: "tier-1-local-reasoning-planned",
      };
    }
  }

  // 3. Fall through to Tier 2 (Sanitized Remote Planner)
  return {
    tier: 2,
    reason: t0Result.reason ? `tier-0-fallback: ${t0Result.reason}` : "complex-multistep-goal",
    localIntent: t0Result,
  };
}

/**
 * Checks whether a failure class is safely retryable within bounded limits.
 */
export function isFailureRecoverable(failureClass: FailureClass): boolean {
  switch (failureClass) {
    case "PAGE_NOT_SETTLED":
    case "PLANNER_TIMEOUT":
    case "LOCAL_MODEL_FAILURE":
    case "TARGET_BLOCKED":
      return true;
    case "PRIVACY_GATE_FAILURE":
    case "PLANNER_INVALID":
    case "ACTION_REJECTED":
    case "TARGET_AMBIGUOUS":
    case "TARGET_NOT_FOUND":
    case "VERIFICATION_FAILED":
    case "REMOTE_MODEL_FAILURE":
    default:
      return false;
  }
}
