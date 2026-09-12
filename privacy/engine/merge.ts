// privacy/engine/merge.ts
// Deterministic deduplication and merge policies for privacy findings (Phase 02).
//
// Rules:
// 1. Deduplication:
//    - Findings with the same (element_id, category) collapse into one.
//    - The detection with the highest confidence wins.
//    - Ties break deterministically by source ("dom" > "vision" > "ocr").
// 2. Overlap policy:
//    - Same-category findings with high spatial overlap (IoU >= threshold) on the same element merge.
//    - Distinct categories never merge, even with 100% spatial overlap.
//    - Enclosed boxes of the same category merge into the outer bounding box.
// 3. Determinism:
//    - Output ordering is strictly deterministic: sorted by (bbox.y, bbox.x, category, element_id).

import type { Detection, DetectionSource } from "../../types/index.js";
import { iou } from "./fuse.js";
import { normalizeDetections } from "./normalize.js";

const SOURCE_PRIORITY: Record<DetectionSource, number> = {
  dom: 3,
  vision: 2,
  ocr: 1,
};

/**
 * Deterministically deduplicate detections.
 * Keyed by (element_id, category). Highest confidence wins; ties prefer DOM source.
 */
export function deduplicateDetections(detections: readonly Detection[]): Detection[] {
  const normalized = normalizeDetections(detections);
  const byKey = new Map<string, Detection>();

  for (const det of normalized) {
    const key = `${det.element_id}\u0000${det.category}`;
    const existing = byKey.get(key);

    if (!existing) {
      byKey.set(key, det);
      continue;
    }

    // Compare confidence first
    if (det.confidence > existing.confidence) {
      byKey.set(key, det);
    } else if (det.confidence === existing.confidence) {
      const detPrio = SOURCE_PRIORITY[det.source] ?? 0;
      const existPrio = SOURCE_PRIORITY[existing.source] ?? 0;
      if (detPrio > existPrio) {
        byKey.set(key, det);
      }
    }
  }

  return sortDetections([...byKey.values()]);
}

/**
 * Deterministically sort detections by position, category, and element_id.
 */
export function sortDetections(detections: readonly Detection[]): Detection[] {
  return [...detections].sort((a, b) => {
    if (a.bbox[1] !== b.bbox[1]) return a.bbox[1] - b.bbox[1]; // y
    if (a.bbox[0] !== b.bbox[0]) return a.bbox[0] - b.bbox[0]; // x
    if (a.bbox[3] !== b.bbox[3]) return a.bbox[3] - b.bbox[3]; // h
    if (a.bbox[2] !== b.bbox[2]) return a.bbox[2] - b.bbox[2]; // w
    if (a.category !== b.category) return a.category.localeCompare(b.category);
    return a.element_id.localeCompare(b.element_id);
  });
}

/**
 * Merge same-category overlapping detections on the same element or coordinate region.
 * Distinct categories remain distinct.
 */
export function mergeOverlappingDetections(
  detections: readonly Detection[],
  iouThreshold = 0.5
): Detection[] {
  const normalized = normalizeDetections(detections);
  if (normalized.length <= 1) return [...normalized];

  const result: Detection[] = [];
  const mergedIndices = new Set<number>();

  for (let i = 0; i < normalized.length; i++) {
    if (mergedIndices.has(i)) continue;
    let current = { ...normalized[i]! };

    for (let j = i + 1; j < normalized.length; j++) {
      if (mergedIndices.has(j)) continue;
      const other = normalized[j]!;

      // Distinct categories NEVER merge
      if (current.category !== other.category) continue;

      // Only merge if on the same element or both are synthetic vision elements (source === "vision")
      // Detections on distinct DOM elements must NEVER drop one element's ID (structural sanitization relies on element IDs)
      const isSameElement = current.element_id === other.element_id;
      const isBothVision =
        current.source === "vision" &&
        other.source === "vision" &&
        current.element_id.startsWith("vision-") &&
        other.element_id.startsWith("vision-");
      if (!isSameElement && !isBothVision) continue;

      const overlap = iou(current.bbox, other.bbox);
      if (overlap >= iouThreshold || isContained(current.bbox, other.bbox) || isContained(other.bbox, current.bbox)) {
        mergedIndices.add(j);
        // Union bounding box
        const x1 = Math.min(current.bbox[0], other.bbox[0]);
        const y1 = Math.min(current.bbox[1], other.bbox[1]);
        const x2 = Math.max(current.bbox[0] + current.bbox[2], other.bbox[0] + other.bbox[2]);
        const y2 = Math.max(current.bbox[1] + current.bbox[3], other.bbox[1] + other.bbox[3]);

        const pickOther = other.confidence > current.confidence ||
          (other.confidence === current.confidence && (SOURCE_PRIORITY[other.source] ?? 0) > (SOURCE_PRIORITY[current.source] ?? 0));

        current = {
          element_id: pickOther ? other.element_id : current.element_id,
          category: current.category,
          bbox: [x1, y1, x2 - x1, y2 - y1],
          confidence: Math.max(current.confidence, other.confidence),
          source: (SOURCE_PRIORITY[current.source] ?? 0) >= (SOURCE_PRIORITY[other.source] ?? 0)
            ? current.source
            : other.source,
        };
      }
    }
    result.push(current);
  }

  return deduplicateDetections(result);
}

function isContained(inner: readonly number[], outer: readonly number[]): boolean {
  return (
    inner[0] >= outer[0] &&
    inner[1] >= outer[1] &&
    inner[0] + inner[2] <= outer[0] + outer[2] &&
    inner[1] + inner[3] <= outer[1] + outer[3]
  );
}
