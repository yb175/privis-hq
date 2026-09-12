import assert from "node:assert";

class FakeElement {
  id: string;
  type = "text";
  value = "old";
  checked = false;
  focused = false;
  events: string[] = [];
  options: FakeElement[] = [];
  textContent = "";
  dataset: Record<string, string> = {};

  constructor(id: string) {
    this.id = id;
  }

  focus() {
    this.focused = true;
  }

  click() {
    this.events.push("click");
    if (this.type === "checkbox" || this.type === "radio") this.checked = !this.checked;
  }

  getBoundingClientRect() { return { x: 0, y: 0, width: 100, height: 30 }; }
  contains() { return false; }

  dispatchEvent(event: { type: string }) {
    this.events.push(event.type);
    return true;
  }
}

class FakeInput extends FakeElement {}
class FakeSelect extends FakeElement {
  type = "select-one";
}

const elements = new Map<string, FakeElement>();
const select = new FakeSelect("country");
select.options = [
  Object.assign(new FakeElement("india-option"), { value: "in", textContent: "India" }),
  Object.assign(new FakeElement("us-option"), { value: "us", textContent: "United States" }),
];
const checkbox = new FakeInput("remember");
checkbox.type = "checkbox";
const input = new FakeInput("search");
for (const element of [select, checkbox, input]) elements.set(element.id, element);

(globalThis as any).chrome = { runtime: { onMessage: { addListener() {} } } };
(globalThis as any).document = {
  getElementById: (id: string) => elements.get(id) ?? null,
  querySelector: (selector: string) => selector.startsWith("#") ? elements.get(selector.slice(1)) ?? null : null,
  querySelectorAll: () => [],
  elementFromPoint: () => null,
  body: { innerText: "Added to cart", innerHTML: "stable" },
};
(globalThis as any).HTMLInputElement = FakeInput;
(globalThis as any).HTMLSelectElement = FakeSelect;
(globalThis as any).Event = class Event { constructor(public type: string) {} };
(globalThis as any).KeyboardEvent = class KeyboardEvent {
  constructor(public type: string, public init: Record<string, unknown>) {}
};
(globalThis as any).MouseEvent = class MouseEvent { constructor(public type: string) {} };
(globalThis as any).window = {
  history: { back() {}, forward() {} },
  location: { href: "http://demo.test/cart", reload() {} },
  scrollBy() {},
};

const { executeAction } = await import("../content/capture-content.js");

const selected = await executeAction({ type: "select_option", target: "#country", value: "India" });
assert.deepStrictEqual(selected, { ok: true });
assert.strictEqual(select.value, "in");

const checked = await executeAction({ type: "check", target: "#remember" });
assert.deepStrictEqual(checked, { ok: true });
assert.strictEqual(checkbox.checked, true);
assert.ok(checkbox.events.includes("click"));
const unchecked = await executeAction({ type: "uncheck", target: "#remember" });
assert.deepStrictEqual(unchecked, { ok: true });
assert.strictEqual(checkbox.checked, false);

assert.deepStrictEqual(await executeAction({ type: "focus", target: "#search" }), { ok: true });
assert.strictEqual(input.focused, true);
assert.deepStrictEqual(await executeAction({ type: "hover", target: "#search" }), { ok: true });
(input as any).disabled = true;
assert.deepStrictEqual(await executeAction({ type: "click", target: "#search" }), {
  ok: false, code: "NOT_INTERACTABLE", error: "Target is disabled",
});
(input as any).disabled = false;
assert.deepStrictEqual(await executeAction({ type: "clear", target: "#search" }), { ok: true });
assert.strictEqual(input.value, "");
assert.deepStrictEqual(await executeAction({ type: "press_key", target: "#search", key: "Enter" }), { ok: true });
assert.ok(input.events.includes("keydown"));

assert.deepStrictEqual(await executeAction({ type: "wait_for", target: "", condition: "text", value: "Added to cart", timeoutMs: 10 }), { ok: true });
let delayedText = "Loading";
Object.defineProperty(document.body, "innerText", { configurable: true, get: () => delayedText });
setTimeout(() => { delayedText = "Autocomplete result"; }, 25);
assert.deepStrictEqual(await executeAction({ type: "wait_for", target: "", condition: "text", value: "Autocomplete result", timeoutMs: 200 }), { ok: true });
assert.deepStrictEqual(await executeAction({ type: "wait_for", target: "", condition: "stable", timeoutMs: 300 }), { ok: true });
assert.deepStrictEqual(await executeAction({ type: "click", target: "#missing" }), {
  ok: false,
  code: "TARGET_NOT_FOUND",
  error: "Target not found: #missing",
});
assert.deepStrictEqual(await executeAction({ type: "select_option", target: "#search", value: "India" }), {
  ok: false,
  code: "UNSUPPORTED_CONTROL",
  error: "Not a select element: #search",
});

console.log("=== Executor action tests passed ===");
