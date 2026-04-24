"""Remove solid white background from a logo WebP; save web-optimized transparent WebP (Pillow only)."""
from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image

SOFTNESS = 52.0
WEBP_QUALITY = 88


def main() -> int:
    src = Path(sys.argv[1]) if len(sys.argv) > 1 else None
    dst = Path(sys.argv[2]) if len(sys.argv) > 2 else None
    if not src or not dst:
        print("usage: remove_white_bg_webp.py <input.webp> <output.webp>", file=sys.stderr)
        return 2

    im = Image.open(src).convert("RGBA")
    w, h = im.size
    src_px = im.load()
    out = Image.new("RGBA", (w, h))
    dst_px = out.load()
    for y in range(h):
        for x in range(w):
            r, g, b, a = src_px[x, y]
            d = ((255 - r) ** 2 + (255 - g) ** 2 + (255 - b) ** 2) ** 0.5
            a_f = min(a / 255.0, min(1.0, d / SOFTNESS))
            dst_px[x, y] = (r, g, b, int(round(a_f * 255.0)))

    dst.parent.mkdir(parents=True, exist_ok=True)
    out.save(dst, format="WEBP", quality=WEBP_QUALITY, method=6, lossless=False)
    print(f"wrote {dst} ({dst.stat().st_size} bytes)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
