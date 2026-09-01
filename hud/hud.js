// PRIVIS demo HUD — paints the six-box pipeline in the extension popup.
//
// Until the orchestrator (#15) emits live step events, "Play fixture" renders
// one synthetic pipeline run from fixtures/. No real PII is ever rendered:
// text shown is placeholders and non-sensitive labels only, and the raw/
// sanitized thumbnails are canvas wireframes drawn from fixture bounding
// boxes — no screenshot is decoded, written, or stored anywhere.

const FIXTURES = ["detections", "sanitized-context", "action-click-submit"];

// The six locked box names — do not rename (CONTRACT.md).
const STEPS = [
  "Capture Layer",
  "Local Privacy Vision Engine",
  "Sanitizer",
  "Policy Gate",
  "Remote Agent",
  "Local Executor",
];

const PIPELINE = document.getElementById("pipeline");
const PLAY_BTN = document.getElementById("play-fixture");
const STEP_TPL = document.getElementById("step-template");

function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}

function addStep(num, name, buildBody) {
  const step = STEP_TPL.content.cloneNode(true);
  step.querySelector(".hud-step-num").textContent = num;
  step.querySelector(".hud-step-name").textContent = name;
  buildBody(step.querySelector(".hud-step-body"));
  PIPELINE.append(step);
  return step;
}

function note(parent, html) {
  const p = el("p", null);
  p.innerHTML = html;
  parent.append(p);
}

// Wireframe mock of the fixture page (employee portal) drawn from bboxes.
// raw=true draws field "values" as gray text bars; raw=false black-boxes the
// sensitive regions the way the Sanitizer's canvas redaction does.
function drawThumb(canvas, ctx, elements, detections, raw) {
  const { w, h } = { w: 1280, h: 800 };
  canvas.width = 340;
  canvas.height = Math.round((340 * h) / w);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const sx = canvas.width / w;
  const sy = canvas.height / h;

  // header band + avatar placeholder square (pre-redaction look)
  ctx.fillStyle = "#d8dee6";
  ctx.fillRect(0, 0, canvas.width, 40 * sy);

  for (const m of elements) {
    const [x, y, bw, bh] = m.bbox;
    const px = x * sx;
    const py = y * sy;
    const pw = bw * sx;
    const ph = bh * sy;
    ctx.fillStyle = m.tag === "button" ? "#3f6fb5" : "#f2f4f7";
    ctx.fillRect(px, py, pw, ph);
    ctx.strokeStyle = "#b9c2cd";
    ctx.strokeRect(px, py, pw, ph);
    if (raw && m.text) {
      // fake "value" bar — no real characters, just a gray strip
      ctx.fillStyle = "#7d8aa0";
      ctx.fillRect(px + 4, py + ph / 2 - 2, pw - 8, 4);
    }
    if (m.label && m.tag !== "button") {
      ctx.fillStyle = "#5a6675";
      ctx.fillRect(px - 90 * sx, py + ph / 2 - 1, 80 * sx, 2);
    }
  }

  if (!raw) {
    for (const d of detections) {
      const [x, y, bw, bh] = d.bbox;
      ctx.fillStyle = d.category === "FACE" ? "#9aa4b1" : "#0b0d10";
      ctx.fillRect(x * sx, y * sy, bw * sx, bh * sy);
    }
  }
}

function thumbs(container, ctx, detections) {
  const fig = el("div", "hud-thumbs");
  for (const [label, raw] of [["Raw", true], ["Sanitized", false]]) {
    const wrap = el("figure", "hud-thumb");
    const canvas = document.createElement("canvas");
    wrap.append(canvas, el("figcaption", null, label));
    fig.append(wrap);
    drawThumb(canvas, canvas.getContext("2d"), ctx.elements, detections, raw);
  }
  container.append(fig);
}

function chips(container, detections) {
  const row = el("div", "hud-chips");
  for (const d of detections) {
    row.append(el("span", "hud-chip", `${d.category} ${(d.confidence * 100).toFixed(0)}%`));
  }
  container.append(row);
}

function badge(container, decision, reason) {
  container.append(el("span", `hud-badge ${decision}`, decision.toUpperCase()));
  container.append(el("span", null, ` ${reason}`));
}

function placeholders(ctx) {
  return ctx.elements
    .filter((m) => /^(EMAIL|PAN|AADHAAR|AMOUNT|PHONE|NAME)_\d+$/.test(m.text))
    .map((m) => m.text)
    .join(", ");
}

async function playFixture() {
  PLAY_BTN.disabled = true;
  PIPELINE.replaceChildren(el("p", "hud-idle", "Loading fixtures…"));
  try {
    const [detections, ctx, action] = await Promise.all(
      FIXTURES.map((name) => fetch(chrome.runtime.getURL(`fixtures/${name}.json`)).then((r) => r.json())),
    );

    PIPELINE.replaceChildren();
    let n = 0;

    addStep(++n, STEPS[0], (b) => {
      thumbs(b, ctx, detections);
      note(b, `<strong>${ctx.elements.length} elements</strong> + browser state read from DOM.
        Screenshot held <strong>in memory only</strong> — never written to disk or storage.`);
    });

    addStep(++n, STEPS[1], (b) => {
      chips(b, detections);
      note(b, `<strong>${detections.length} sensitive regions</strong> fused into one Detection[] list.`);
    });

    addStep(++n, STEPS[2], (b) => {
      note(b, `Pixels blacked out (FACE pixelated). Strings swapped for placeholders:
        <span class="hud-mono">${placeholders(ctx)}</span>.
        <span class="hud-mono">PASSWORD</span> and <span class="hud-mono">FACE</span> are redacted, no placeholder.`);
    });

    addStep(++n, STEPS[3], (b) => {
      const row = el("p");
      badge(row, "allow", "sanitized package only — no raw PII below the Sanitizer");
      b.append(row);
    });

    addStep(++n, STEPS[4], (b) => {
      note(b, `Sent: sanitized screenshot + sanitized JSON + goal.
        Returned: <span class="hud-mono">${JSON.stringify(action)}</span>`);
    });

    addStep(++n, STEPS[5], (b) => {
      note(b, `Planned action: <span class="hud-mono">${JSON.stringify(action)}</span> —
        resolve <span class="hud-mono">${action.target}</span> against the real page DOM and click it.
        <strong>Playback only:</strong> no click happens here; the Local Executor runs it in a live step,
        typing real values from the on-device mapping table — never from the network.`);
    });
  } catch (err) {
    PIPELINE.replaceChildren(
      el("p", "hud-idle", `Fixture playback failed: ${err instanceof Error ? err.message : String(err)}`),
    );
  } finally {
    PLAY_BTN.disabled = false;
  }
}

PLAY_BTN.addEventListener("click", playFixture);

// Live mode: when the orchestrator (#15) starts broadcasting step events from
// the service worker, they land here and paint the same six-step panel.
// detail is rendered with textContent, never innerHTML — the orchestrator must
// send a sanitized summary; page-derived strings must never inject markup.
chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === "hud.step" && typeof msg.step === "number" && STEPS[msg.step - 1]) {
    addStep(msg.step, STEPS[msg.step - 1], (b) => {
      b.append(el("p", null, typeof msg.detail === "string" ? msg.detail : ""));
    });
    return false;
  }
  return false;
});
