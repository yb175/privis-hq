// extension/src/popup/Settings.ts
// Settings tab component: operator server connection + model toggle.
// No provider API keys are collected here — they stay on the operator server.

import {
  type ModelChoice,
  type ModelSettings,
  DEFAULT_MODEL_SETTINGS,
  loadModelSettings,
  saveModelSettings,
} from "../../../shared/settings.js";

export class SettingsComponent {
  private container: HTMLElement;
  private currentChoice: ModelChoice = "chatgpt";

  constructor() {
    this.container = document.getElementById("settings-container") as HTMLElement;
    this.init();
  }

  private async init() {
    this.renderLoading();
    try {
      const settings = await loadModelSettings();
      this.currentChoice = settings.model;
      this.render(settings);
    } catch (err) {
      console.error("Failed to load model settings:", err);
      this.currentChoice = "chatgpt";
      this.render({ model: "chatgpt", serverUrl: DEFAULT_MODEL_SETTINGS.serverUrl });
    }
  }

  private renderLoading() {
    this.container.innerHTML = `
      <div style="color: var(--color-text-dim); padding: 12px; font-size: 12px;">
        Loading settings…
      </div>
    `;
  }

  private render(settings: ModelSettings) {
    this.container.replaceChildren();

    // --- Model selection ---
    const modelTitle = document.createElement("div");
    modelTitle.className = "settings-section-title";
    modelTitle.textContent = "Remote Brain Selection";
    this.container.appendChild(modelTitle);

    const group = document.createElement("div");
    group.className = "radio-group";
    group.append(
      this.createModelCard({
        id: "model-chatgpt",
        name: "ChatGPT",
        modelTag: "gpt-4o-mini",
        description: "Fast OpenAI-compatible reasoning model for action planning.",
        value: "chatgpt",
        checked: this.currentChoice === "chatgpt",
      }),
      this.createModelCard({
        id: "model-gemini",
        name: "Google Gemini",
        modelTag: "gemini-3.5-flash-lite-preview",
        description: "Low-latency multimodal model with direct token parsing.",
        value: "gemini",
        checked: this.currentChoice === "gemini",
      })
    );
    this.container.appendChild(group);

    // --- Operator server connection ---
    const serverTitle = document.createElement("div");
    serverTitle.className = "settings-section-title";
    serverTitle.textContent = "Operator Server";
    this.container.appendChild(serverTitle);

    const urlField = this.createTextField({
      id: "settings-server-url",
      label: "Server URL",
      value: settings.serverUrl || DEFAULT_MODEL_SETTINGS.serverUrl,
      placeholder: "http://localhost:3201",
      type: "text",
      hint: "The PRIVIS agent server that owns the provider API keys.",
    });
    this.container.appendChild(urlField);

    const tokenField = this.createTextField({
      id: "settings-auth-token",
      label: "Auth token (optional)",
      value: settings.agentAuthToken || "",
      placeholder: "Bearer token for the server",
      type: "password",
      hint: "Sent as Authorization: Bearer <token> when the server requires it.",
    });
    this.container.appendChild(tokenField);

    const saveBtn = document.createElement("button");
    saveBtn.type = "button";
    saveBtn.className = "settings-save-btn";
    saveBtn.textContent = "Save connection";
    saveBtn.addEventListener("click", () => this.saveConnection());
    this.container.appendChild(saveBtn);

    // Feedback Container (shared by model + connection saves)
    const feedback = document.createElement("div");
    feedback.id = "settings-feedback";
    this.container.appendChild(feedback);

    // Privacy Banner
    const banner = document.createElement("div");
    banner.className = "privacy-banner";
    banner.innerHTML = `
      <div class="privacy-banner-title">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
        </svg>
        Provider API keys stay on the operator server
      </div>
      <div class="privacy-banner-text">
        This extension never stores or sends OpenAI/Gemini keys. Only structural placeholders and redacted screenshots are dispatched to the server you configure above.
      </div>
    `;
    this.container.appendChild(banner);
  }

  private createTextField(config: {
    id: string;
    label: string;
    value: string;
    placeholder: string;
    type: "text" | "password";
    hint: string;
  }): HTMLElement {
    const field = document.createElement("div");
    field.className = "settings-field";

    const label = document.createElement("label");
    label.className = "settings-label";
    label.htmlFor = config.id;
    label.textContent = config.label;

    const input = document.createElement("input");
    input.className = "settings-input";
    input.id = config.id;
    input.type = config.type;
    input.value = config.value;
    input.placeholder = config.placeholder;
    input.autocomplete = "off";
    input.spellcheck = false;

    const hint = document.createElement("div");
    hint.className = "settings-hint";
    hint.textContent = config.hint;

    field.append(label, input, hint);
    return field;
  }

  private createModelCard(config: {
    id: string;
    name: string;
    modelTag: string;
    description: string;
    value: ModelChoice;
    checked: boolean;
  }): HTMLElement {
    const label = document.createElement("label");
    label.className = `model-card ${config.checked ? "selected" : ""}`;
    label.htmlFor = config.id;

    const radio = document.createElement("input");
    radio.type = "radio";
    radio.name = "privis-model-choice";
    radio.id = config.id;
    radio.value = config.value;
    radio.checked = config.checked;

    radio.addEventListener("change", () => {
      if (radio.checked) {
        this.selectModel(config.value);
      }
    });

    const body = document.createElement("div");
    body.className = "model-card-body";

    const nameRow = document.createElement("div");
    nameRow.className = "model-name";
    nameRow.innerHTML = `
      <span>${config.name}</span>
      <span class="model-id-badge">${config.modelTag}</span>
    `;

    const desc = document.createElement("div");
    desc.className = "model-desc";
    desc.textContent = config.description;

    body.append(nameRow, desc);
    label.append(radio, body);

    return label;
  }

  private async saveConnection() {
    const urlInput = document.getElementById("settings-server-url") as HTMLInputElement | null;
    const tokenInput = document.getElementById("settings-auth-token") as HTMLInputElement | null;

    try {
      await saveModelSettings({
        serverUrl: urlInput?.value ?? undefined,
        agentAuthToken: tokenInput?.value ?? undefined,
      });
      this.showFeedback("Saved server connection");
    } catch (err) {
      console.error("Failed to save server connection:", err);
      this.showFeedback("Failed to save settings", true);
    }
  }

  private async selectModel(choice: ModelChoice) {
    this.currentChoice = choice;

    // Update card selection styles
    const cards = this.container.querySelectorAll(".model-card");
    cards.forEach((card) => {
      const radio = card.querySelector("input[type='radio']") as HTMLInputElement | null;
      if (radio?.value === choice) {
        card.classList.add("selected");
      } else {
        card.classList.remove("selected");
      }
    });

    try {
      await saveModelSettings({ model: choice });
      this.showFeedback(`Saved: ${choice === "gemini" ? "Google Gemini" : "ChatGPT"} active`);
    } catch (err) {
      console.error("Failed to save model choice:", err);
      this.showFeedback("Failed to save settings", true);
    }
  }

  private showFeedback(message: string, isError = false) {
    const feedback = document.getElementById("settings-feedback");
    if (!feedback) return;

    feedback.className = `save-status-msg ${isError ? "error" : ""}`;
    feedback.innerHTML = `
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="20 6 9 17 4 12"></polyline>
      </svg>
      <span>${message}</span>
    `;

    setTimeout(() => {
      if (feedback.textContent?.includes(message)) {
        feedback.replaceChildren();
      }
    }, 2500);
  }
}
