// utils/dom-extractor.js — content-script helper.
// Extracts element metadata. Raw values stay here only until sanitize runs.

function labelFor(el) {
  if (el.labels && el.labels[0]) return el.labels[0].textContent.trim();
  const wrap = el.closest("label");
  if (wrap) return wrap.textContent.trim();
  return el.getAttribute("aria-label") || el.placeholder || el.name || null;
}

// Returns [{ element_id, tag, type, role, label, text, bbox: [x,y,w,h] }]
// for visible interactive elements + labelled inputs + media (face candidates later).
function extractElements() {
  const nodes = document.querySelectorAll(
    "input, textarea, select, button, a, [role=button], img, video, [contenteditable=true]"
  );
  const out = [];
  nodes.forEach((el, i) => {
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return; // not visible
    out.push({
      element_id: el.id || `e${i}`,
      tag: el.tagName.toLowerCase(),
      type: el.type || null,
      role: el.getAttribute("role") || null,
      label: labelFor(el),
      text: (el.value || el.textContent || "").trim().slice(0, 200),
      bbox: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],
    });
  });
  return out;
}

// { url, title, viewport } — viewport needed to scale bboxes onto the screenshot.
function collectBrowserState() {
  return {
    url: location.href,
    title: document.title,
    viewport: { w: window.innerWidth, h: window.innerHeight },
  };
}
