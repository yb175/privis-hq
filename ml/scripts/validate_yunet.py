"""ML-6B offline YuNet validation experiment (M6-B decision gate).

Runs the official YuNet 2023mar artifact and the existing ML-1 MTCNN baseline
over the deterministic synthetic fixtures F1-F7, scores both with the ML-5
evaluator, sweeps YuNet score thresholds, measures latency, checks
determinism, and writes:

  ml/models/face_detection_yunet/validation_report.json  (machine report)
  ml/models/face_detection_yunet/reference_outputs.json  (parity artifacts,
      metadata only — no images, no text content)

Everything is local: no network during inference, synthetic images only,
detection metadata only. Run from the repository root:

    .venv-ml/Scripts/python.exe ml/scripts/validate_yunet.py
"""

import json
import sys
import time
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))                          # ml.evaluation.*
sys.path.insert(0, str(ROOT / "ml" / "inference"))     # yunet_detector, face_detector

from ml.evaluation.evaluate import evaluate, iou, match_detections  # noqa: E402
from yunet_detector import YuNetDetector, preprocess, verify_model  # noqa: E402

ANNOTATIONS = ROOT / "ml" / "dataset" / "annotations" / "m6b_face_fixtures.json"
REPORT = ROOT / "ml" / "models" / "face_detection_yunet" / "validation_report.json"
REFERENCE = ROOT / "ml" / "models" / "face_detection_yunet" / "reference_outputs.json"
SWEEP = (0.30, 0.45, 0.60, 0.75)
LATENCY_RUNS = 20
GATES = {
    "precision": 0.90, "recall": 0.90, "f1": 0.90, "mean_matched_iou": 0.75,
    "recall_vs_mtcnn": 0.05,  # yunet recall >= mtcnn recall - 0.05
    "load_ms": 2000.0, "first_ms": 300.0, "steady_ms": 150.0,
}
POSITIVE = ("F1", "F2", "F3", "F4")
NEGATIVE = ("F5", "F6", "F7")
ALL_FIXTURES = POSITIVE + NEGATIVE


def to_eval(gt_boxes: list, dets: list) -> tuple[list, list]:
    """Wrap detector output into full ML-5 Detection shape (evaluator requires
    element_id; vision matching ignores it — synthetic ids only)."""
    gt = [{"element_id": f"gt-{i}", "category": "FACE", "bbox": list(b),
           "confidence": 1.0, "source": "vision"} for i, b in enumerate(gt_boxes)]
    preds = [{"element_id": f"vision-{j}", "category": d["category"], "bbox": d["bbox"],
              "confidence": d["confidence"], "source": "vision"} for j, d in enumerate(dets)]
    return gt, preds


def matched_ious(gt: list, preds: list) -> list:
    """IoU of each matched (gt, pred) pair under ML-5's matcher."""
    return [iou(gt[i]["bbox"], preds[j]["bbox"]) for i, j in match_detections(gt, preds)]


def run_detector_on_fixtures(detector, fixtures):
    """Returns {fixture_id: detections} and per-fixture ML-5 results."""
    per_fixture, combined_gt, combined_pred = {}, [], []
    ious = []
    for fid, spec in fixtures.items():
        img = Image.open(ROOT / spec["image"]).convert("RGB")
        dets = detector.detect(img)
        gt, preds = to_eval(spec["faces"], dets)
        per_fixture[fid] = {
            "gt_count": len(gt), "pred_count": len(preds),
            "metrics": evaluate(gt, preds)["aggregate"],
            "matched_ious": [round(v, 4) for v in matched_ious(gt, preds)],
        }
        combined_gt += gt
        combined_pred += preds
    aggregate = evaluate(combined_gt, combined_pred)["aggregate"]
    ious = matched_ious(combined_gt, combined_pred)
    return per_fixture, aggregate, ious


def main() -> None:
    fixtures = json.loads(ANNOTATIONS.read_text(encoding="utf-8"))
    for fid in ALL_FIXTURES:
        assert fid in fixtures, f"missing fixture {fid} in annotations"

    # --- 0. Supply-chain gate ---
    verify_model()
    print("PASS supply-chain gate: size 232589, SHA-256 matches expected")

    # --- 1. Latency (measured BEFORE importing torch/MTCNN into the process) ---
    t0 = time.perf_counter()
    detector = YuNetDetector()
    load_ms = (time.perf_counter() - t0) * 1000
    f1_img = Image.open(ROOT / fixtures["F1"]["image"]).convert("RGB")
    t0 = time.perf_counter()
    detector.detect(f1_img)
    first_ms = (time.perf_counter() - t0) * 1000
    times = []
    for _ in range(LATENCY_RUNS):
        t0 = time.perf_counter()
        detector.detect(f1_img)
        times.append((time.perf_counter() - t0) * 1000)
    steady_ms = sorted(times)[LATENCY_RUNS // 2]  # median
    print(f"latency: load {load_ms:.0f} ms | first {first_ms:.0f} ms | "
          f"steady(median of {LATENCY_RUNS}) {steady_ms:.0f} ms")

    # --- 2. YuNet @ 0.60 (primary gate) + threshold sweep ---
    yunet_per_fix, yunet_agg, yunet_ious = run_detector_on_fixtures(detector, fixtures)
    sweep = {}
    for thr in SWEEP:
        det_t = YuNetDetector(score_threshold=thr)
        sweep[str(thr)] = run_detector_on_fixtures(det_t, fixtures)[1]
    print(f"YuNet @0.60 aggregate: {yunet_agg}")

    # --- 3. Determinism (same session, and a fresh session) ---
    f2_img = Image.open(ROOT / fixtures["F2"]["image"]).convert("RGB")
    det_a = json.dumps(detector.detect(f2_img), sort_keys=False)
    det_b = json.dumps(detector.detect(f2_img), sort_keys=False)
    fresh = YuNetDetector()
    det_c = json.dumps(fresh.detect(f2_img), sort_keys=False)
    deterministic = det_a == det_b == det_c
    print(f"determinism (repeat + fresh session): {'PASS' if deterministic else 'FAIL'}")

    # --- 4. MTCNN baseline (existing ML-1, unchanged, CPU) ---
    mtcnn_per_fix, mtcnn_agg, _ = run_detector_on_fixtures(_MtcnnWrapper(), fixtures)
    print(f"MTCNN aggregate: {mtcnn_agg}")

    # --- 5. Negative-fixture false positives ---
    neg_fp = {fid: yunet_per_fix[fid]["metrics"]["fp"] for fid in NEGATIVE}
    print(f"YuNet FP on negatives: {neg_fp}")

    # --- 6. Reference outputs for the later browser parity test ---
    reference = {"model": "face_detection_yunet_2023mar.onnx",
                 "sha256": "8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4",
                 "input_size": 640, "score_threshold": 0.6, "nms_iou": 0.3, "top_k": 5000}
    for fid, spec in fixtures.items():
        img = Image.open(ROOT / spec["image"]).convert("RGB")
        blob, scale = preprocess(img)
        raw = detector.infer_raw(blob)
        dets = detector.detect(img)
        reference[fid] = {
            "image": spec["image"], "image_size": [spec["width"], spec["height"]],
            "letterbox_scale": round(scale, 6), "count": len(dets),
            # unrounded decode values for tight parity comparison, plus final ints
            "detections": dets,
            "tensor_shapes": {k: list(v.shape) for k, v in raw.items()},
            "tensor_probe": {k: [round(float(x), 6) for x in v.reshape(-1)[:8]]
                             for k, v in raw.items()},
        }
    REFERENCE.write_text(json.dumps(reference, indent=2) + "\n", encoding="utf-8")

    # --- 7. Gate evaluation ---
    mean_iou = sum(yunet_ious) / len(yunet_ious) if yunet_ious else 0.0
    gates = {
        "sha256_match": True,
        "precision_ge_0.90": yunet_agg["precision"] >= GATES["precision"],
        "recall_ge_0.90": yunet_agg["recall"] >= GATES["recall"],
        "f1_ge_0.90": yunet_agg["f1"] >= GATES["f1"],
        "mean_matched_iou_ge_0.75": mean_iou >= GATES["mean_matched_iou"],
        "recall_within_0.05_of_mtcnn": yunet_agg["recall"] >= mtcnn_agg["recall"] - GATES["recall_vs_mtcnn"],
        "zero_fp_on_negatives": all(v == 0 for v in neg_fp.values()),
        "load_under_2000ms": load_ms < GATES["load_ms"],
        "first_under_300ms": first_ms < GATES["first_ms"],
        "steady_under_150ms": steady_ms < GATES["steady_ms"],
        "deterministic": deterministic,
    }
    report = {
        "model": {"name": "face_detection_yunet_2023mar.onnx", "size_bytes": 232589,
                  "sha256": "8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4",
                  "runtime": f"onnxruntime {__import__('onnxruntime').__version__} CPUExecutionProvider"},
        "yunet_at_0.60": {"aggregate": yunet_agg, "per_fixture": yunet_per_fix,
                          "mean_matched_iou": round(mean_iou, 4)},
        "threshold_sweep": sweep,
        "mtcnn_baseline": {"aggregate": mtcnn_agg, "per_fixture": mtcnn_per_fix,
                           "note": "MTCNN via facenet-pytorch (ML-1), device=cpu, default min_confidence 0.5"},
        "latency": {"model_load_ms": round(load_ms, 1), "first_inference_ms": round(first_ms, 1),
                    "steady_state_ms_median": round(steady_ms, 1), "runs": LATENCY_RUNS,
                    "input": "F1 640x480 letterboxed to 640x640", "provider": "CPUExecutionProvider"},
        "negative_fixture_fp": neg_fp,
        "determinism": deterministic,
        "gates": gates,
        "all_gates_pass": all(gates.values()),
    }
    REPORT.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")

    print("\n=== GATE TABLE ===")
    for name, ok in gates.items():
        print(f"  {'PASS' if ok else 'FAIL'}  {name}")
    print("\nYUNET APPROVED" if all(gates.values()) else "\nYUNET REJECTED")


class _MtcnnWrapper:
    """Adapts ml/inference/face_detector.detect_faces to the detector interface
    used by run_detector_on_fixtures (CPU, ML-1 default threshold 0.5)."""

    def detect(self, image: Image.Image) -> list[dict]:
        from face_detector import detect_faces  # deferred: heavy torch import
        dets, _device = detect_faces(image, device="cpu")
        return dets


if __name__ == "__main__":
    main()
