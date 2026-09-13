import assert from "node:assert";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseAgentAction } from "../remote-agent/types.js";

type Step = { path: string; elements: string[]; action: Record<string, unknown> };
type Scenario = { id: string; category: string; goal: string; steps: Step[] };
type Dataset = { version: number; scenarios: Scenario[] };

const dataset = JSON.parse(
  readFileSync(resolve("fixtures/agent-eval-scenarios.json"), "utf8")
) as Dataset;

assert.strictEqual(dataset.version, 1);
assert.strictEqual(dataset.scenarios.length, 30, "keep the initial evaluation corpus at 30 scenarios");

const ids = new Set<string>();
const categories = new Set(dataset.scenarios.map((scenario) => scenario.category));
for (const required of ["gmail", "spotify", "cart", "debug", "quiz", "uber", "research", "summarize"]) {
  assert.ok(categories.has(required), `missing ${required} coverage`);
}

for (const scenario of dataset.scenarios) {
  assert.ok(!ids.has(scenario.id), `duplicate scenario id: ${scenario.id}`);
  ids.add(scenario.id);
  assert.ok(scenario.goal.trim(), `${scenario.id}: goal is required`);
  assert.ok(scenario.steps.length > 0, `${scenario.id}: at least one deterministic step is required`);

  for (const [index, step] of scenario.steps.entries()) {
    assert.ok(step.path.startsWith("/"), `${scenario.id} step ${index}: use a synthetic local path`);
    assert.ok(step.elements.length > 0, `${scenario.id} step ${index}: page controls are required`);
    const action = parseAgentAction(step.action, scenario.goal);
    const target = (action as { target?: { css?: string } }).target;
    if (target?.css) {
      assert.ok(
        step.elements.includes(target.css),
        `${scenario.id} step ${index}: target ${target.css} is absent from the replay page`
      );
    }
    if (action.type === "type") {
      assert.ok(
        scenario.goal.toLowerCase().includes(action.placeholder.toLowerCase()),
        `${scenario.id} step ${index}: literal type input must be copied from the user goal`
      );
    }
  }
}

console.log(`PASS agent evaluation corpus: ${dataset.scenarios.length} synthetic replay scenarios`);
