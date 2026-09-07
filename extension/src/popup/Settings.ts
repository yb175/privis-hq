// extension/src/popup/Settings.ts
// Settings tab component: Model switcher wired directly to models.ts

import {
  type ModelChoice,
  loadModelSettings,
  saveModelSettings,
} from "../settings/models.js";

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
      this.render();
    } catch (err) {
      console.error("Failed to load model settings:", err);
      this.currentChoice = "chatgpt";
      this.render();
    }
  }

  private renderLoading() {
    this.container.innerHTML = `
      <div style="color: var(--color-text-dim); padding: 12px; font-size: 12px;">
        Loading model configurations…
      </div>
    `;
  }

  private render() {
    this.container.replaceChildren();

    // Section Title
    const title = document.createElement("div");
    title.className = "settings-section-title";
    title.textContent = "Remote Brain Selection";
    this.container.appendChild(title);

    // Radio Group
    const group = document.createElement("div");
    group.className = "radio-group";

    // 1. ChatGPT Card
    const chatgptCard = this.createModelCard({
      id: "model-chatgpt",
      name: "ChatGPT",
      modelTag: "gpt-4o-mini",
      description: "Fast OpenAI-compatible reasoning model for action planning.",
      value: "chatgpt",
      checked: this.currentChoice === "chatgpt",
    });

    // 2. Gemini Card
    const geminiCard = this.createModelCard({
      id: "model-gemini",
      name: "Google Gemini",
      modelTag: "gemini-3.5-flash-lite-preview",
      description: "Low-latency multimodal model with direct token parsing.",
      value: "gemini",
      checked: this.currentChoice === "gemini",
    });

    group.append(chatgptCard, geminiCard);
    this.container.appendChild(group);

    // Feedback Container
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
        Zero Local Keys (Privacy-Mode)
      </div>
      <div class="privacy-banner-text">
        API keys never reside on your client browser. Only structural placeholders and redacted screenshots are dispatched to your configured operator server.
      </div>
    `;
    this.container.appendChild(banner);
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
