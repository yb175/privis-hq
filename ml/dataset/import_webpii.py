#!/usr/bin/env python3
"""Import and preprocess the WebPII dataset from Hugging Face.

Dataset Source: https://huggingface.co/datasets/WebPII/webpii
Reference: WebPII (Web Personally Identifiable Information) Dataset
License: Apache-2.0

This script imports the WebPII dataset, extracts page screenshots and annotated
PII/UI bounding boxes, maps categories to the PRIVIS SensitiveCategory schema
(CONTRACT.md), and saves images and structured annotations to ml/dataset.

Usage:
    # Dry-run inspection (metadata and schema only):
    python ml/dataset/import_webpii.py --dry-run

    # Import first 50 samples with streaming (recommended for testing):
    python ml/dataset/import_webpii.py --split train --max-samples 50 --streaming

    # Import complete test split:
    python ml/dataset/import_webpii.py --split test

    # Export annotations only without saving image files:
    python ml/dataset/import_webpii.py --split test --no-save-images
"""

from __future__ import annotations

import argparse
import io
import json
import logging
import os
import sys
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any, Dict, Generator, List, Optional, Tuple, Union

# Set up logging
logging.basicConfig(
    level=logging.INFO,
    format="[%(asctime)s] [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("import_webpii")

# Root directory of privis-hq repository
REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_DATASET_ROOT = REPO_ROOT / "ml" / "dataset"
DEFAULT_IMAGES_DIR = DEFAULT_DATASET_ROOT / "images" / "webpii"
DEFAULT_ANNOTATIONS_DIR = DEFAULT_DATASET_ROOT / "annotations"

HF_DATASET_NAME = "WebPII/webpii"

# PRIVIS SensitiveCategory mapping (CONTRACT.md)
# Categories: EMAIL | PAN | AADHAAR | AMOUNT | PHONE | NAME | FACE | PASSWORD
CATEGORY_MAP: Dict[str, str] = {
    # Email patterns
    "email": "EMAIL",
    "email_address": "EMAIL",
    "e-mail": "EMAIL",
    "user_email": "EMAIL",
    # Phone patterns
    "phone": "PHONE",
    "phone_number": "PHONE",
    "telephone": "PHONE",
    "mobile": "PHONE",
    "tel": "PHONE",
    "cell_phone": "PHONE",
    # Name patterns
    "name": "NAME",
    "full_name": "NAME",
    "first_name": "NAME",
    "last_name": "NAME",
    "username": "NAME",
    "user_name": "NAME",
    "customer_name": "NAME",
    "recipient_name": "NAME",
    # Financial / Amount patterns
    "amount": "AMOUNT",
    "price": "AMOUNT",
    "total": "AMOUNT",
    "subtotal": "AMOUNT",
    "currency": "AMOUNT",
    "payment_amount": "AMOUNT",
    "balance": "AMOUNT",
    "fee": "AMOUNT",
    # Authentication / Password patterns
    "password": "PASSWORD",
    "passcode": "PASSWORD",
    "pin": "PASSWORD",
    "secret": "PASSWORD",
    # Identity documents / Tax / Govt IDs
    "pan": "PAN",
    "pan_card": "PAN",
    "aadhaar": "AADHAAR",
    "aadhaar_number": "AADHAAR",
    "ssn": "PAN",  # Map US SSN to identity doc category
    "social_security_number": "PAN",
    "national_id": "AADHAAR",
    # Biometric / Face patterns
    "face": "FACE",
    "avatar": "FACE",
    "profile_photo": "FACE",
    "photo": "FACE",
}


@dataclass
class NormalizedBoundingBox:
    """Bounding box in standard [x, y, w, h] pixel / CSS coordinates."""
    x: float
    y: float
    w: float
    h: float

    def to_list(self) -> List[float]:
        return [round(self.x, 2), round(self.y, 2), round(self.w, 2), round(self.h, 2)]


@dataclass
class ElementAnnotation:
    """Normalized annotation for an element on a web page."""
    element_id: str
    raw_category: str
    privis_category: Optional[str]
    bbox: List[float]  # [x, y, w, h]
    text: str = ""
    is_fillable: bool = False
    attributes: Dict[str, Any] = field(default_factory=dict)


@dataclass
class PageSample:
    """Full sample record for a web page screenshot."""
    sample_id: str
    source_id: str
    split: str
    variant: str
    page_type: str
    company: str
    image_rel_path: Optional[str]
    width: int
    height: int
    pii_elements: List[ElementAnnotation] = field(default_factory=list)
    product_elements: List[ElementAnnotation] = field(default_factory=list)
    order_elements: List[ElementAnnotation] = field(default_factory=list)
    search_elements: List[ElementAnnotation] = field(default_factory=list)
    misc_elements: List[ElementAnnotation] = field(default_factory=list)
    summary_counts: Dict[str, int] = field(default_factory=dict)


def normalize_category(raw_cat: str) -> Optional[str]:
    """Map a raw dataset category to the PRIVIS SensitiveCategory string."""
    clean_cat = raw_cat.strip().lower().replace(" ", "_").replace("-", "_")
    if clean_cat in CATEGORY_MAP:
        return CATEGORY_MAP[clean_cat]
    for key, mapped in CATEGORY_MAP.items():
        if key in clean_cat:
            return mapped
    return None


def parse_bbox(raw_bbox: Any, img_w: int, img_h: int) -> Optional[NormalizedBoundingBox]:
    """Parse various bounding box representations into [x, y, w, h].

    Supports:
    - [x, y, w, h]
    - [x1, y1, x2, y2] / [xmin, ymin, xmax, ymax]
    - [ymin, xmin, ymax, xmax]
    - {"x": ..., "y": ..., "width": ..., "height": ...}
    - {"left": ..., "top": ..., "width": ..., "height": ...}
    - {"xmin": ..., "ymin": ..., "xmax": ..., "ymax": ...}
    """
    if raw_bbox is None:
        return None

    try:
        if isinstance(raw_bbox, dict):
            if "x" in raw_bbox and "y" in raw_bbox and "width" in raw_bbox and "height" in raw_bbox:
                x, y, w, h = float(raw_bbox["x"]), float(raw_bbox["y"]), float(raw_bbox["width"]), float(raw_bbox["height"])
            elif "left" in raw_bbox and "top" in raw_bbox and "width" in raw_bbox and "height" in raw_bbox:
                x, y, w, h = float(raw_bbox["left"]), float(raw_bbox["top"]), float(raw_bbox["width"]), float(raw_bbox["height"])
            elif "xmin" in raw_bbox and "ymin" in raw_bbox and "xmax" in raw_bbox and "ymax" in raw_bbox:
                x = float(raw_bbox["xmin"])
                y = float(raw_bbox["ymin"])
                w = float(raw_bbox["xmax"]) - x
                h = float(raw_bbox["ymax"]) - y
            else:
                return None
        elif isinstance(raw_bbox, (list, tuple)):
            if len(raw_bbox) == 4:
                # Determine if format is [x, y, w, h] or [x1, y1, x2, y2]
                v0, v1, v2, v3 = map(float, raw_bbox)
                # If normalized coordinates (0..1)
                if max(v0, v1, v2, v3) <= 1.0 and (img_w > 1 and img_h > 1):
                    v0 *= img_w
                    v1 *= img_h
                    v2 *= img_w
                    v3 *= img_h

                if v2 > v0 and v3 > v1 and v2 <= img_w + 10 and v3 <= img_h + 10:
                    # Likely [x1, y1, x2, y2]
                    x, y, w, h = v0, v1, v2 - v0, v3 - v1
                else:
                    # Likely [x, y, w, h]
                    x, y, w, h = v0, v1, v2, v3
            else:
                return None
        else:
            return None

        # Clamp to image boundaries
        x = max(0.0, min(float(img_w), x))
        y = max(0.0, min(float(img_h), y))
        w = max(0.0, min(float(img_w) - x, w))
        h = max(0.0, min(float(img_h) - y, h))

        if w <= 0 or h <= 0:
            return None

        return NormalizedBoundingBox(x=x, y=y, w=w, h=h)
    except Exception as err:
        logger.debug("Failed to parse bbox %r: %s", raw_bbox, err)
        return None


def parse_elements_json(
    raw_json_str: Any,
    img_w: int,
    img_h: int,
    prefix: str = "el",
) -> List[ElementAnnotation]:
    """Safely decode and parse JSON string into list of ElementAnnotation."""
    if not raw_json_str:
        return []

    data: Any = None
    if isinstance(raw_json_str, str):
        try:
            data = json.loads(raw_json_str)
        except json.JSONDecodeError:
            try:
                # Handle single-quoted or escaped JSON strings
                import ast
                data = ast.literal_eval(raw_json_str)
            except Exception:
                return []
    elif isinstance(raw_json_str, list):
        data = raw_json_str
    elif isinstance(raw_json_str, dict):
        data = [raw_json_str]

    if not isinstance(data, list):
        return []

    annotations: List[ElementAnnotation] = []
    for idx, item in enumerate(data):
        if not isinstance(item, dict):
            continue

        raw_cat = str(item.get("category") or item.get("type") or item.get("label") or "unknown")
        privis_cat = normalize_category(raw_cat)
        raw_box = item.get("bbox") or item.get("bounds") or item.get("rect") or item.get("box")
        bbox = parse_bbox(raw_box, img_w, img_h)

        if bbox is None:
            continue

        element_id = str(item.get("id") or item.get("element_id") or f"{prefix}_{idx}")
        text = str(item.get("text") or item.get("value") or item.get("content") or "")
        is_fillable = bool(item.get("fillable") or item.get("is_fillable") or False)

        # Retain other properties
        attrs = {k: v for k, v in item.items() if k not in ("bbox", "bounds", "rect", "box", "id", "element_id", "category", "type", "label", "text", "value")}

        annotations.append(
            ElementAnnotation(
                element_id=element_id,
                raw_category=raw_cat,
                privis_category=privis_cat,
                bbox=bbox.to_list(),
                text=text,
                is_fillable=is_fillable,
                attributes=attrs,
            )
        )

    return annotations


def extract_pil_image(image_field: Any) -> Optional[Any]:
    """Convert dataset image field to a PIL Image."""
    if image_field is None:
        return None

    try:
        from PIL import Image
        if isinstance(image_field, Image.Image):
            return image_field.convert("RGB")
        elif isinstance(image_field, bytes):
            return Image.open(io.BytesIO(image_field)).convert("RGB")
        elif isinstance(image_field, dict):
            if "bytes" in image_field and image_field["bytes"]:
                return Image.open(io.BytesIO(image_field["bytes"])).convert("RGB")
            elif "path" in image_field and image_field["path"]:
                return Image.open(image_field["path"]).convert("RGB")
    except Exception as err:
        logger.warning("Error decoding PIL image: %s", err)
    return None


def fetch_dataset(
    dataset_name: str,
    split: str,
    streaming: bool = False,
    token: Optional[str] = None,
) -> Any:
    """Load dataset from Hugging Face via the datasets library."""
    try:
        from datasets import load_dataset
    except ImportError:
        logger.error(
            "The 'datasets' package is required to import Hugging Face datasets.\n"
            "Please install it via: pip install datasets pillow tqdm"
        )
        sys.exit(1)

    hf_token = token or os.environ.get("HF_TOKEN") or os.environ.get("HUGGINGFACE_HUB_TOKEN")
    logger.info("Loading %s (split: %s, streaming: %s)...", dataset_name, split, streaming)

    try:
        ds = load_dataset(
            dataset_name,
            split=split,
            streaming=streaming,
            token=hf_token,
        )
        return ds
    except Exception as err:
        logger.error("Failed to load dataset %s: %s", dataset_name, err)
        raise


def process_split(
    ds: Any,
    split_name: str,
    images_dir: Path,
    annotations_dir: Path,
    max_samples: Optional[int] = None,
    save_images: bool = True,
    dry_run: bool = False,
) -> Tuple[Dict[str, Any], List[PageSample]]:
    """Iterate through dataset rows, process samples, write images, and generate annotations."""
    if not dry_run:
        images_dir.mkdir(parents=True, exist_ok=True)
        annotations_dir.mkdir(parents=True, exist_ok=True)

    samples: List[PageSample] = []
    category_counts: Dict[str, int] = {}
    privis_counts: Dict[str, int] = {}
    total_elements = 0

    count = 0
    for row in ds:
        count += 1
        if max_samples is not None and count > max_samples:
            break

        source_id = str(row.get("source_id", f"sample_{count:06d}"))
        variant = str(row.get("variant", "default"))
        page_type = str(row.get("page_type", "unknown"))
        company = str(row.get("company", "unknown"))
        img_w = int(row.get("image_width", 0))
        img_h = int(row.get("image_height", 0))

        # Handle image resolution if missing in metadata
        pil_img = None
        if save_images or img_w == 0 or img_h == 0:
            pil_img = extract_pil_image(row.get("image"))
            if pil_img is not None:
                img_w, img_h = pil_img.size

        # Parse PII annotations
        pii_elements = parse_elements_json(
            row.get("pii_elements_json"), img_w, img_h, prefix="pii"
        )
        prod_elements = parse_elements_json(
            row.get("product_elements_json"), img_w, img_h, prefix="prod"
        )
        order_elements = parse_elements_json(
            row.get("order_elements_json"), img_w, img_h, prefix="ord"
        )
        search_elements = parse_elements_json(
            row.get("search_elements_json"), img_w, img_h, prefix="srch"
        )
        misc_elements = parse_elements_json(
            row.get("misc_elements_json"), img_w, img_h, prefix="misc"
        )

        # Update stats
        for elem in pii_elements:
            category_counts[elem.raw_category] = category_counts.get(elem.raw_category, 0) + 1
            if elem.privis_category:
                privis_counts[elem.privis_category] = privis_counts.get(elem.privis_category, 0) + 1
            total_elements += 1

        # Save image file
        image_rel_path = None
        if save_images and pil_img is not None and not dry_run:
            clean_filename = f"{source_id}_{variant}.png".replace("/", "_").replace("\\", "_")
            out_img_path = images_dir / clean_filename
            pil_img.save(out_img_path, format="PNG")
            try:
                image_rel_path = str(out_img_path.relative_to(REPO_ROOT))
            except ValueError:
                image_rel_path = str(out_img_path)

        sample = PageSample(
            sample_id=f"{source_id}_{variant}",
            source_id=source_id,
            split=split_name,
            variant=variant,
            page_type=page_type,
            company=company,
            image_rel_path=image_rel_path,
            width=img_w,
            height=img_h,
            pii_elements=pii_elements,
            product_elements=prod_elements,
            order_elements=order_elements,
            search_elements=search_elements,
            misc_elements=misc_elements,
            summary_counts={
                "pii": len(pii_elements),
                "product": len(prod_elements),
                "order": len(order_elements),
                "search": len(search_elements),
                "misc": len(misc_elements),
            },
        )
        samples.append(sample)

        if count % 100 == 0:
            logger.info("Processed %d samples (split: %s)...", count, split_name)

    stats = {
        "dataset": HF_DATASET_NAME,
        "split": split_name,
        "total_samples": len(samples),
        "total_pii_elements": total_elements,
        "raw_category_counts": category_counts,
        "privis_category_counts": privis_counts,
        "dry_run": dry_run,
    }

    return stats, samples


def save_manifest(
    samples: List[PageSample],
    stats: Dict[str, Any],
    out_file: Path,
) -> None:
    """Save parsed samples and summary statistics to a JSON manifest file."""
    data = {
        "metadata": stats,
        "samples": {s.sample_id: asdict(s) for s in samples},
    }
    out_file.parent.mkdir(parents=True, exist_ok=True)
    with open(out_file, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)
    logger.info("Wrote annotation manifest to: %s (%d samples)", out_file, len(samples))


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Import and preprocess the WebPII dataset from Hugging Face."
    )
    parser.add_argument(
        "--dataset",
        type=str,
        default=HF_DATASET_NAME,
        help=f"Hugging Face dataset identifier (default: {HF_DATASET_NAME})",
    )
    parser.add_argument(
        "--split",
        type=str,
        choices=["train", "test", "all"],
        default="train",
        help="Dataset split to import ('train', 'test', or 'all', default: 'train')",
    )
    parser.add_argument(
        "--max-samples",
        type=int,
        default=None,
        help="Maximum number of samples to process per split (useful for testing)",
    )
    parser.add_argument(
        "--streaming",
        action="store_true",
        help="Stream dataset rows on-demand without full local caching",
    )
    parser.add_argument(
        "--no-save-images",
        action="store_true",
        help="Skip saving screenshot image files, only extract and save annotations",
    )
    parser.add_argument(
        "--images-dir",
        type=Path,
        default=DEFAULT_IMAGES_DIR,
        help=f"Output directory for screenshot images (default: {DEFAULT_IMAGES_DIR})",
    )
    parser.add_argument(
        "--annotations-dir",
        type=Path,
        default=DEFAULT_ANNOTATIONS_DIR,
        help=f"Output directory for JSON annotations (default: {DEFAULT_ANNOTATIONS_DIR})",
    )
    parser.add_argument(
        "--hf-token",
        type=str,
        default=None,
        help="Optional Hugging Face access token (or set HF_TOKEN env var)",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Perform a dry run without saving image files or annotation manifests",
    )
    parser.add_argument(
        "--verbose",
        action="store_true",
        help="Enable debug-level logging",
    )

    args = parser.parse_args()

    if args.verbose:
        logger.setLevel(logging.DEBUG)

    save_images = not args.no_save_images
    splits_to_process = ["train", "test"] if args.split == "all" else [args.split]

    logger.info("=== WebPII Dataset Importer ===")
    logger.info("Dataset: %s", args.dataset)
    logger.info("Splits: %s", splits_to_process)
    logger.info("Save images: %s", save_images)
    logger.info("Max samples: %s", args.max_samples if args.max_samples else "All")
    logger.info("Streaming mode: %s", args.streaming)
    logger.info("Dry run: %s", args.dry_run)

    all_stats: Dict[str, Any] = {}

    for split in splits_to_process:
        logger.info("\n--- Processing split: %s ---", split)
        ds = fetch_dataset(
            dataset_name=args.dataset,
            split=split,
            streaming=args.streaming,
            token=args.hf_token,
        )

        split_img_dir = args.images_dir / split
        stats, samples = process_split(
            ds=ds,
            split_name=split,
            images_dir=split_img_dir,
            annotations_dir=args.annotations_dir,
            max_samples=args.max_samples,
            save_images=save_images,
            dry_run=args.dry_run,
        )

        all_stats[split] = stats

        if not args.dry_run:
            manifest_file = args.annotations_dir / f"webpii_{split}.json"
            save_manifest(samples, stats, manifest_file)

        logger.info("Split %s summary:", split)
        logger.info("  Total samples processed: %d", stats["total_samples"])
        logger.info("  Total PII elements: %d", stats["total_pii_elements"])
        logger.info("  Mapped PRIVIS categories: %s", stats["privis_category_counts"])

    logger.info("\n=== Import complete ===")
    if args.dry_run:
        logger.info("Dry-run finished successfully. No files were written.")


if __name__ == "__main__":
    main()
