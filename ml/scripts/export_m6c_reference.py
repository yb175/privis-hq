"""M6-C offline reference outputs for browser parity testing.

Runs the VALIDATED offline YuNet detector (ml/inference/yunet_detector.py,
unchanged) at the M6-B2 approved operating point 0.35 over fixtures F1-F12
and writes the detection results the TypeScript browser detector must
reproduce within tolerance (boxes <= 1 px, confidence <= 0.01, identical
counts). Also records the letterbox scale per fixture so the browser test can
cross-check preprocessing.

Output: ml/models/face_detection_yunet/reference_outputs_m6c.json
(metadata only — no image content, no text content, no PII).

Run: .venv-ml/Scripts/python.exe ml/scripts/export_m6c_reference.py
"""

import json
import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "ml" / "inference"))

from yunet_detector import YuNetDetector, preprocess, verify_model  # noqa: E402

MANIFEST_F1_7 = ROOT / "ml" / "dataset" / "annotations" / "m6b_face_fixtures.json"
MANIFEST_F8_12 = ROOT / "ml" / "dataset" / "annotations" / "m6b2_face_fixtures.json"
OUT = ROOT / "ml" / "models" / "face_detection_yunet" / "reference_outputs_m6c.json"
THRESHOLD = 0.35


def main() -> None:
    verify_model()  # supply-chain gate: 2023mar, SHA-256 unchanged
    fixtures = {**json.loads(MANIFEST_F1_7.read_text(encoding="utf-8")),
                **json.loads(MANIFEST_F8_12.read_text(encoding="utf-8"))}
    order = ("F1", "F2", "F3", "F4", "F5", "F6", "F7", "F8", "F9", "F10", "F11", "F12")

    det = YuNetDetector(score_threshold=THRESHOLD)
    out = {"model": "face_detection_yunet_2023mar.onnx",
           "sha256": "8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4",
           "score_threshold": THRESHOLD,
           "note": "offline ORT (CPU) reference at the M6-B2 approved operating point"}
    for fid in order:
        img = Image.open(ROOT / fixtures[fid]["image"]).convert("RGB")
        _, scale = preprocess(img)
        out[fid] = {"image": fixtures[fid]["image"],
                    "image_size": [fixtures[fid]["width"], fixtures[fid]["height"]],
                    "letterbox_scale": round(scale, 6),
                    "detections": det.detect(img)}
    OUT.write_text(json.dumps(out, indent=2) + "\n", encoding="utf-8")
    counts = {fid: len(out[fid]["detections"]) for fid in order}
    print(f"wrote {OUT}")
    print("counts:", counts)


if __name__ == "__main__":
    main()
