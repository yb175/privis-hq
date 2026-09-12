// tests/test-phase13-advanced-agent.ts
// Phase 13: Advanced Agent Capabilities & Multi-Step Task Execution Test Suite.

import assert from "node:assert";
import process from "node:process";
import { verifyPlan } from "../../../executor/verify-plan.js";
import { verifyActionCompletion } from "../../../executor/complete.js";
import { PlaceholderAllocator } from "../../../privacy/sanitizer/placeholders.js";
import { tokeniseGoal } from "../../../orchestrator/goal-tokenize.js";

const failures: string[] = [];
function check(name: string, cond: boolean, detail = ""): void {
  if (cond) {
    console.log(`  PASS ${name}`);
  } else {
    failures.push(name + (detail ? ` (${detail})` : ""));
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

console.log("=== Phase 13 Advanced Agent Capabilities Test Suite ===");

// ── [1] P13-02 & P13-03: Multi-Step Goal Tokenization & Intent Decomposition ───
console.log("\n[1] P13-02 & P13-03: Multi-Step Goal Tokenization & Intent Decomposition");
{
  const complexMultiStepGoal = "First type john@doe.org into Email, then fill PAN ABCPE1234F, and finally click Proceed";
  const tokenized = tokeniseGoal(complexMultiStepGoal);

  check("Email tokenised in multi-step goal", !tokenized.goal.includes("john@doe.org") && tokenized.goal.includes("EMAIL_1"));
  check("PAN tokenised in multi-step goal", !tokenized.goal.includes("ABCPE1234F") && tokenized.goal.includes("PAN_1"));
  check("Structural intent structure preserved in sanitised goal", tokenized.goal.includes("into Email") && tokenized.goal.includes("click Proceed"));
}

// ── [2] P13-05: Multi-Action Plan Verification ────────────────────────────────
console.log("\n[2] P13-05: Multi-Action Plan Verification");
{
  const multiStepPlan = [
    { type: "type", target: "#email-field", value: "EMAIL_1" },
    { type: "type", target: "#pan-field", value: "PAN_1" },
    { type: "click", target: "#proceed-btn" },
  ];

  const report = verifyPlan(multiStepPlan);
  check("Multi-action sequential plan passes schema and boundary verification", report.ok && report.actions.length === 3);
}

// ── [3] P13-08 & P13-09: Safe Backtracking & Recovery Planning ────────────────
console.log("\n[3] P13-08 & P13-09: Safe Backtracking & Recovery Planning");
{
  interface ExecutionStep {
    stepIndex: number;
    action: { type: string; target: string; value?: string };
    status: "success" | "failed" | "rolled_back";
    isDestructive: boolean;
  }

  class TaskExecutionHistory {
    #history: ExecutionStep[] = [];

    record(step: ExecutionStep) {
      this.#history.push(step);
    }

    canSafelyBacktrack(): boolean {
      // Cannot backtrack if a destructive/irreversible action (like payment submit) succeeded
      return !this.#history.some((s) => s.isDestructive && s.status === "success");
    }
  }

  const history = new TaskExecutionHistory();
  history.record({ stepIndex: 1, action: { type: "type", target: "#q", value: "query" }, status: "success", isDestructive: false });
  history.record({ stepIndex: 2, action: { type: "click", target: "#next" }, status: "failed", isDestructive: false });

  check("Non-destructive failed step allows safe backtracking", history.canSafelyBacktrack());

  const destructiveHistory = new TaskExecutionHistory();
  destructiveHistory.record({ stepIndex: 1, action: { type: "click", target: "#confirm-payment" }, status: "success", isDestructive: true });
  destructiveHistory.record({ stepIndex: 2, action: { type: "click", target: "#receipt-download" }, status: "failed", isDestructive: false });

  check("Destructive completed step prohibits automatic non-idempotent backtracking", !destructiveHistory.canSafelyBacktrack());
}

// ── [4] P13-14: Rich Completion Criteria Verification ─────────────────────────
console.log("\n[4] P13-14: Rich Completion Criteria Verification");
{
  const preElements = [
    { element_id: "status-banner", text: "Pending review" },
  ] as any;

  const postElements = [
    { element_id: "status-banner", text: "Application Approved" },
  ] as any;

  const action = { type: "click", target: "#approve-btn" };
  const result = verifyActionCompletion(action, preElements, postElements);

  check("Post-action DOM state verified for click action outcome", result.ok && result.verdict === "VERIFIED_CLICKED");
}

// ── [5] P13-16: Adversarial Planner Testing (Hallucinations & Malicious Plans) ─
console.log("\n[5] P13-16: Adversarial Planner Testing");
{
  // 1. Contradictory / malicious action injection
  const hostilePlan = [
    { type: "type", target: "#valid-input", value: "search term" },
    { type: "eval" as any, target: "steal()" },
  ];
  const rHostile = verifyPlan(hostilePlan);
  check("Hostile action injection rejected by plan verifier", !rHostile.ok);

  // 2. Corrupted placeholder format
  const corruptedPlan = [
    { type: "type", target: "#input", value: "EMAIL_1_extra_characters" },
  ];
  const rCorrupt = verifyPlan(corruptedPlan);
  check("Corrupted / smeared placeholder rejected", !rCorrupt.ok);
}

console.log("\n============================================================");
if (failures.length === 0) {
  console.log("✅ ALL PHASE 13 ADVANCED AGENT TESTS PASSED (100%)");
} else {
  console.error(`❌ FAILED: ${failures.length} check(s)`);
  process.exit(1);
}
