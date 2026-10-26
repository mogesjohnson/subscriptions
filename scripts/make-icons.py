#!/usr/bin/env python3
"""Draw the app icons (192 and 512 px PNG) with Pillow. Run: python3 scripts/make-icons.py"""
from pathlib import Path

from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parent.parent / "icons"
BG = (79, 70, 229)  # --accent
FG = (255, 255, 255)


def icon(size: int) -> Image.Image:
    img = Image.new("RGB", (size, size), BG)
    d = ImageDraw.Draw(img)
    u = size / 16
    # A calendar card inside the maskable safe zone (centre 80%).
    d.rounded_rectangle([4 * u, 4.5 * u, 12 * u, 12 * u], radius=u, fill=FG)
    d.rectangle([4 * u, 6.2 * u, 12 * u, 6.6 * u], fill=BG)
    for x in (6 * u, 10 * u):
        d.rounded_rectangle([x - 0.35 * u, 3.6 * u, x + 0.35 * u, 5.2 * u], radius=0.3 * u, fill=FG)
    # A check mark for "renewal tracked".
    d.line([(5.8 * u, 9.2 * u), (7.4 * u, 10.6 * u), (10.4 * u, 7.6 * u)], fill=BG, width=max(2, round(0.8 * u)), joint="curve")
    return img


if __name__ == "__main__":
    OUT.mkdir(exist_ok=True)
    for size in (192, 512):
        icon(size).save(OUT / f"icon-{size}.png", optimize=True)
        print(f"icons/icon-{size}.png")
