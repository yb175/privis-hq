// privacy/engine/index.ts
// Central export boundary for the Local Privacy Vision & Detection Engine.
//
// Subsystems:
// 1. Structural / DOM detection: detect-dom.ts
// 2. Lexical candidate extraction & qualification: detect-lexical.ts
// 3. Format & Checksum validators: validators.ts
// 4. Contract normalization & fail-closed assertions: normalize.ts
// 5. Vision / DOM detection fusion: fuse.ts

export {
  CATEGORIES,
  detectSensitive,
} from "./detect-dom.js";

export {
  scanText,
  detectLexical,
  disqualifiedByCaption,
  CAPTION_WINDOW,
  type LexicalMatch,
} from "./detect-lexical.js";

export {
  isVerhoeffValid,
  verhoeffCheckDigit,
  isAadhaarValid,
  isLuhnValid,
  cardIssuer,
  isCardValid,
  isPanValid,
  gstinCheckChar,
  isGstinValid,
  IFSC_BANK_CODES,
  isIfscValid,
  isKnownIfscBank,
  UPI_PSP_HANDLES,
  isUpiHandleValid,
  isIndianMobileValid,
  isEmailValid,
  isPincodeValid,
  isPassportValid,
  isDrivingLicenceValid,
  parseDate,
  isPlausibleBirthDate,
} from "./validators.js";

export {
  PrivacyError,
  assertValidBBox,
  normalizeDetection,
  normalizeDetections,
  VALID_CATEGORIES,
  VALID_SOURCES,
  type PrivacyErrorCode,
} from "./normalize.js";

export {
  fuseDetections,
  iou,
} from "./fuse.js";

export {
  deduplicateDetections,
  mergeOverlappingDetections,
  sortDetections,
} from "./merge.js";

export {
  loadFaceDetector,
  SCORE_THRESHOLD,
  runVisionPath,
  getVisionRuntime,
  opaqueRegions,
  createOcrCache,
  linesToViewport,
  MIN_OCR_SIDE,
  OCR_CACHE_LIMIT,
  buildOffsetTable,
  runsForSpan,
  boxForSpan,
  chunkDocument,
  toDocumentSpan,
  dedupeSpans,
  DEFAULT_MAX_TOKENS,
  DEFAULT_OVERLAP_TOKENS,
  type FaceDetector,
  type FaceDetectorInput,
  type VisionPathOptions,
  type VisionRuntime,
  type OcrLine,
  type OcrRegion,
  type OcrCache,
  type CacheEntry,
  type OffsetTable,
  type OffsetEntry,
  type TextRunLike,
  type RunSource,
  type Chunk,
  type ChunkOptions,
  type DocSpan,
} from "./vision/index.js";

