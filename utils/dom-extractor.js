// utils/dom-extractor.js — content-script helper.
// Extracts element metadata: never raw sensitive VALUES, only labels/roles/boxes.

// Returns [{ element_id, tag, role, label, text?, bbox: [x,y,w,h] }]
// for visible interactive elements + labelled inputs.
function extractElements(root = document) {
  // TODO: walk DOM + a11y roles, collect getBoundingClientRect boxes
  return [];
}

// BrowserState: { url, title, formCount, focusedElementId }
function collectBrowserState() {
  // TODO
  return null;
}

export { extractElements, collectBrowserState };
