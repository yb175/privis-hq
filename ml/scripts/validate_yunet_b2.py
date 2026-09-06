"""M6-B2: YuNet 2023mar operating-point justification (analysis experiment).

Question: does ANY threshold in 0.25..0.65 satisfy ALL unchanged acceptance
gates on the expanded fixture suite F1-F12 (F8-F12 = hard negatives)?

Detector, decode, NMS, preprocessing: unchanged from M6-B. Only the operating
threshold varies. No calibration tricks.

Outputs (all under ml/models/face_detection_yunet/):
  validation_report_b2.json  — machine-readable full evidence
  (the markdown report lives in the model README, updated separately)

Run from the repository root:
    .venv-ml/Scripts/python.exe ml/scripts/validate_yunet_b2.py
"""

import json
import sys
import time
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))                          # ml.evaluation.*
sys.path.insert(0, str(ROOT / "ml" / "inference"))     # yunet_detector, face_detector

from ml.evaluation.evaluate import evaluate, iou  # noqa: E402
from yunet_detector import YuNetDetector, verify_model  # noqa: E402

MANIFEST_F1_7 = ROOT / "ml" / "dataset" / "annotations" / "m6b_face_fixtures.json"
MANIFEST_F8_12 = ROOT / "ml" / "dataset" / "annotations" / "m6b2_face_fixtures.json"
REPORT = ROOT / "ml" / "models" / "face_detection_yunet" / "validation_report_b2.json"

SWEEP = (0.25, 0.30, 0.35, 0.40, 0.45, 0.50, 0.55, 0.60, 0.65)
PROBE_THRESHOLD = 0.05   # raw-score probe (low enough to see every real face)
LATENCY_RUNS = 20
GATES = {"precision": 0.90, "recall": 0.90, "f1": 0.90, "mean_iou": 0.75,
         "recall_vs_mtcnn": 0.05, "load_ms": 2000.0, "first_ms": 300.0, "steady_ms": 150.0}
ORIGINAL_NEGATIVES = ("F5", "F6", "F7")
HARD_NEGATIVES = ("F8", "F9", "F10", "F11", "F12")
ALL_NEGATIVES = ORIGINAL_NEGATIVES + HARD_NEGATIVES


def to_eval(gt_boxes, dets):
    gt = [{"element_id": f"gt-{i}", "category": "FACE", "bbox": list(b),
           "confidence": 1.0, "source": "vision"} for i, b in enumerate(gt_boxes)]
    preds = [{"element_id": f"vision-{j}", "category": d["category"], "bbox": d["bbox"],
              "confidence": d["confidence"], "source": "vision"} for j, d in enumerate(dets)]
    return gt, preds


def best_iou_pred(gt_box, preds):
    """Best (IoU, pred) for one GT box among preds."""
    best, best_i = 0.0, None
    for p in preds:
        v = iou(gt_box, p["bbox"])
        if v > best:
            best, best_i = v, p
    return best, best_i


def main() -> None:
    f1_7 = json.loads(MANIFEST_F1_7.read_text(encoding="utf-8"))
    f8_12 = json.loads(MANIFEST_F8_12.read_text(encoding="utf-8"))
    fixtures = {**f1_7, **f8_12}
    order = ("F1", "F2", "F3", "F4", "F5", "F6", "F7") + HARD_NEGATIVES
    assert all(f in fixtures for f in order), "missing fixtures"

    images = {fid: Image.open(ROOT / fixtures[fid]["image"]).convert("RGB") for fid in order}

    # --- 0. Supply-chain gate (artifact unchanged) ---
    verify_model()
    print("PASS supply-chain: size 232589, SHA-256 8f2383e4...52fa4 (unchanged)")

    # --- 1. Load once; latency at the M6-B default 0.60 (methodology unchanged) ---
    t0 = time.perf_counter()
    detector = YuNetDetector(score_threshold=0.60)
    load_ms = (time.perf_counter() - t0) * 1000
    t0 = time.perf_counter()
    detector.detect(images["F1"])
    first_ms = (time.perf_counter() - t0) * 1000
    times = []
    for _ in range(LATENCY_RUNS):
        t0 = time.perf_counter()
        detector.detect(images["F1"])
        times.append((time.perf_counter() - t0) * 1000)
    steady_ms = sorted(times)[LATENCY_RUNS // 2]
    print(f"latency @0.60: load {load_ms:.0f} ms | first {first_ms:.0f} ms | steady(median) {steady_ms:.0f} ms")

    # --- 2. Per-face raw score characterization (F1-F4 positives) ---
    # Raw model score per GT face: probe at 0.05, take the best-IoU prediction
    # per GT. Scores are threshold-independent (threshold only filters).
    probe = YuNetDetector(score_threshold=PROBE_THRESHOLD)
    face_scores = []  # {fixture, gt, score, match_iou}
    for fid in ("F1", "F2", "F3", "F4"):
        preds = probe.detect(images[fid])
        for gi, gt_box in enumerate(fixtures[fid]["faces"]):
            best_iou, best = best_iou_pred(gt_box, preds)
            face_scores.append({"fixture": fid, "gt": gt_box, "gt_index": gi,
                                "score": best["confidence"] if best and best_iou >= 0.5 else None,
                                "match_iou": round(best_iou, 4)})
    print("\nper-face raw scores (probe @0.05):")
    for fs in face_scores:
        print(f"  {fs['fixture']} gt{fs['gt_index']} {fs['gt']} -> score={fs['score']} IoU={fs['match_iou']}")

    # --- 3. Threshold sweep over F1-F12 ---
    sweep = {}
    for thr in SWEEP:
        det_t = YuNetDetector(score_threshold=thr)
        gt_all, pred_all, ious = [], [], []
        fp_orig = fp_hard = 0
        per_fixture = {}
        for fid in order:
            dets = det_t.detect(images[fid])
            gt, preds = to_eval(fixtures[fid]["faces"], dets)
            res = evaluate(gt, preds)["aggregate"]
            # per-GT matched IoU for mean matched IoU
            for gb in fixtures[fid]["faces"]:
                bi, bp = best_iou_pred(gb, preds)
                if bi >= 0.5:
                    ious.append(bi)
            gt_all += gt
            pred_all += preds
            if fid in ALL_NEGATIVES:
                if fid in ORIGINAL_NEGATIVES:
                    fp_orig += res["fp"]
                else:
                    fp_hard += res["fp"]
            per_fixture[fid] = {"pred_count": len(preds), "fp": res["fp"], "fn": res["fn"], "tp": res["tp"]}
        agg = evaluate(gt_all, pred_all)["aggregate"]
        mean_iou = sum(ious) / len(ious) if ious else 0.0
        sweep[f"{thr:.2f}"] = {
            "tp": agg["tp"], "fp": agg["fp"], "fn": agg["fn"],
            "precision": agg["precision"], "recall": agg["recall"], "f1": agg["f1"],
            "mean_matched_iou": round(mean_iou, 4),
            "fp_F5_F7": fp_orig, "fp_F8_F12": fp_hard,
            "per_fixture": per_fixture,
        }
        print(f"thr {thr:.2f}: TP {agg['tp']} FP {agg['fp']} FN {agg['fn']} "
              f"P {agg['precision']:.3f} R {agg['recall']:.4f} F1 {agg['f1']:.4f} "
              f"IoU {mean_iou:.3f} | FP F5-F7 {fp_orig}, FP F8-F12 {fp_hard}")

    # --- 4. MTCNN baseline, unchanged config, full F1-F12 ---
    from face_detector import detect_faces

    def mtcnn_detect(img):
        dets, _device = detect_faces(img, device="cpu")
        return dets

    gt_all, pred_all, ious = [], [], []
    mtcnn_fp_orig = mtcnn_fp_hard = 0
    mtcnn_per_fixture = {}
    for fid in order:
        dets = mtcnn_detect(images[fid])
        gt, preds = to_eval(fixtures[fid]["faces"], dets)
        res = evaluate(gt, preds)["aggregate"]
        for gb in fixtures[fid]["faces"]:
            bi, _bp = best_iou_pred(gb, preds)
            if bi >= 0.5:
                ious.append(bi)
        gt_all += gt
        pred_all += preds
        if fid in ALL_NEGATIVES:
            if fid in ORIGINAL_NEGATIVES:
                mtcnn_fp_orig += res["fp"]
            else:
                mtcnn_fp_hard += res["fp"]
        mtcnn_per_fixture[fid] = {"pred_count": len(preds), "fp": res["fp"], "fn": res["fn"], "tp": res["tp"]}
    mtcnn_agg = evaluate(gt_all, pred_all)["aggregate"]
    mtcnn = {"aggregate": mtcnn_agg,
             "mean_matched_iou": round(sum(ious) / len(ious), 4) if ious else 0.0,
             "fp_F5_F7": mtcnn_fp_orig, "fp_F8_F12": mtcnn_fp_hard,
             "per_fixture": mtcnn_per_fixture,
             "note": "MTCNN via facenet-pytorch (ML-1), device=cpu, default config 0.5 — unchanged"}
    print(f"\nMTCNN F1-F12: {mtcnn_agg} | IoU {mtcnn['mean_matched_iou']} | FP F5-F7 {mtcnn_fp_orig}, F8-F12 {mtcnn_fp_hard}")

    # --- 5. Gate evaluation per threshold (all gates, unchanged values) ---
    gate_table = {}
    for thr_s, row in sweep.items():
        g = {
            "precision_ge_0.90": row["precision"] >= GATES["precision"],
            "recall_ge_0.90": row["recall"] >= GATES["recall"],
            "f1_ge_0.90": row["f1"] >= GATES["f1"],
            "mean_matched_iou_ge_0.75": row["mean_matched_iou"] >= GATES["mean_iou"],
            "recall_within_0.05_of_mtcnn": row["recall"] >= mtcnn_agg["recall"] - GATES["recall_vs_mtcnn"],
            "zero_fp_on_F5_F12": row["fp_F5_F7"] == 0 and row["fp_F8_F12"] == 0,
            # latency measured at 0.60 (threshold-independent: same single forward pass;
            # confirmed identical at candidate threshold below)
            "load_under_2000ms": load_ms < GATES["load_ms"],
            "first_under_300ms": first_ms < GATES["first_ms"],
            "steady_under_150ms": steady_ms < GATES["steady_ms"],
        }
        g["all_pass"] = all(g.values())
        gate_table[thr_s] = g

    passing = [t for t, g in gate_table.items() if g["all_pass"]]

    # --- 6. Determinism at candidate/selected threshold ---
    selected = max(passing) if passing else "0.60"   # highest passing = most conservative
    det_sel = YuNetDetector(score_threshold=float(selected))
    run_a = [json.dumps(det_sel.detect(images[fid])) for fid in order]  # same session, pass 1
    run_b = [json.dumps(det_sel.detect(images[fid])) for fid in order]  # same session, pass 2
    det_sel2 = YuNetDetector(score_threshold=float(selected))           # fresh session
    run_c = [json.dumps(det_sel2.detect(images[fid])) for fid in order]
    deterministic = run_a == run_b == run_c  # per-fixture: same count, boxes, scores, order
    # latency at selected threshold (same methodology)
    t0 = time.perf_counter()
    det_sel.detect(images["F1"])
    first_sel = (time.perf_counter() - t0) * 1000
    times = []
    for _ in range(LATENCY_RUNS):
        t0 = time.perf_counter()
        det_sel.detect(images["F1"])
        times.append((time.perf_counter() - t0) * 1000)
    steady_sel = sorted(times)[LATENCY_RUNS // 2]
    print(f"\nselected threshold: {selected} (determinism {'PASS' if deterministic else 'FAIL'}, "
          f"first {first_sel:.0f} ms, steady {steady_sel:.0f} ms)")
    if passing:
        # fold measured selected-threshold latency + determinism into its gates
        gate_table[selected]["deterministic"] = deterministic
        gate_table[selected]["first_under_300ms"] = first_sel < GATES["first_ms"]
        gate_table[selected]["steady_under_150ms"] = steady_sel < GATES["steady_ms"]
        gate_table[selected]["all_pass"] = all(v for k, v in gate_table[selected].items() if k != "all_pass")

    approved = bool(passing) and gate_table[selected]["all_pass"]

    # --- 7. Write report ---
    report = {
        "experiment": "M6-B2: YuNet 2023mar operating-point justification",
        "artifact": {"name": "face_detection_yunet_2023mar.onnx", "size_bytes": 232589,
                     "sha256": "8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4",
                     "unchanged_from_m6b": True},
        "fixtures": {"F1_F7": "unchanged M6-B manifest (m6b_face_fixtures.json)",
                     "F8_F12": "M6-B2 hard negatives (m6b2_face_fixtures.json), zero faces by construction",
                     "order": list(order)},
        "per_face_scores": face_scores,
        "threshold_sweep": sweep,
        "mtcnn_baseline": mtcnn,
        "latency": {"load_ms": round(load_ms, 1), "first_ms": round(first_ms, 1),
                    "steady_ms_median": round(steady_ms, 1), "runs": LATENCY_RUNS,
                    "at_selected_threshold": {"threshold": float(selected),
                                              "first_ms": round(first_sel, 1),
                                              "steady_ms_median": round(steady_sel, 1)}},
        "determinism_at_selected": deterministic,
        "gate_table": gate_table,
        "passing_thresholds": passing,
        "selected_threshold": float(selected) if approved else None,
        "decision": "YUNET APPROVED @ " + selected if approved else "YUNET REJECTED — NO FEASIBLE OPERATING POINT",
    }
    REPORT.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(f"\nPASSING thresholds: {passing or 'none'}")
    print("DECISION:", report["decision"])


if __name__ == "__main__":
    main()
