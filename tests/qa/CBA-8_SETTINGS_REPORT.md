# PRIVIS QA Report — CBA-8 Settings (server URL + model toggle + auth token)

- **Product box:** Settings persistence + operator-server client (`extension/src/settings/models.ts`, `extension/src/popup/Settings.ts`, `remote-agent/client-server.ts`)
- **Scope:** issue #48 — configure operator server URL, optional auth token, and model preference from the extension; provider keys stay server-side
- **Reviewed:** branch `feat/cba-8-settings-server-config`
- **Evidence run:** `npm run typecheck`, `npm run build`, `npm test` (now includes `test:settings`), plus a manual secret scan — all passed.

## 1. What was attacked, and with what

| Attack | Vehicle | Result |
|---|---|---|
| Provider keys persisted to `chrome.storage.local` | `saveModelSettings({ geminiApiKey, openaiApiKey })` | Caught. Only `{ model, serverUrl, agentAuthToken }` written; keys dropped |
| Provider keys resurrected from a stale storage blob | Seed `chrome.storage` with `openaiApiKey`/`geminiApiKey`, then `loadModelSettings()` | Caught. Keys ignored on read |
| Server path loses keys after the split | Delete `chrome`, set `GEMINI_API_KEY` in env, `loadModelSettings()` | Holds. Env keys still resolve server-side |
| No server URL → silent call to localhost | `queryServer(pkg, { serverUrl: "   " })` | Caught. Throws `No agent server configured…`, zero network calls |
| Auth token not sent / keys on the wire | `queryServer(pkg, { authToken, model, fetchFn })` spy | Auth header `Bearer <token>` present; body has `model` but no `openaiApiKey`/`geminiApiKey`/`apiKey` |
| Provider keys leaked through `serverOptionsFromSettings` | Map a full normalized settings object | Only `{ serverUrl, authToken, model }` mapped |
| No-server / connection errors give no hint in chat | New error text + `Chat.renderErrorMessage` hint condition | Hint now fires on `configure`/`agent server` too, and mentions "check the Server URL in Settings" |
| Empty server URL typed in Settings | `saveConnection` with empty input | Normalizes back to the documented default (never persists a blank URL) |
| Live keys committed to the repo | Secret scan over `git ls-files` + full working tree | No live keys in any tracked file; `.env` is gitignored |

## 2. Secret scan (issue testing-plan item)

- **Tracked files:** zero live-key matches. The only hits are deliberate PII-test fixtures
  (`tests/test-agent-action.ts`, `tests/test-packager-guard.ts` — `AKIAIOSFODNN7EXAMPLE`,
  `ghp_1234…`, `sk-1234…` fake values).
- **`remote-agent/.env`:** present on disk with a live Gemini key, but **gitignored**
  (`git check-ignore` confirms) and never tracked.

### ⚠️ Finding (not a code bug — operational)

`remote-agent/.env` contains a **live Gemini API key**
(`GEMINI_API_KEY=AQ.Ab8R…`). It is gitignored, so it will not leak through git,
but it has sat in plaintext in the working directory and has been visible to
tooling/agent sessions. **Recommendation: rotate that key** and load it from a
secrets manager / environment, not a local `.env` file.

## 3. Changes made

- `extension/src/settings/models.ts` — split `ClientSettings` (model, serverUrl,
  agentAuthToken) from `ModelSettings` (adds server-side provider keys).
  `saveModelSettings` now persists only client fields; `loadModelSettings`
  strips provider keys from storage while still reading them from env server-side.
- `extension/src/popup/Settings.ts` — added Server URL field, optional auth token
  field (password type), and a Save-connection button alongside the existing model
  toggle. Privacy banner now states keys stay on the operator server.
- `extension/src/popup/popup.css` — styles for `.settings-field`, `.settings-input`,
  `.settings-save-btn`, `.save-status-msg.error`.
- `remote-agent/client-server.ts` — `queryServer` fails fast with a fix-it hint on
  an explicitly blank server URL (undefined still falls back to localhost).
- `extension/src/popup/Chat.ts` — connection/configure errors now surface the
  "check Server URL + start the server" hint.
- `remote-agent/.env.example` — clarified server-side-only key ownership.
- `tests/test-settings.ts` — new CBA-8 suite (7 sections); wired as `npm run test:settings`.

## 4. Known gaps (deliberate)

- **Blank server URL is not a persisted state.** The Settings field reverts to the
  documented default on save, so "no server URL" surfaces as a connection failure
  (hinted) rather than a distinct empty-URL state. The defensive fail-fast path in
  `queryServer` covers direct callers that pass an empty string.
- **Auth token is stored in `chrome.storage.local` in plaintext.** It is not a
  provider key, but it is a bearer credential for the operator server. Acceptable
  for the local/operator model (per CONTRACT.md); moving it to an OS keychain is a
  possible future hardening if the token ever gates a multi-tenant server.
