import assert from "node:assert";

class FakeElement {
  id = "";
  value = "";
  type = "text";
  checked = false;
  disabled = false;
  textContent = "";
  isContentEditable = false;
  attrs: Record<string, string> = {};
  constructor(public tagName: string, text = "") { this.textContent = text; }
  getAttribute(name: string) { return this.attrs[name] ?? null; }
  hasAttribute(name: string) { return name in this.attrs; }
  getBoundingClientRect() { return { x: 10, y: 20, width: 100, height: 30 }; }
  matches() { return false; }
  closest() { return null; }
}

const link = new FakeElement("A", "Reports");
const tab = new FakeElement("DIV", "Overview");
tab.attrs = { role: "tab", "aria-selected": "true" };
const checkbox = new FakeElement("INPUT");
checkbox.id = "remember";
checkbox.type = "checkbox";
checkbox.checked = true;
const editor = new FakeElement("DIV", "Draft");
editor.attrs = { contenteditable: "plaintext-only" };
editor.isContentEditable = true;
const ariaDisabledButton = new FakeElement("BUTTON", "Unavailable");
ariaDisabledButton.attrs = { "aria-disabled": "true" };
const elements = [link, tab, checkbox, editor, ariaDisabledButton];

(globalThis as any).CSS = { escape: (value: string) => value };
(globalThis as any).document = {
  querySelectorAll: (selector: string) => selector.includes("label") ? [] : elements,
  querySelector: () => null,
  getElementById: () => null,
  activeElement: checkbox,
};
(globalThis as any).getComputedStyle = () => ({ display: "block", visibility: "visible" });

const { extractElements } = await import("../utils/dom-extractor.js");
const snapshot = extractElements(7);

assert.deepStrictEqual(snapshot.map((element) => element.role), ["link", "tab", "checkbox", "textbox", "button"]);
assert.ok(snapshot.every((element) => element.snapshotVersion === 7));
assert.strictEqual(snapshot[2].checked, true);
assert.strictEqual(snapshot[2].focused, true);
assert.strictEqual(snapshot[1].selected, true);
assert.strictEqual(snapshot[3].text, "Draft");
assert.strictEqual(snapshot[4].disabled, true);
console.log("=== Semantic capture tests passed ===");
