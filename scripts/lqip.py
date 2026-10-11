#!/usr/bin/env python3
"""Writes a small, slightly blurred WebP placeholder next to each image.

The frontend shows the placeholder scaled up while the full image loads.

Usage: lqip.py PATH [PATH...]
  PATH is an image or a directory of images; each <name>.png|jpg|jpeg|webp
  gets <name>.blur.webp beside it. Needs Pillow (task install:images).
"""
import os
import sys

from PIL import Image, ImageFilter

# Long edge per image kind, about a third to a quarter of how wide the page
# shows it, so the upscaled preview stays soft but recognisable. The kind is
# the file name or its last "-" part, e.g. "poster" or "default-poster".
LONG_EDGE = {"icon": 96, "card": 240, "poster": 400, "background": 400}
DEFAULT_LONG_EDGE = 240
BLUR = 0.8  # Gaussian radius at placeholder size; hides blockiness when upscaled
QUALITY = 75
EXTENSIONS = (".png", ".jpg", ".jpeg", ".webp")


def placeholder(path):
    stem, _ = os.path.splitext(path)
    src = Image.open(path)
    src = src.convert("RGBA" if "A" in src.getbands() or "transparency" in src.info else "RGB")
    kind = os.path.basename(stem).rsplit("-", 1)[-1]
    scale = LONG_EDGE.get(kind, DEFAULT_LONG_EDGE) / max(src.size)
    size = (max(1, round(src.width * scale)), max(1, round(src.height * scale)))
    small = src.resize(size, Image.LANCZOS).filter(ImageFilter.GaussianBlur(BLUR))
    out = f"{stem}.blur.webp"
    small.save(out, "WEBP", quality=QUALITY, method=6)
    print(f"{out}: {size[0]}x{size[1]}, {os.path.getsize(out) / 1024:.1f} KB")


def images(path):
    names = sorted(os.listdir(path)) if os.path.isdir(path) else [None]
    for name in names:
        file = os.path.join(path, name) if name else path
        stem, ext = os.path.splitext(file)
        if ext.lower() in EXTENSIONS and not stem.endswith(".blur"):
            yield file


def main(paths):
    if not paths:
        sys.exit(__doc__.strip())
    found = False
    for path in paths:
        for file in images(path):
            found = True
            placeholder(file)
    if not found:
        sys.exit("no images found in: " + " ".join(paths))


if __name__ == "__main__":
    main(sys.argv[1:])
