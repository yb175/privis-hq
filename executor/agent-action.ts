// executor/agent-action.ts
// Bridge: validated AgentAction (remote brain) -> Local-Executor Action[].
//
// The remote brain may target elements by css, role, name, or bbox. The
// content-script executor only understands element ids / CSS selectors, so
// non-CSS targets are RESOLVED against the sanitized element list here —
// never silently dropped.

import type { Action, AgentAction, ElementMeta, Target } from "../types/index.js";

/**
 * Builds a resolver-friendly target for a sanitized element. Real DOM ids
 * resolve via #id; generated ids use a content-script-only lookup token.
 */
// CSS.escape exists in the extension service worker; this fallback only runs
// in Node tests. Per the CSSOM spec, hex escapes are always followed by a
// single space, and a leading digit must be escaped.
const cssEscape: (s: string) => string =
  typeof CSS !== "undefined"
    ? CSS.escape.bind(CSS)
    : (s) =>
        s.replace(/^[0-9]|[^a-zA-Z0-9_-]/g, (ch) => `\\${ch.charCodeAt(0).toString(16).toUpperCase()} `);

function selectorFor(el: ElementMeta): string {
  return el.generated ? `__privis_generated:${el.element_id}` : `#${cssEscape(el.element_id)}`;
}

/** Normalize visible text for name matching: casefold + collapse whitespace. */
function norm(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Effective ARIA role: explicit attribute wins; native tags synthesize the
 * role the model actually sees in a11y trees (a bare <button> has no role
 * ATTRIBUTE, so a `role: "button"` target must still match it).
 */
function effectiveRole(el: ElementMeta): string | null {
  if (el.role) return el.role;
  const t = el.tag.toLowerCase();
  if (t === "button" || (t === "input" && /^(submit|button|image)$/.test(el.type ?? "")))
    return "button";
  if (t === "a") return "link";
  if (t === "input" || t === "textarea")
    return el.type === "checkbox" || el.type === "radio" ? el.type ?? null : "textbox";
  if (t === "select") return "combobox";
  return null;
}

/**
 * Resolves a remote Target to a sanitized element: explicit css wins;
 * otherwise match by role, then by name (button/link visible text), then by
 * bbox overlap.
 */
function resolveTarget(
  target: Target | undefined,
  sanitized: ElementMeta[]
): ElementMeta | undefined {
  if (typeof target?.css === "string" && target.css.trim()) return undefined; // css used directly
  if (target?.role) {
    const want = norm(target.role);
    const byRole = sanitized.find((el) => effectiveRole(el) && norm(effectiveRole(el)!) === want);
    if (byRole) return byRole;
  }
  if (target?.name) {
    const want = norm(target.name);
    const byName = sanitized.find(
      (el) => (el.text && norm(el.text) === want) || (el.label && norm(el.label) === want)
    );
    if (byName) return byName;
  }
  if (target?.bbox) {
    const [bx, by, bw, bh] = target.bbox;
    const overlaps = (el: ElementMeta): boolean => {
      const [x, y, w, h] = el.bbox;
      return x < bx + bw && bx < x + w && y < by + bh && by < y + h;
    };
    const byBbox = sanitized.find(overlaps);
    if (byBbox) return byBbox;
  }
  return undefined;
}

function cssTarget(target: Target | undefined, sanitized: ElementMeta[]): string | undefined {
  if (typeof target?.css === "string" && target.css.trim()) return target.css.trim();
  const el = resolveTarget(target, sanitized);
  return el ? selectorFor(el) : undefined;
}

/**
 * Converts a validated AgentAction into Local-Executor Actions.
 * - click: css selector, or name/role/bbox resolved against the sanitized
 *   elements (then mapped to a resolver-friendly selector).
 * - type:  resolves the real value from the ON-DEVICE placeholder map — the
 *   executor types real values, never placeholder strings (CONTRACT.md rule 2).
 * - navigate/done/ask_human: handled by the orchestrator; scroll is bridged
 *   to the content script.
 */
export function agentActionToExecutorActions(
  action: AgentAction,
  sanitized: ElementMeta[],
  map: Record<string, string>,
  goal?: string
): Action[] {
  switch (action.type) {
    case "scroll":
      return [{ type: "scroll", target: "", dy: action.dy }];
    case "press_key":
    case "focus":
    case "hover":
    case "clear":
    case "check":
    case "uncheck": {
      const css = cssTarget(action.target, sanitized);
      return [{ type: action.type, target: css ?? `__unresolved:${JSON.stringify(action.target)}`, key: action.type === "press_key" ? action.key : undefined }];
    }
    case "select_option": {
      const css = cssTarget(action.target, sanitized);
      return [{ type: "select_option", target: css ?? `__unresolved:${JSON.stringify(action.target)}`, value: action.option }];
    }
    case "wait_for": {
      const css = cssTarget(action.target, sanitized);
      if (["element", "gone"].includes(action.condition) && !css) {
        return [{ type: "wait_for", target: `__unresolved:${JSON.stringify(action.target)}`, condition: action.condition, timeoutMs: action.timeoutMs }];
      }
      return [{
        type: "wait_for",
        target: css ?? "",
        condition: action.condition,
        value: action.needle ?? action.urlPattern,
        timeoutMs: action.timeoutMs,
      }];
    }
    case "go_back":
    case "go_forward":
    case "reload":
      return [{ type: action.type, target: "" }];
    case "click": {
      const t = action.target;
      const css =
        typeof t?.css === "string" && t.css.trim()
          ? t.css.trim()
          : (() => {
              const el = resolveTarget(t, sanitized);
              return el ? selectorFor(el) : undefined;
            })();
      // Unresolvable click must surface as a FAILURE, not a silent no-op —
      // callers must not record it as ok (runStep turns this into ok:false).
      if (!css)
        return [
          {
            type: "click",
            target: `__unresolved:${JSON.stringify(t ?? null)}`,
          },
        ];
      return [{ type: "click", target: css }];
    }
    case "type": {
      const t = action.target;
      // The placeholder identifies the exact field. Prefer it over a broad
      // role/name target so EMAIL_1 and EMAIL_2 cannot land in the same box.
      const valueEl = sanitized.find((e) => e.text === action.placeholder);
      const explicitCss = typeof t?.css === "string" && t.css.trim() ? t.css.trim() : undefined;
      const css = valueEl
        ? selectorFor(valueEl)
        : explicitCss ??
          (() => {
            const el = resolveTarget(t, sanitized);
            return el ? selectorFor(el) : undefined;
          })();
      const real = valueEl ? map[valueEl.element_id] : undefined;
      if (css && real !== undefined) return [{ type: "type", target: css, value: real }];
      // Non-token placeholder: a literal phrase (e.g. a search query). The
      // SERVER's guard only allows goal substrings, but the server is not
      // trusted for execution — re-verify against the on-device goal before
      // typing. Anything else stays a no-op so runStep escalates.
      if (css && goal) {
        const needle = action.placeholder.trim().toLowerCase();
        if (needle && goal.toLowerCase().replace(/\s+/g, " ").includes(needle)) {
          return [{ type: "type", target: css, value: action.placeholder.trim() }];
        }
      }
      return [];
    }
    default:
      return [];
  }
}
