// extension/src/popup/popup.ts
// Entry point for PRIVIS Popup: Tab switching, state loader, and live updates

import { ChatComponent } from "./Chat.js";
import { SettingsComponent } from "./Settings.js";
import { TransparencyComponent } from "./Transparency.js";
import type { AgentSession, PolicyGateResult } from "../../../types/index.js";

interface SessionUpdateMessage {
  type: "cba.sessionUpdate";
  session: AgentSession;
  gateResult?: PolicyGateResult;
}

class PopupApp {
  private chatTabBtn: HTMLButtonElement;
  private transparencyTabBtn: HTMLButtonElement;
  private settingsTabBtn: HTMLButtonElement;
  private chatPanel: HTMLElement;
  private transparencyPanel: HTMLElement;
  private settingsPanel: HTMLElement;

  private chatComponent: ChatComponent | null = null;
  private transparencyComponent: TransparencyComponent | null = null;
  private settingsComponent: SettingsComponent | null = null;
  private activeTabId: number | null = null;

  constructor() {
    this.chatTabBtn = document.getElementById("tab-btn-chat") as HTMLButtonElement;
    this.transparencyTabBtn = document.getElementById("tab-btn-transparency") as HTMLButtonElement;
    this.settingsTabBtn = document.getElementById("tab-btn-settings") as HTMLButtonElement;
    this.chatPanel = document.getElementById("tab-chat") as HTMLElement;
    this.transparencyPanel = document.getElementById("tab-transparency") as HTMLElement;
    this.settingsPanel = document.getElementById("tab-settings") as HTMLElement;

    this.initTabs();
    this.initActiveTabAndComponents();
    this.initMessageListener();
  }

  private initTabs() {
    this.chatTabBtn.addEventListener("click", () => this.switchTab("chat"));
    this.transparencyTabBtn.addEventListener("click", () => this.switchTab("transparency"));
    this.settingsTabBtn.addEventListener("click", () => this.switchTab("settings"));

    const tabs: Array<{ id: "chat" | "transparency" | "settings"; btn: HTMLButtonElement }> = [
      { id: "chat", btn: this.chatTabBtn },
      { id: "transparency", btn: this.transparencyTabBtn },
      { id: "settings", btn: this.settingsTabBtn },
    ];

    // Keyboard tab navigation (Left / Right arrow keys)
    const handleKeyNav = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
        e.preventDefault();
        const currentIndex = tabs.findIndex((t) => t.btn.classList.contains("active"));
        if (currentIndex === -1) return;
        const delta = e.key === "ArrowRight" ? 1 : -1;
        const nextIndex = (currentIndex + delta + tabs.length) % tabs.length;
        this.switchTab(tabs[nextIndex].id);
        tabs[nextIndex].btn.focus();
      }
    };

    this.chatTabBtn.addEventListener("keydown", handleKeyNav);
    this.transparencyTabBtn.addEventListener("keydown", handleKeyNav);
    this.settingsTabBtn.addEventListener("keydown", handleKeyNav);
  }

  private switchTab(tab: "chat" | "transparency" | "settings") {
    const allBtns = [this.chatTabBtn, this.transparencyTabBtn, this.settingsTabBtn];
    const allPanels = [this.chatPanel, this.transparencyPanel, this.settingsPanel];

    allBtns.forEach((b) => {
      b.classList.remove("active");
      b.setAttribute("aria-selected", "false");
    });
    allPanels.forEach((p) => p.classList.remove("active"));

    if (tab === "chat") {
      this.chatTabBtn.classList.add("active");
      this.chatTabBtn.setAttribute("aria-selected", "true");
      this.chatPanel.classList.add("active");
    } else if (tab === "transparency") {
      this.transparencyTabBtn.classList.add("active");
      this.transparencyTabBtn.setAttribute("aria-selected", "true");
      this.transparencyPanel.classList.add("active");
      void this.transparencyComponent?.refresh();
    } else {
      this.settingsTabBtn.classList.add("active");
      this.settingsTabBtn.setAttribute("aria-selected", "true");
      this.settingsPanel.classList.add("active");
    }
  }

  private async initActiveTabAndComponents() {
    try {
      if (typeof chrome !== "undefined" && chrome.tabs && typeof chrome.tabs.query === "function") {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tabs[0] && typeof tabs[0].id === "number") {
          this.activeTabId = tabs[0].id;
        }
      }
    } catch (err) {
      console.warn("Could not query active tab ID:", err);
    }

    // Initialize UI components
    this.chatComponent = new ChatComponent(this.activeTabId);
    this.transparencyComponent = new TransparencyComponent();
    this.settingsComponent = new SettingsComponent();

    // Rehydrate session continuity if active tab is known
    this.rehydrateSession();
  }

  private rehydrateSession() {
    if (typeof chrome === "undefined" || !chrome.runtime || typeof chrome.runtime.sendMessage !== "function") {
      return;
    }

    chrome.runtime.sendMessage(
      { type: "cba.getSession", tabId: this.activeTabId },
      (response) => {
        if (chrome.runtime.lastError) {
          // SW might be booting or no session
          return;
        }
        if (response && response.session) {
          this.chatComponent?.updateSession(response.session);
        }
      }
    );
  }

  private initMessageListener() {
    if (typeof chrome === "undefined" || !chrome.runtime || typeof chrome.runtime.onMessage?.addListener !== "function") {
      return;
    }

    chrome.runtime.onMessage.addListener((msg: unknown) => {
      if (!msg || typeof msg !== "object") return;
      const update = msg as SessionUpdateMessage;
      if (update.type === "cba.sessionUpdate" && update.session) {
        // If message is for our tab or active tab
        if (
          this.activeTabId === null ||
          update.session.tabId === this.activeTabId
        ) {
          this.chatComponent?.updateSession(update.session, update.gateResult);
        }
      }
    });
  }
}

// Initialize popup when DOM is loaded
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => new PopupApp());
} else {
  new PopupApp();
}
