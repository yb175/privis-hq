// privacy/engine/vision/index.ts
// Central export boundary for Privis Vision & OCR Subsystems.

export {
  loadFaceDetector,
  SCORE_THRESHOLD,
  type FaceDetector,
  type FaceDetectorInput,
} from "./face-detector.js";

export {
  runVisionPath,
  type VisionPathOptions,
} from "./face-pipeline.js";

export {
  getVisionRuntime,
  type VisionRuntime,
} from "./ort-runtime.js";

export {
  opaqueRegions,
  createOcrCache,
  linesToViewport,
  MIN_OCR_SIDE,
  OCR_CACHE_LIMIT,
  type OcrLine,
  type OcrRegion,
  type OcrCache,
  type CacheEntry,
} from "./ocr-regions.js";

export {
  buildOffsetTable,
  runsForSpan,
  boxForSpan,
  chunkDocument,
  toDocumentSpan,
  dedupeSpans,
  DEFAULT_MAX_TOKENS,
  DEFAULT_OVERLAP_TOKENS,
  type OffsetTable,
  type OffsetEntry,
  type TextRunLike,
  type RunSource,
  type Chunk,
  type ChunkOptions,
  type DocSpan,
} from "./text-chunks.js";
