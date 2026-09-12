// content/occlusion.ts
// Occlusion and visibility verification for browser elements.
//
// PROVENANCE: ported from approved reference PravAl2028/SIH26171,
// extension/src/content/occlusion.ts (author-granted permission).
//
// Ensures that target elements are visually reachable on screen and not covered by
// modals, overlays, sticky headers, or scrolled completely out of view.

export interface OcclusionResult {
  visible: boolean;
  occluded: boolean;
  visibleRatio: number;
  reason?: string;
}

/**
 * Checks whether an element is visible and reachable at its center point or within bounds.
 */
export function checkOcclusion(el: Element): OcclusionResult {
  if (typeof el.getBoundingClientRect !== "function") {
    // Fallback if no layout engine or rect method
    return { visible: true, occluded: false, visibleRatio: 1.0 };
  }

  const rect = el.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) {
    return { visible: false, occluded: true, visibleRatio: 0, reason: "zero-dimensions" };
  }

  const vw = typeof window !== "undefined" && window.innerWidth
    ? window.innerWidth
    : typeof document !== "undefined" && document.documentElement
    ? document.documentElement.clientWidth || 1024
    : 1024;

  const vh = typeof window !== "undefined" && window.innerHeight
    ? window.innerHeight
    : typeof document !== "undefined" && document.documentElement
    ? document.documentElement.clientHeight || 768
    : 768;

  // Check if completely outside viewport
  if (rect.right <= 0 || rect.bottom <= 0 || rect.left >= vw || rect.top >= vh) {
    return { visible: false, occluded: true, visibleRatio: 0, reason: "outside-viewport" };
  }

  // Calculate intersection area with viewport
  const ix0 = Math.max(0, rect.left);
  const iy0 = Math.max(0, rect.top);
  const ix1 = Math.min(vw, rect.right);
  const iy1 = Math.min(vh, rect.bottom);
  const visibleArea = Math.max(0, ix1 - ix0) * Math.max(0, iy1 - iy0);
  const totalArea = rect.width * rect.height;
  const visibleRatio = totalArea > 0 ? visibleArea / totalArea : 0;

  if (visibleRatio <= 0.05) {
    return { visible: false, occluded: true, visibleRatio, reason: "mostly-clipped" };
  }

  // Hit-test center point if elementFromPoint is supported
  if (typeof document !== "undefined" && typeof document.elementFromPoint === "function") {
    const cx = Math.floor((ix0 + ix1) / 2);
    const cy = Math.floor((iy0 + iy1) / 2);

    try {
      const topEl = document.elementFromPoint(cx, cy);
      if (topEl) {
        const isSelfOrChild = el === topEl || el.contains(topEl);
        const isParent = topEl.contains(el);
        if (!isSelfOrChild && !isParent) {
          return {
            visible: true,
            occluded: true,
            visibleRatio,
            reason: `covered-by-${topEl.tagName.toLowerCase()}`,
          };
        }
      }
    } catch {
      // Ignore elementFromPoint errors in synthetic test runners
    }
  }

  return { visible: true, occluded: false, visibleRatio };
}
