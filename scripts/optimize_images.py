#!/usr/bin/env python3
"""
Resize photos in media/images/ and write web-ready WebP + JPEG to media/images/web/.
Preserves aspect ratio; longest edge capped at MAX_EDGE. Skips subfolders and non-images.
"""

from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image, ImageOps

MAX_EDGE = 1920
WEBP_QUALITY = 85
JPEG_QUALITY = 85
JPEG_SUBSAMPLING = 1  # 4:2:0

SOURCE_DIR = Path(__file__).resolve().parent.parent / "media" / "images"
OUT_DIR = SOURCE_DIR / "web"
EXTS = {".png", ".jpg", ".jpeg", ".webp"}


def fit_max_edge(im: Image.Image, max_edge: int) -> Image.Image:
    im = ImageOps.exif_transpose(im)
    w, h = im.size
    longest = max(w, h)
    if longest <= max_edge:
        return im
    scale = max_edge / longest
    nw = max(1, int(round(w * scale)))
    nh = max(1, int(round(h * scale)))
    return im.resize((nw, nh), Image.Resampling.LANCZOS)


def to_rgb_no_alpha(im: Image.Image) -> Image.Image:
    if im.mode in ("RGBA", "LA"):
        bg = Image.new("RGB", im.size, (255, 255, 255))
        bg.paste(im, mask=im.split()[-1])
        return bg
    if im.mode != "RGB":
        return im.convert("RGB")
    return im


def main() -> int:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    files = sorted(
        p
        for p in SOURCE_DIR.iterdir()
        if p.is_file() and p.suffix.lower() in EXTS and p.parent == SOURCE_DIR
    )
    if not files:
        print(f"No images found in {SOURCE_DIR}", file=sys.stderr)
        return 1

    for path in files:
        stem = path.stem
        try:
            with Image.open(path) as im:
                fitted = fit_max_edge(im, MAX_EDGE)
                webp_path = OUT_DIR / f"{stem}.webp"
                jpeg_path = OUT_DIR / f"{stem}.jpg"
                fitted.save(
                    webp_path,
                    "WEBP",
                    quality=WEBP_QUALITY,
                    method=6,
                )
                rgb = to_rgb_no_alpha(fitted)
                rgb.save(
                    jpeg_path,
                    "JPEG",
                    quality=JPEG_QUALITY,
                    optimize=True,
                    progressive=True,
                    subsampling=JPEG_SUBSAMPLING,
                )
            print(f"OK {path.name} -> {webp_path.name}, {jpeg_path.name}")
        except OSError as e:
            print(f"SKIP {path.name}: {e}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
