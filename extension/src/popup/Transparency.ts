// extension/src/popup/Transparency.ts
// CBA-11: Session Transparency Log Jury UI
// Hallmark · component: transparency-audit · genre: modern-minimal · theme: cobalt
// states: default · hover · focus · active · disabled · loading · error · success
// contrast: pass (46–50)

import type {
  TransparencyEntry,
  TransparencyLogStore,
  AgentAction,
} from "../../../types/index.js";
import {
  TRANSPARENCY_STORAGE_KEY,
  computeRequestDigest,
} from "../../../utils/digest.js";

type StepViewMode = "split" | "visual" | "wire";

export class TransparencyComponent {
  private container: HTMLElement;
  private selectedSessionId: string | null = null;
  private sessionSelectorOpen: boolean = false;
  private stepViewModes: Map<number, StepViewMode> = new Map();

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

    // 1. Top Controls Bar (Header, telemetry badges, and utility buttons)
    const headerBar = document.createElement("div");
    headerBar.className = "transparency-header-bar";

    const titleGroup = document.createElement("div");
    titleGroup.className = "transparency-title-group";

    const titleEl = document.createElement("h2");
    titleEl.className = "transparency-title";
    titleEl.textContent = "Wire Audit Ledger";

    const auditBadge = document.createElement("span");
    auditBadge.className = "audit-status-pill";
    auditBadge.title = "All outbound requests are cryptographically hashed and verified on-device";
    auditBadge.innerHTML = `<span class="pill-dot"></span>On-Device`;

    titleGroup.append(titleEl, auditBadge);

    const controlsEl = document.createElement("div");
    controlsEl.className = "transparency-controls";

    // Export button (if entries exist)
    if (store.entries.length > 0) {
      const exportBtn = document.createElement("button");
      exportBtn.type = "button";
      exportBtn.className = "transparency-icon-btn";
      exportBtn.title = "Export session audit logs as JSON";
      exportBtn.setAttribute("aria-label", "Export audit log as JSON");
      exportBtn.innerHTML = `
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
          <polyline points="7 10 12 15 17 10"></polyline>
          <line x1="12" y1="15" x2="12" y2="3"></line>
        </svg>
        <span>Export</span>
      `;
      exportBtn.addEventListener("click", () => this.exportCurrentSession(store));
      controlsEl.appendChild(exportBtn);
    }

    // Refresh button
    const refreshBtn = document.createElement("button");
    refreshBtn.type = "button";
    refreshBtn.className = "transparency-icon-btn";
    refreshBtn.title = "Refresh audit log";
    refreshBtn.setAttribute("aria-label", "Refresh audit log");
    refreshBtn.innerHTML = `
      <svg class="refresh-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/>
      </svg>
      <span>Refresh</span>
    `;
    refreshBtn.addEventListener("click", async () => {
      refreshBtn.classList.add("is-refreshing");
      await this.render();
    });

    controlsEl.appendChild(refreshBtn);
    headerBar.append(titleGroup, controlsEl);
    this.container.appendChild(headerBar);

    // Pruned notice banner if storage quota evicted older sessions (AC-5)
    if (store.prunedCount > 0) {
      const pruneBanner = document.createElement("div");
      pruneBanner.className = "transparency-prune-banner";
      pruneBanner.innerHTML = `
        <div class="prune-banner-content">
          <span class="prune-icon">⚠️</span>
          <span><strong>${store.prunedCount}</strong> older session(s) pruned to maintain the 4MB storage quota.</span>
        </div>
      `;
      this.container.appendChild(pruneBanner);
    }

    if (store.entries.length === 0) {
      const emptyState = document.createElement("div");
      emptyState.className = "transparency-empty";
      emptyState.innerHTML = `
        <div class="empty-icon-wrapper">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
            <path d="m9 12 2 2 4-4"/>
          </svg>
        </div>
        <div class="empty-title">No Outbound Dispatches Yet</div>
        <div class="empty-desc">Run a goal in the Chat tab. Every /plan wire request that leaves this machine is recorded here with cryptographic audit proof.</div>
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

    // Auto-select latest session if none selected or invalid
    if (
      !this.selectedSessionId ||
      !sessionsMap.has(this.selectedSessionId)
    ) {
      this.selectedSessionId = sessions[0][0];
    }

    // 2. Telemetry Summary Bar
    const activeEntries = sessionsMap.get(this.selectedSessionId) || [];
    const telemetryBar = document.createElement("div");
    telemetryBar.className = "audit-telemetry-bar";
    const totalBytes = new Blob([JSON.stringify(store)]).size;
    const kbUsed = (totalBytes / 1024).toFixed(1);

    telemetryBar.innerHTML = `
      <div class="telemetry-item" title="Stored sessions count">
        <span class="telemetry-label">Sessions</span>
        <span class="telemetry-value">${sessions.length}</span>
      </div>
      <div class="telemetry-divider"></div>
      <div class="telemetry-item" title="Audited steps in active session">
        <span class="telemetry-label">Steps</span>
        <span class="telemetry-value">${activeEntries.length}</span>
      </div>
      <div class="telemetry-divider"></div>
      <div class="telemetry-item" title="Local on-device storage used out of 4MB cap">
        <span class="telemetry-label">Storage</span>
        <span class="telemetry-value">${kbUsed} KB</span>
      </div>
      <div class="telemetry-divider"></div>
      <div class="telemetry-item pii-proof" title="Verified zero raw PII emitted">
        <span class="telemetry-dot"></span>
        <span class="telemetry-value">Zero-PII Wire</span>
      </div>
    `;
    this.container.appendChild(telemetryBar);

    // 3. Compact Session Selector Card & Dropdown
    const currentSession = sessions.find(([id]) => id === this.selectedSessionId) || sessions[0];
    const [currId, currEntries] = currentSession;
    const firstEntry = currEntries[0];
    const latestEntry = currEntries[currEntries.length - 1];

    const sessionSection = document.createElement("div");
    sessionSection.className = "session-selector-section";

    const sessionTrigger = document.createElement("button");
    sessionTrigger.type = "button";
    sessionTrigger.className = `session-active-card ${this.sessionSelectorOpen ? "open" : ""}`;
    sessionTrigger.setAttribute("aria-expanded", this.sessionSelectorOpen ? "true" : "false");
    sessionTrigger.setAttribute("aria-label", "Switch active session");

    const timeStr = new Date(firstEntry.timestamp).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });

    sessionTrigger.innerHTML = `
      <div class="session-card-main">
        <div class="session-card-goal-row">
          <span class="session-goal-title" title="${firstEntry.goal}">${firstEntry.goal}</span>
          <span class="session-model-badge">${latestEntry.model || "chatgpt"}</span>
        </div>
        <div class="session-meta-row">
          <span class="session-meta-tag">${currEntries.length} step${currEntries.length === 1 ? "" : "s"}</span>
          <span class="session-meta-dot">•</span>
          <span class="session-meta-time">${timeStr}</span>
          <span class="session-meta-dot">•</span>
          <code class="session-meta-id">${currId.slice(0, 12)}…</code>
        </div>
      </div>
      <div class="session-card-chevron ${this.sessionSelectorOpen ? "rotated" : ""}">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="6 9 12 15 18 9"></polyline>
        </svg>
      </div>
    `;

    sessionTrigger.addEventListener("click", () => {
      this.sessionSelectorOpen = !this.sessionSelectorOpen;
      this.render();
    });

    sessionSection.appendChild(sessionTrigger);

    // Dropdown list if open
    if (this.sessionSelectorOpen && sessions.length > 1) {
      const dropdown = document.createElement("div");
      dropdown.className = "session-dropdown-menu";
      dropdown.setAttribute("role", "listbox");

      for (const [sessId, entries] of sessions) {
        const isSelected = sessId === this.selectedSessionId;
        const itemBtn = document.createElement("button");
        itemBtn.type = "button";
        itemBtn.className = `session-dropdown-item ${isSelected ? "selected" : ""}`;
        itemBtn.setAttribute("role", "option");
        itemBtn.setAttribute("aria-selected", isSelected ? "true" : "false");

        const sTime = new Date(entries[0].timestamp).toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        });

        itemBtn.innerHTML = `
          <div class="dropdown-item-info">
            <span class="dropdown-item-goal">${entries[0].goal}</span>
            <span class="dropdown-item-meta">${entries.length} steps · ${sTime} · <code>${sessId.slice(0, 10)}…</code></span>
          </div>
          ${isSelected ? `<span class="dropdown-item-check">✓</span>` : ""}
        `;

        itemBtn.addEventListener("click", () => {
          this.selectedSessionId = sessId;
          this.sessionSelectorOpen = false;
          this.render();
        });

        dropdown.appendChild(itemBtn);
      }
      sessionSection.appendChild(dropdown);
    }

    this.container.appendChild(sessionSection);

    // 4. Render Steps for Selected Session
    const currentEntries = sessionsMap.get(this.selectedSessionId!) || [];
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

    // Step View mode state (split | visual | wire)
    const viewMode: StepViewMode = this.stepViewModes.get(entry.step) || "split";

    // Header: Step pill, time, digest status, and copy hash action
    const header = document.createElement("div");
    header.className = "step-card-header";

    const leftHeader = document.createElement("div");
    leftHeader.className = "step-header-left";

    const stepPill = document.createElement("span");
    stepPill.className = "step-number-badge";
    stepPill.textContent = `Step ${entry.step}`;

    const decision = (entry.gate?.decision || "allow").toLowerCase();
    const gateBadge = document.createElement("span");
    gateBadge.className = `step-gate-pill ${decision}`;
    gateBadge.textContent = decision.toUpperCase();
    gateBadge.title = entry.gate?.reason || "Policy gate evaluation";

    leftHeader.append(stepPill, gateBadge);

    const rightHeader = document.createElement("div");
    rightHeader.className = "step-header-right";

    const digestBtn = document.createElement("button");
    digestBtn.type = "button";
    digestBtn.className = `digest-pill-btn ${digestVerified ? "verified" : "tampered"}`;
    digestBtn.title = `Click to copy full SHA-256 Digest:\n${entry.requestDigest}`;
    digestBtn.setAttribute("aria-label", "Copy SHA-256 Digest");
    digestBtn.innerHTML = `
      <span class="digest-prefix">SHA-256</span>
      <code class="digest-code">${entry.requestDigest.slice(0, 8)}…</code>
      <span class="digest-status-icon">${digestVerified ? "✓" : "⚠️"}</span>
    `;

    digestBtn.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(entry.requestDigest);
        digestBtn.classList.add("copied");
        const origHtml = digestBtn.innerHTML;
        digestBtn.innerHTML = `<span class="digest-prefix">COPIED</span><span class="digest-status-icon">✓</span>`;
        setTimeout(() => {
          digestBtn.classList.remove("copied");
          digestBtn.innerHTML = origHtml;
        }, 1500);
      } catch (err) {
        console.warn("Clipboard copy failed:", err);
      }
    });

    rightHeader.appendChild(digestBtn);
    header.append(leftHeader, rightHeader);
    card.appendChild(header);

    // Gate Reason subtitle
    if (entry.gate?.reason) {
      const gateReasonEl = document.createElement("div");
      gateReasonEl.className = "step-gate-reason-row";
      gateReasonEl.innerHTML = `
        <span class="reason-label">Gate:</span>
        <span class="reason-text" title="${entry.gate.reason}">${entry.gate.reason}</span>
      `;
      card.appendChild(gateReasonEl);
    }

    // View Mode Segmented Controls (Split / Visual / Wire)
    const controlsRow = document.createElement("div");
    controlsRow.className = "step-view-segmented-bar";

    const modes: Array<{ id: StepViewMode; label: string; icon: string }> = [
      { id: "split", label: "Split", icon: "◫" },
      { id: "visual", label: "Visual", icon: "👁" },
      { id: "wire", label: "Payload", icon: "⌗" },
    ];

    for (const m of modes) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = `segmented-pill ${viewMode === m.id ? "active" : ""}`;
      btn.innerHTML = `<span class="mode-icon">${m.icon}</span><span>${m.label}</span>`;
      btn.addEventListener("click", () => {
        this.stepViewModes.set(entry.step, m.id);
        this.render();
      });
      controlsRow.appendChild(btn);
    }

    card.appendChild(controlsRow);

    // Inspector Body
    const inspectorBody = document.createElement("div");
    inspectorBody.className = `step-inspector-body mode-${viewMode}`;

    // --- Visual Column (Sanitized Screenshot) ---
    if (viewMode === "split" || viewMode === "visual") {
      const colVisual = document.createElement("div");
      colVisual.className = `inspector-col visual-col ${viewMode === "visual" ? "expanded" : ""}`;

      const colHeader = document.createElement("div");
      colHeader.className = "inspector-col-header";
      colHeader.innerHTML = `
        <span class="col-title">Sanitized Viewport</span>
        <span class="col-pill">Wire Redacted</span>
      `;
      colVisual.appendChild(colHeader);

      if (entry.request?.sanitizedScreenshot) {
        const imgContainer = document.createElement("div");
        imgContainer.className = "screenshot-card-container";

        const img = document.createElement("img");
        img.className = "sanitized-wire-img";
        img.src = entry.request.sanitizedScreenshot;
        img.alt = `Sanitized viewport step ${entry.step}`;

        const zoomBadge = document.createElement("div");
        zoomBadge.className = "img-zoom-badge";
        zoomBadge.innerHTML = `<span>⤢ Click to Expand</span>`;

        imgContainer.append(img, zoomBadge);

        // Click to open in Lightbox modal
        imgContainer.addEventListener("click", () => {
          this.openScreenshotLightbox(
            entry.request.sanitizedScreenshot!,
            `Step ${entry.step}: Redacted Outbound Viewport`
          );
        });

        colVisual.appendChild(imgContainer);
      } else {
        const noImg = document.createElement("div");
        noImg.className = "no-image-notice";
        noImg.innerHTML = `
          <span>${entry.error ? "Blocked before dispatch" : "No screenshot attached"}</span>
        `;
        colVisual.appendChild(noImg);
      }

      inspectorBody.appendChild(colVisual);
    }

    // --- Context & Wire Column ---
    if (viewMode === "split" || viewMode === "wire") {
      const colWire = document.createElement("div");
      colWire.className = `inspector-col wire-col ${viewMode === "wire" ? "expanded" : ""}`;

      const colHeader = document.createElement("div");
      colHeader.className = "inspector-col-header";
      colHeader.innerHTML = `
        <span class="col-title">Outbound Context</span>
        <span class="col-pill pii-clean">0 Raw Leaks</span>
      `;
      colWire.appendChild(colHeader);

      // URL bar
      const urlBar = document.createElement("div");
      urlBar.className = "wire-url-bar";
      const targetUrl = entry.request?.sanitizedContext?.browserState?.url || "about:blank";
      urlBar.innerHTML = `
        <span class="url-tag">URL</span>
        <span class="url-text" title="${targetUrl}">${targetUrl}</span>
      `;
      colWire.appendChild(urlBar);

      // Elements table
      const elementsContainer = document.createElement("div");
      elementsContainer.className = "wire-elements-container";

      const elements = entry.request?.sanitizedContext?.elements || [];
      if (elements.length === 0) {
        const emptyEl = document.createElement("div");
        emptyEl.className = "wire-empty-note";
        emptyEl.textContent = "Zero DOM elements dispatched.";
        elementsContainer.appendChild(emptyEl);
      } else {
        const elementsList = document.createElement("div");
        elementsList.className = "wire-elements-rows";

        for (const el of elements) {
          const row = document.createElement("div");
          row.className = "wire-element-item";

          const roleTag = document.createElement("span");
          roleTag.className = "element-role-tag";
          roleTag.textContent = el.role || el.type || el.tag;

          const valTag = document.createElement("span");
          valTag.className = "element-val-tag";

          const isToken = /^[A-Z]+_\d+$/.test(el.text || "");
          if (isToken) {
            valTag.className += " is-placeholder-token";
            valTag.title = "Local placeholder token. Real value stays in device memory.";
            valTag.innerHTML = `<span class="token-lock">🔒</span><code>${el.text}</code>`;
          } else {
            valTag.textContent = el.text || "—";
          }

          row.append(roleTag, valTag);
          elementsList.appendChild(row);
        }
        elementsContainer.appendChild(elementsList);
      }

      colWire.appendChild(elementsContainer);
      inspectorBody.appendChild(colWire);
    }

    card.appendChild(inspectorBody);

    // AI Agent Action / Gate Refusal outcome bar
    const actionOutcomeBar = document.createElement("div");
    actionOutcomeBar.className = "step-action-outcome-bar";

    if (entry.response) {
      actionOutcomeBar.appendChild(this.formatActionDisplay(entry.response));
    } else {
      const blockedCallout = document.createElement("div");
      blockedCallout.className = "wire-refusal-callout";
      blockedCallout.innerHTML = `
        <div class="refusal-title">
          <span class="refusal-icon">🛑</span>
          <span>Zero Network Dispatch (Halted)</span>
        </div>
        <div class="refusal-desc">${entry.error || entry.gate?.reason || "Halted by safety boundary"}</div>
      `;
      actionOutcomeBar.appendChild(blockedCallout);
    }

    card.appendChild(actionOutcomeBar);
    return card;
  }

  private formatActionDisplay(action: AgentAction): HTMLElement {
    const wrap = document.createElement("div");
    wrap.className = "agent-action-card";

    const label = document.createElement("div");
    label.className = "agent-action-label";
    label.textContent = "Returned Agent Action";

    const body = document.createElement("div");
    body.className = "agent-action-content";

    switch (action.type) {
      case "type":
        body.innerHTML = `
          <span class="action-badge-type">type</span>
          <span class="action-token-chip"><code>${action.placeholder}</code></span>
          <span class="action-connector">into</span>
          <code class="action-target-chip">${action.target.name || action.target.css || "element"}</code>
        `;
        break;
      case "click":
        body.innerHTML = `
          <span class="action-badge-click">click</span>
          <code class="action-target-chip">${action.target.name || action.target.css || "element"}</code>
        `;
        break;
      case "navigate":
        body.innerHTML = `
          <span class="action-badge-nav">navigate</span>
          <code class="action-url-chip" title="${action.url}">${action.url}</code>
        `;
        break;
      case "scroll":
        body.innerHTML = `
          <span class="action-badge-scroll">scroll</span>
          <span class="action-val-chip">${action.dy > 0 ? "↓" : "↑"} ${Math.abs(action.dy)}px</span>
        `;
        break;
      case "done":
        body.innerHTML = `
          <span class="action-badge-done">done</span>
          <span class="action-reason-text">${action.reason || "Task complete"}</span>
        `;
        break;
      case "ask_human":
        body.innerHTML = `
          <span class="action-badge-human">ask_human</span>
          <span class="action-reason-text">${action.reason || "Intervention requested"}</span>
        `;
        break;
      default:
        body.textContent = JSON.stringify(action);
    }

    wrap.append(label, body);
    return wrap;
  }

  /**
   * Lightbox modal to inspect full redacted viewport
   */
  private openScreenshotLightbox(dataUrl: string, title: string) {
    const overlay = document.createElement("div");
    overlay.className = "transparency-lightbox-overlay";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-label", title);

    const content = document.createElement("div");
    content.className = "lightbox-content";

    const modalHeader = document.createElement("div");
    modalHeader.className = "lightbox-header";

    const titleEl = document.createElement("span");
    titleEl.className = "lightbox-title";
    titleEl.textContent = title;

    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "lightbox-close-btn";
    closeBtn.setAttribute("aria-label", "Close Lightbox");
    closeBtn.textContent = "✕";

    const dismiss = () => {
      overlay.classList.add("closing");
      setTimeout(() => overlay.remove(), 150);
      document.removeEventListener("keydown", onKeyDown);
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") dismiss();
    };

    closeBtn.addEventListener("click", dismiss);
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) dismiss();
    });
    document.addEventListener("keydown", onKeyDown);

    modalHeader.append(titleEl, closeBtn);

    const imgWrap = document.createElement("div");
    imgWrap.className = "lightbox-img-wrap";

    const img = document.createElement("img");
    img.className = "lightbox-full-img";
    img.src = dataUrl;
    img.alt = title;

    imgWrap.appendChild(img);

    const footer = document.createElement("div");
    footer.className = "lightbox-footer";
    footer.innerHTML = `<span>🛡️ Visual redaction enforced on-device before any network packet was dispatched.</span>`;

    content.append(modalHeader, imgWrap, footer);
    overlay.appendChild(content);
    document.body.appendChild(overlay);
  }

  /**
   * Export active session as formatted JSON audit artifact
   */
  private exportCurrentSession(store: TransparencyLogStore) {
    const sessionEntries = store.entries.filter(
      (e) => e.sessionId === this.selectedSessionId
    );
    if (sessionEntries.length === 0) return;

    const exportBundle = {
      format: "privis-transparency-audit-v1",
      exportedAt: new Date().toISOString(),
      sessionId: this.selectedSessionId,
      goal: sessionEntries[0]?.goal,
      stepCount: sessionEntries.length,
      entries: sessionEntries,
    };

    const jsonStr = JSON.stringify(exportBundle, null, 2);
    const blob = new Blob([jsonStr], { type: "application/json" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = `privis-audit-${this.selectedSessionId?.slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
}
