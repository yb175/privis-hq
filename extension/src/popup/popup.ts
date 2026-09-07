// extension/src/popup/popup.ts
// Entry point for PRIVIS Popup: Tab switching, state loader, and live updates

import { ChatComponent } from "./Chat.js";
import { SettingsComponent } from "./Settings.js";
import type { AgentSession, PolicyGateResult } from "../../../types/index.js";

interface SessionUpdateMessage {
  type: "cba.sessionUpdate";
  session: AgentSession;
  gateResult?: PolicyGateResult;
}

class PopupApp {
  private chatTabBtn: HTMLButtonElement;
  private settingsTabBtn: HTMLButtonElement;
  private chatPanel: HTMLElement;
  private settingsPanel: HTMLElement;

  private chatComponent: ChatComponent | null = null;
  private settingsComponent: SettingsComponent | null = null;
  private activeTabId: number | null = null;

  constructor() {
    this.chatTabBtn = document.getElementById("tab-btn-chat") as HTMLButtonElement;
    this.settingsTabBtn = document.getElementById("tab-btn-settings") as HTMLButtonElement;
    this.chatPanel = document.getElementById("tab-chat") as HTMLElement;
    this.settingsPanel = document.getElementById("tab-settings") as HTMLElement;

    this.initTabs();
    this.initActiveTabAndComponents();
    this.initMessageListener();
  }

  private initTabs() {
    this.chatTabBtn.addEventListener("click", () => this.switchTab("chat"));
    this.settingsTabBtn.addEventListener("click", () => this.switchTab("settings"));

    // Keyboard tab navigation (Left / Right arrow keys)
    const handleKeyNav = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
        e.preventDefault();
        const isChat = this.chatTabBtn.classList.contains("active");
        if (isChat) {
          this.switchTab("settings");
          this.settingsTabBtn.focus();
        } else {
          this.switchTab("chat");
          this.chatTabBtn.focus();
        }
      }
    };

    this.chatTabBtn.addEventListener("keydown", handleKeyNav);
    this.settingsTabBtn.addEventListener("keydown", handleKeyNav);
  }

  private switchTab(tab: "chat" | "settings") {
    if (tab === "chat") {
      this.chatTabBtn.classList.add("active");
      this.chatTabBtn.setAttribute("aria-selected", "true");
      this.settingsTabBtn.classList.remove("active");
      this.settingsTabBtn.setAttribute("aria-selected", "false");

      this.chatPanel.classList.add("active");
      this.settingsPanel.classList.remove("active");
    } else {
      this.settingsTabBtn.classList.add("active");
      this.settingsTabBtn.setAttribute("aria-selected", "true");
      this.chatTabBtn.classList.remove("active");
      this.chatTabBtn.setAttribute("aria-selected", "false");

      this.settingsPanel.classList.add("active");
      this.chatPanel.classList.remove("active");
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
