// extension/src/popup/Chat.ts
// Chat Stream, Action Chips, and Human Approval Interface

import type {
  AgentAction,
  AgentSession,
  PolicyGateDecision,
  PolicyGateResult,
  SessionStatus,
} from "../../../types/index.js";

export class ChatComponent {
  private streamContainer: HTMLElement;
  private statusBar: HTMLElement;
  private statusIndicator: HTMLElement;
  private statusLabel: HTMLElement;
  private chatForm: HTMLFormElement;
  private chatInput: HTMLInputElement;
  private sendBtn: HTMLButtonElement;

  private currentSession: AgentSession | null = null;
  private tabId: number | null = null;

  constructor(tabId: number | null) {
    this.tabId = tabId;
    this.streamContainer = document.getElementById("session-stream") as HTMLElement;
    this.statusBar = document.getElementById("session-status-bar") as HTMLElement;
    this.statusIndicator = this.statusBar.querySelector(".status-indicator") as HTMLElement;
    this.statusLabel = document.getElementById("status-label") as HTMLElement;
    this.chatForm = document.getElementById("chat-form") as HTMLFormElement;
    this.chatInput = document.getElementById("chat-input") as HTMLInputElement;
    this.sendBtn = document.getElementById("send-btn") as HTMLButtonElement;

    this.bindEvents();
    this.renderEmptyState();
  }

  public setTabId(tabId: number) {
    this.tabId = tabId;
  }

  private bindEvents() {
    this.chatForm.addEventListener("submit", (e) => {
      e.preventDefault();
      this.handleSend();
    });
  }

  private handleSend() {
    const goal = this.chatInput.value.trim();
    if (!goal) return;

    this.chatInput.value = "";
    this.setInputDisabled(true);
    this.updateStatus("running");

    // Optimistically show user goal chip
    this.renderOptimisticGoal(goal);

    try {
      chrome.runtime.sendMessage({
        type: "cba.startSession",
        tabId: this.tabId,
        goal,
      }).catch((err) => {
        this.setInputDisabled(false);
        this.updateStatus("error");
        console.error("Failed to start agent session:", err);
      });
    } catch (err) {
      this.setInputDisabled(false);
      this.updateStatus("error");
      console.error("Failed to send startSession message:", err);
    }
  }

  public setInputDisabled(disabled: boolean) {
    this.chatInput.disabled = disabled;
    this.sendBtn.disabled = disabled;
    if (!disabled) {
      this.chatInput.focus();
    }
  }

  public updateStatus(status: SessionStatus) {
    this.statusIndicator.className = `status-indicator status-${status}`;
    this.statusLabel.textContent = status === "waiting_human" ? "waiting for human" : status;
  }

  private renderEmptyState() {
    this.streamContainer.replaceChildren();
    const wrapper = document.createElement("div");
    wrapper.className = "chat-idle-placeholder";
    wrapper.innerHTML = `
      <svg class="idle-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
        <rect x="3" y="11" width="18" height="10" rx="2"></rect>
        <circle cx="12" cy="5" r="2"></circle>
        <path d="M12 7v4"></path>
        <line x1="8" y1="16" x2="8" y2="16"></line>
        <line x1="16" y1="16" x2="16" y2="16"></line>
      </svg>
      <div class="idle-title">PRIVIS Agent Ready</div>
      <div class="idle-desc">Enter a goal below. Privacy checks and redactions run locally before actions execute.</div>
    `;
    this.streamContainer.appendChild(wrapper);
  }

  private renderOptimisticGoal(goal: string) {
    const idleEl = this.streamContainer.querySelector(".chat-idle-placeholder");
    if (idleEl) idleEl.remove();

    const chip = document.createElement("div");
    chip.className = "chat-chip user";
    chip.innerHTML = `
      <div class="user-bubble">
        <span class="user-prefix">You:</span>
        <span class="user-text"></span>
      </div>
    `;
    chip.querySelector(".user-text")!.textContent = goal;
    this.streamContainer.appendChild(chip);
    this.scrollToBottom();
  }

  public updateSession(session: AgentSession | null, gateResult?: PolicyGateResult) {
    this.currentSession = session;

    if (!session) {
      this.renderEmptyState();
      this.updateStatus("idle");
      this.setInputDisabled(false);
      return;
    }

    this.updateStatus(session.status);

    const isBusy = session.status === "running" || session.status === "waiting_human";
    this.setInputDisabled(isBusy);

    // Rebuild message stream
    this.renderSessionThread(session, gateResult);
  }

  private renderSessionThread(session: AgentSession, gateResult?: PolicyGateResult) {
    this.streamContainer.replaceChildren();

    // 1. User Goal Chip
    if (session.goal) {
      const userChip = document.createElement("div");
      userChip.className = "chat-chip user";
      userChip.innerHTML = `
        <div class="user-bubble">
          <span class="user-prefix">You:</span>
          <span class="user-text"></span>
        </div>
      `;
      userChip.querySelector(".user-text")!.textContent = session.goal;
      this.streamContainer.appendChild(userChip);
    }

    // 2. Policy Gate Badge
    const decision: PolicyGateDecision | undefined = session.gateDecision || gateResult?.decision;
    const reason = gateResult?.reason || session.error;

    if (decision) {
      this.renderGateBadge(decision, reason, session.sessionId);
    }

    if (session.outboundPayload) {
      this.renderOutboundPayload(session.outboundPayload);
    }

    // 3. Render Actions History (placeholder tokens only, never raw PII)
    if (Array.isArray(session.history) && session.history.length > 0) {
      for (const step of session.history) {
        this.renderActionChip(step.action);
      }
    } else if (session.lastAction) {
      this.renderActionChip(session.lastAction);
    }

    this.scrollToBottom();
  }

  private renderOutboundPayload(payload: NonNullable<AgentSession["outboundPayload"]>) {
    const card = document.createElement("details");
    card.className = "agent-payload";
    card.open = true;

    const summary = document.createElement("summary");
    summary.innerHTML = `<span class="payload-lock">▣</span><span>Sent to AI agent</span><span class="payload-safe">REDACTED</span>`;
    card.appendChild(summary);

    const screenshot = document.createElement("img");
    screenshot.className = "payload-screenshot";
    screenshot.src = payload.sanitizedScreenshot;
    screenshot.alt = "Redacted page screenshot sent to the AI agent";
    card.appendChild(screenshot);

    const meta = document.createElement("div");
    meta.className = "payload-meta";
    meta.textContent = `${payload.model} · ${payload.elements.length} page elements · ${payload.placeholders.length} placeholders`;
    card.appendChild(meta);

    const context = document.createElement("div");
    context.className = "payload-context";
    const url = document.createElement("div");
    url.className = "payload-url";
    url.textContent = payload.url;
    context.appendChild(url);

    for (const element of payload.elements) {
      const row = document.createElement("div");
      row.className = "payload-row";
      const kind = document.createElement("code");
      kind.textContent = element.role || element.type || element.tag;
      const text = document.createElement("span");
      text.textContent = element.text || "—";
      row.append(kind, text);
      context.appendChild(row);
    }
    card.appendChild(context);
    this.streamContainer.appendChild(card);
  }

  private renderGateBadge(decision: PolicyGateDecision, reason?: string, sessionId?: string) {
    const container = document.createElement("div");
    container.className = "gate-badge-container";

    const badge = document.createElement("div");
    badge.className = `gate-badge ${decision}`;
    badge.innerHTML = `<span>Gate: ${decision.toUpperCase()}</span>`;
    container.appendChild(badge);

    if (decision === "block") {
      const reasonEl = document.createElement("div");
      reasonEl.className = "gate-reason";
      reasonEl.textContent = reason || "Execution blocked by policy gate (sensitive data detected).";
      container.appendChild(reasonEl);
    } else if (decision === "human_approval") {
      const card = document.createElement("div");
      card.className = "human-approval-card";
      card.innerHTML = `
        <div class="approval-title">Human Confirmation Required</div>
        <div class="approval-desc">${reason || "A sensitive field or low-confidence detection requires manual clearance."}</div>
        <div class="human-actions">
          <button type="button" class="btn-approve">Approve</button>
          <button type="button" class="btn-reject">Reject</button>
        </div>
      `;

      const approveBtn = card.querySelector(".btn-approve") as HTMLButtonElement;
      const rejectBtn = card.querySelector(".btn-reject") as HTMLButtonElement;

      approveBtn.addEventListener("click", () => {
        approveBtn.disabled = true;
        rejectBtn.disabled = true;
        approveBtn.textContent = "Approving…";
        this.sendHumanDecision(sessionId || "", true);
      });

      rejectBtn.addEventListener("click", () => {
        approveBtn.disabled = true;
        rejectBtn.disabled = true;
        rejectBtn.textContent = "Rejected";
        this.sendHumanDecision(sessionId || "", false);
      });

      container.appendChild(card);
    }

    this.streamContainer.appendChild(container);
  }

  private sendHumanDecision(sessionId: string, approved: boolean) {
    try {
      chrome.runtime.sendMessage({
        type: "cba.humanDecision",
        sessionId,
        approved,
      }).catch((err) => {
        console.error("Failed to send humanDecision:", err);
      });
    } catch (err) {
      console.error("Failed to send humanDecision message:", err);
    }
  }

  /**
   * Renders AgentAction strictly adhering to CONTRACT.md & prompt rules:
   * Real PII values are never displayed or received by the chat UI.
   * Placeholder tokens (e.g. PAN_1, EMAIL_1) are shown in monospace tags.
   */
  private renderActionChip(action: AgentAction) {
    const chip = document.createElement("div");
    chip.className = "action-chip";

    const prefix = document.createElement("span");
    prefix.className = "action-prefix";
    prefix.textContent = "Agent:";
    chip.appendChild(prefix);

    switch (action.type) {
      case "type": {
        const verb = document.createElement("span");
        verb.className = "action-verb";
        verb.textContent = "type";

        const token = document.createElement("span");
        token.className = "token";
        // STRICT: Only placeholder token is rendered, never raw text!
        token.textContent = action.placeholder;

        chip.append(verb, token);
        break;
      }

      case "click": {
        const verb = document.createElement("span");
        verb.className = "action-verb";
        verb.textContent = "click";

        const target = document.createElement("span");
        const targetDesc =
          action.target.name ||
          action.target.css ||
          action.target.role ||
          "element";
        target.textContent = targetDesc;

        chip.append(verb, target);
        break;
      }

      case "scroll": {
        const text = document.createElement("span");
        text.textContent = `scroll ${action.dy}px`;
        chip.appendChild(text);
        break;
      }

      case "navigate": {
        const text = document.createElement("span");
        text.textContent = `navigate ${action.url}`;
        chip.appendChild(text);
        break;
      }

      case "done": {
        const text = document.createElement("span");
        text.textContent = action.reason ? `done (${action.reason})` : "done";
        chip.appendChild(text);
        break;
      }

      case "ask_human": {
        const text = document.createElement("span");
        text.textContent = `ask_human: ${action.reason}`;
        chip.appendChild(text);
        break;
      }

      default: {
        const text = document.createElement("span");
        text.textContent = `action: ${(action as { type?: string }).type || "unknown"}`;
        chip.appendChild(text);
        break;
      }
    }

    this.streamContainer.appendChild(chip);
  }

  private scrollToBottom() {
    requestAnimationFrame(() => {
      this.streamContainer.scrollTop = this.streamContainer.scrollHeight;
    });
  }
}
