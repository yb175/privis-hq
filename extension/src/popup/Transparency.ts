// extension/src/popup/Transparency.ts
// CBA-11: Session Transparency Log Jury UI
// Renders persistent on-device audit logs from chrome.storage.local:
// Sessions -> Steps -> Side-by-side redacted screenshot + wire elements + actions + digests.

import type {
  TransparencyEntry,
  TransparencyLogStore,
  AgentAction,
} from "../../../types/index.js";
import {
  TRANSPARENCY_STORAGE_KEY,
  computeRequestDigest,
} from "../../../utils/digest.js";

export class TransparencyComponent {
  private container: HTMLElement;
  private selectedSessionId: string | null = null;

  constructor() {
    this.container = document.getElementById(
      "transparency-container"
    ) as HTMLElement;
    this.init();
  }

  public async refresh() {
    await this.render();
  }

  private async init() {
    await this.render();
  }

  private async loadStore(): Promise<TransparencyLogStore> {
    if (
      typeof chrome !== "undefined" &&
      chrome.storage &&
      chrome.storage.local &&
      typeof chrome.storage.local.get === "function"
    ) {
      try {
        const res = await chrome.storage.local.get(TRANSPARENCY_STORAGE_KEY);
        const data = res?.[TRANSPARENCY_STORAGE_KEY];
        if (data && Array.isArray((data as TransparencyLogStore).entries)) {
          return data as TransparencyLogStore;
        }
      } catch (err) {
        console.warn("Transparency: Failed to load from chrome.storage.local", err);
      }
    }
    return { version: 1, prunedCount: 0, entries: [] };
  }

  private async render() {
    if (!this.container) return;
    this.container.innerHTML = "";

    const store = await this.loadStore();

    // Top Controls Bar (Header, stats, and reload)
    const headerBar = document.createElement("div");
    headerBar.className = "transparency-header-bar";

    const titleEl = document.createElement("div");
    titleEl.className = "transparency-title";
    titleEl.textContent = "AI Agent Transparency Log";

    const controlsEl = document.createElement("div");
    controlsEl.className = "transparency-controls";

    const refreshBtn = document.createElement("button");
    refreshBtn.type = "button";
    refreshBtn.className = "transparency-refresh-btn";
    refreshBtn.title = "Refresh audit log";
    refreshBtn.textContent = "↻ Refresh";
    refreshBtn.addEventListener("click", () => this.render());

    controlsEl.appendChild(refreshBtn);
    headerBar.append(titleEl, controlsEl);
    this.container.appendChild(headerBar);

    // Pruned notice banner if storage quota evicted older sessions (AC-5)
    if (store.prunedCount > 0) {
      const pruneBanner = document.createElement("div");
      pruneBanner.className = "transparency-prune-banner";
      pruneBanner.innerHTML = `<span>⚠️ <strong>${store.prunedCount}</strong> older session(s) pruned to stay under 4MB storage quota.</span>`;
      this.container.appendChild(pruneBanner);
    }

    if (store.entries.length === 0) {
      const emptyState = document.createElement("div");
      emptyState.className = "transparency-empty";
      emptyState.innerHTML = `
        <div class="empty-icon">🛡️</div>
        <div class="empty-title">No Outbound Dispatches Yet</div>
        <div class="empty-desc">Run a goal in the Chat tab. Every /plan request that leaves this device will be logged here with wire truth.</div>
      `;
      this.container.appendChild(emptyState);
      return;
    }

    // Group entries by session
    const sessionsMap = new Map<string, TransparencyEntry[]>();
    for (const entry of store.entries) {
      if (!sessionsMap.has(entry.sessionId)) {
        sessionsMap.set(entry.sessionId, []);
      }
      sessionsMap.get(entry.sessionId)!.push(entry);
    }

    // Order sessions newest first
    const sessions = Array.from(sessionsMap.entries()).reverse();

    // Auto-select latest session if none selected
    if (
      !this.selectedSessionId ||
      !sessionsMap.has(this.selectedSessionId)
    ) {
      this.selectedSessionId = sessions[0][0];
    }

    // Session Selector Cards
    const sessionNav = document.createElement("div");
    sessionNav.className = "session-selector-list";

    for (const [sessId, entries] of sessions) {
      const latestEntry = entries[entries.length - 1];
      const isSelected = sessId === this.selectedSessionId;

      const card = document.createElement("button");
      card.type = "button";
      card.className = `session-selector-card ${isSelected ? "active" : ""}`;
      card.setAttribute("aria-selected", isSelected ? "true" : "false");

      const timeStr = new Date(entries[0].timestamp).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });

      card.innerHTML = `
        <div class="session-card-top">
          <span class="session-goal" title="${entries[0].goal}">${entries[0].goal}</span>
          <span class="session-model-pill">${latestEntry.model || "chatgpt"}</span>
        </div>
        <div class="session-card-meta">
          <span>${entries.length} step${entries.length === 1 ? "" : "s"}</span>
          <span>•</span>
          <span>${timeStr}</span>
          <span>•</span>
          <span class="session-id-pill">${sessId.slice(0, 14)}…</span>
        </div>
      `;

      card.addEventListener("click", () => {
        this.selectedSessionId = sessId;
        this.render();
      });

      sessionNav.appendChild(card);
    }

    this.container.appendChild(sessionNav);

    // Render Steps for the selected session
    const currentEntries = sessionsMap.get(this.selectedSessionId!) || [];
    // Sort steps strictly ascending (1, 2, 3...)
    currentEntries.sort((a, b) => a.step - b.step);

    const stepsContainer = document.createElement("div");
    stepsContainer.className = "transparency-steps-container";

    for (const entry of currentEntries) {
      const stepCard = await this.renderStepCard(entry);
      stepsContainer.appendChild(stepCard);
    }

    this.container.appendChild(stepsContainer);
  }

  private async renderStepCard(entry: TransparencyEntry): Promise<HTMLElement> {
    const card = document.createElement("div");
    card.className = "transparency-step-card";

    // Tamper digest verification (AC-4)
    let digestVerified = false;
    try {
      const computed = await computeRequestDigest(entry.request);
      digestVerified = computed === entry.requestDigest;
    } catch {
      digestVerified = false;
    }

    // Step Card Header
    const header = document.createElement("div");
    header.className = "step-card-header";

    const stepNum = document.createElement("div");
    stepNum.className = "step-card-title";
    stepNum.textContent = `Step ${entry.step}`;

    const digestEl = document.createElement("div");
    digestEl.className = `digest-badge ${digestVerified ? "verified" : "tampered"}`;
    digestEl.title = `SHA-256 Digest: ${entry.requestDigest}`;
    digestEl.innerHTML = `
      <span class="digest-label">SHA-256:</span>
      <code class="digest-hash">${entry.requestDigest.slice(0, 10)}…</code>
      <span class="digest-status">${digestVerified ? "✓ Verified" : "⚠️ Mismatch"}</span>
    `;

    header.append(stepNum, digestEl);
    card.appendChild(header);

    // Gate decision chip
    const gateBar = document.createElement("div");
    gateBar.className = "step-gate-bar";
    const decision = entry.gate?.decision || "allow";
    gateBar.innerHTML = `
      <span class="gate-pill ${decision}">${decision.toUpperCase()}</span>
      <span class="gate-reason">${entry.gate?.reason || "Policy gate cleared"}</span>
    `;
    card.appendChild(gateBar);

    // Side-by-side Wire View Grid
    const wireGrid = document.createElement("div");
    wireGrid.className = "wire-grid";

    // Column 1: Sanitized Redacted Screenshot (Proof of Visual Redaction)
    const colVisual = document.createElement("div");
    colVisual.className = "wire-col visual-col";
    const visualHeading = document.createElement("div");
    visualHeading.className = "wire-col-title";
    visualHeading.textContent = "Sanitized Screenshot (Wire)";

    colVisual.appendChild(visualHeading);

    if (entry.request?.sanitizedScreenshot) {
      const imgWrap = document.createElement("div");
      imgWrap.className = "screenshot-wrapper";
      const img = document.createElement("img");
      img.className = "transparency-screenshot";
      img.src = entry.request.sanitizedScreenshot;
      img.alt = `Sanitized screenshot for step ${entry.step}`;
      imgWrap.appendChild(img);
      colVisual.appendChild(imgWrap);
    } else {
      const noImg = document.createElement("div");
      noImg.className = "no-image-notice";
      noImg.textContent = entry.error ? "Blocked before dispatch" : "No screenshot stored";
      colVisual.appendChild(noImg);
    }

    // Column 2: Structural Elements & Action Sent/Returned
    const colWire = document.createElement("div");
    colWire.className = "wire-col context-col";
    const wireHeading = document.createElement("div");
    wireHeading.className = "wire-col-title";
    wireHeading.textContent = "Sent Context & Response";
    colWire.appendChild(wireHeading);

    // Target URL
    const urlEl = document.createElement("div");
    urlEl.className = "wire-url";
    urlEl.textContent = entry.request?.sanitizedContext?.browserState?.url || "about:blank";
    colWire.appendChild(urlEl);

    // Elements sent list
    const elementsList = document.createElement("div");
    elementsList.className = "wire-elements-list";

    const elements = entry.request?.sanitizedContext?.elements || [];
    if (elements.length === 0) {
      const emptyEl = document.createElement("div");
      emptyEl.className = "wire-empty-note";
      emptyEl.textContent = "Zero page elements dispatched.";
      elementsList.appendChild(emptyEl);
    } else {
      for (const el of elements) {
        const row = document.createElement("div");
        row.className = "wire-element-row";

        const tagRole = document.createElement("span");
        tagRole.className = "element-tag-role";
        tagRole.textContent = el.role || el.type || el.tag;

        const textVal = document.createElement("span");
        textVal.className = "element-text-val";
        // Shows placeholders e.g. PAN_1, never real values!
        textVal.textContent = el.text || "—";
        if (/^[A-Z]+_\d+$/.test(el.text)) {
          textVal.classList.add("is-placeholder");
        }

        row.append(tagRole, textVal);
        elementsList.appendChild(row);
      }
    }
    colWire.appendChild(elementsList);

    // Response Action / Gate Block outcome
    const responseBox = document.createElement("div");
    responseBox.className = "wire-response-box";

    if (entry.response) {
      responseBox.appendChild(this.formatActionDisplay(entry.response));
    } else {
      const blockedCallout = document.createElement("div");
      blockedCallout.className = "blocked-callout";
      blockedCallout.innerHTML = `
        <span class="blocked-title">No AI Action (Refused / Error)</span>
        <span class="blocked-desc">${entry.error || entry.gate.reason}</span>
      `;
      responseBox.appendChild(blockedCallout);
    }

    colWire.appendChild(responseBox);

    wireGrid.append(colVisual, colWire);
    card.appendChild(wireGrid);

    return card;
  }

  private formatActionDisplay(action: AgentAction): HTMLElement {
    const wrap = document.createElement("div");
    wrap.className = "action-display-pill";

    const label = document.createElement("span");
    label.className = "action-label";
    label.textContent = "AI Agent Action:";

    const val = document.createElement("span");
    val.className = "action-val";

    switch (action.type) {
      case "type":
        val.innerHTML = `<code>type</code> <span class="action-token">${action.placeholder}</span> into <em>${action.target.name || action.target.css || "element"}</em>`;
        break;
      case "click":
        val.innerHTML = `<code>click</code> <em>${action.target.name || action.target.css || "element"}</em>`;
        break;
      case "navigate":
        val.innerHTML = `<code>navigate</code> <em>${action.url}</em>`;
        break;
      case "scroll":
        val.innerHTML = `<code>scroll</code> <em>${action.dy}px</em>`;
        break;
      case "done":
        val.innerHTML = `<code>done</code> (${action.reason || "complete"})`;
        break;
      case "ask_human":
        val.innerHTML = `<code>ask_human</code> (${action.reason})`;
        break;
      default:
        val.textContent = JSON.stringify(action);
    }

    wrap.append(label, val);
    return wrap;
  }
}
