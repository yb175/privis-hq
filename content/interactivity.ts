// content/interactivity.ts
// Interactive element validation and actionable state checking.
//
// PROVENANCE: ported from approved reference PravAl2028/SIH26171,
// extension/src/content/interactivity.ts (author-granted permission).
//
// Checks whether a DOM element is genuinely actionable before attempting clicks
// or keyboard input, avoiding wasted actions on disabled, inert, or non-interactive elements.

export interface InteractivityState {
  interactive: boolean;
  actionable: boolean;
  reason?: string;
}

const INTERACTIVE_TAGS = new Set([
  "button",
  "select",
  "textarea",
  "summary",
  "details",
]);

const ACTIONABLE_INPUT_TYPES = new Set([
  "text", "password", "email", "number", "search", "tel", "url",
  "button", "submit", "reset", "checkbox", "radio", "file", "date", "time", "color"
]);

const INTERACTIVE_ROLES = new Set([
  "button", "link", "checkbox", "radio", "combobox", "textbox",
  "tab", "menuitem", "menuitemcheckbox", "menuitemradio", "switch", "option", "searchbox"
]);

/**
 * Determines whether an element has interactive markup / semantic role.
 */
export function isInteractiveElement(el: Element): boolean {
  const tag = el.tagName.toLowerCase();
  if (INTERACTIVE_TAGS.has(tag)) return true;
  if (tag === "a" && el.hasAttribute("href")) return true;
  if (tag === "input") {
    const type = (el.getAttribute("type") || "text").toLowerCase();
    if (type !== "hidden") return true;
  }
  if (el.hasAttribute("contenteditable") && el.getAttribute("contenteditable") !== "false") return true;
  
  const role = el.getAttribute("role")?.toLowerCase();
  if (role && INTERACTIVE_ROLES.has(role)) return true;
  
  const tabIndex = el.getAttribute("tabindex");
  if (tabIndex !== null && parseInt(tabIndex, 10) >= 0) return true;

  return false;
}

/**
 * Checks if the element is currently actionable (not disabled, not inert, not hidden).
 */
export function checkInteractivity(el: Element): InteractivityState {
  if (!isInteractiveElement(el)) {
    return { interactive: false, actionable: false, reason: "non-interactive-element" };
  }

  // Disabled check
  if ((el as any).disabled === true || el.hasAttribute("disabled")) {
    return { interactive: true, actionable: false, reason: "disabled" };
  }
  if (el.getAttribute("aria-disabled") === "true") {
    return { interactive: true, actionable: false, reason: "aria-disabled" };
  }

  // Inert or aria-hidden or hidden ancestor
  if (el.hasAttribute("inert") || (typeof el.closest === "function" && el.closest("[inert]"))) {
    return { interactive: true, actionable: false, reason: "inert" };
  }
  if (el.getAttribute("aria-hidden") === "true" || (typeof el.closest === "function" && el.closest("[aria-hidden='true'], [hidden]"))) {
    return { interactive: true, actionable: false, reason: "aria-hidden" };
  }

  // Disabled fieldset check for form controls
  if (typeof el.closest === "function") {
    const disabledFieldset = el.closest("fieldset[disabled], fieldset:disabled");
    if (disabledFieldset) {
      const firstLegend = disabledFieldset.querySelector(":scope > legend");
      if (!firstLegend || !firstLegend.contains(el)) {
        return { interactive: true, actionable: false, reason: "disabled-fieldset" };
      }
    }
  }

  // Window/DOM environment computed styles check
  if (typeof window !== "undefined" && typeof window.getComputedStyle === "function") {
    try {
      const style = window.getComputedStyle(el);
      if (style.display === "none") {
        return { interactive: true, actionable: false, reason: "display-none" };
      }
      if (style.visibility === "hidden" || style.visibility === "collapse") {
        return { interactive: true, actionable: false, reason: "visibility-hidden" };
      }
      if (style.pointerEvents === "none") {
        return { interactive: true, actionable: false, reason: "pointer-events-none" };
      }
      if (parseFloat(style.opacity || "1") <= 0.01) {
        return { interactive: true, actionable: false, reason: "zero-opacity" };
      }
    } catch {
      // In testing environments without full CSS engine, proceed
    }
  }

  return { interactive: true, actionable: true };
}
