# PRIVIS Session Transparency Log — 2-Minute Jury Demo Script

**Objective**: Prove to judges that PRIVIS never sends raw PII across the wire, and that the outbound wire truth is permanently auditable on-device even after closing or reloading the extension popup.

---

## Prerequisites (30 seconds before demo)
1. Ensure the demo portal is running:
   ```bash
   cd demo-portal && npx serve -l 8000 .
   ```
2. In Chrome, open `http://localhost:8000/index.html`.
3. Load the unpacked extension from `dist/` and pin PRIVIS.

---

## 2-Minute Jury Walkthrough

### Step 1: Execute an Agent Run (30 seconds)
1. Click the **PRIVIS** extension icon on the employee portal page.
2. In the Chat input, enter:
   ```text
   Fill the form with my PAN and submit
   ```
3. Click the **Send** button.
4. **Point out to the Jury in real time**:
   - The on-device sanitizer detects PII (Name, Email, PAN, Phone, Salary).
   - Structural placeholder substitution (`PAN_1`, `EMAIL_1`, etc.) replaces raw values.
   - The Policy Gate displays `Gate: ALLOW`.
   - The AI agent plans and types `PAN_1` into the field, and local executor swaps the real value on-device.

---

### Step 2: Open the Transparency Tab (30 seconds)
1. Click the **Transparency** tab at the top of the popup.
2. Select the top session in the session list.
3. **Show the Jury the Wire Truth**:
   - **Left Column (Sanitized Screenshot)**:
     - Point at the screenshot: sensitive form fields and the avatar photo are blacked out/pixelated *before* network exit.
   - **Right Column (Context & Placeholders)**:
     - Point at the elements list: the agent received only `PAN_1`, `EMAIL_1`, `NAME_1`.
     - Zero raw names, phone numbers, or PAN numbers exist in the wire context.
   - **SHA-256 Tamper Digest**:
     - Point at the green badge: `SHA-256: 7247ee6c… ✓ Verified`.
     - Explain: "This SHA-256 hash was computed over the outbound request body. The popup re-verifies this hash live to guarantee the evidence is untampered."

---

### Step 3: Demonstrate Popup Reload Survival (30 seconds)
1. **The Claim**: *"Other agent tools keep state in transient memory; close the popup and the audit trail vanishes."*
2. **The Action**: Close the extension popup completely (or click anywhere on the web page to dismiss it).
3. Right-click the extension icon -> select **Inspect popup** (or simply click the PRIVIS icon to reopen).
4. Click the **Transparency** tab.
5. **Auditor Proof**:
   - The session, every completed step, the redacted screenshot, placeholder table, and green verified digest badge are **still there**.
   - Persistence is strictly on-device in `chrome.storage.local`.

---

### Step 4: Auditor Zero-PII Storage Inspection (30 seconds)
1. With DevTools open on the extension popup, switch to the **Console** tab.
2. Run this live verification command in front of the jury:
   ```js
   chrome.storage.local.get("privis_transparency_log", (res) => {
     const json = JSON.stringify(res);
     const leaked = ["Asha Rao", "ABCDE1234F", "+91 98765 43210", "12,00,000"].filter(pii => json.includes(pii));
     console.log("Raw PII in storage:", leaked.length === 0 ? "ZERO (PASS)" : leaked);
   });
   ```
3. Show the jury the output:
   ```text
   Raw PII in storage: ZERO (PASS)
   ```
4. **Closing statement**:
   > *"Raw PII stays on the device. Only sanitized placeholders and redacted pixels cross the network. And the wire truth is auditable, tamper-evident, and persistent."*
