"""One-off: draw the app icons. Run with the backend venv: ../.venv/bin/python scripts/make_icons.py"""
from pathlib import Path

from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parent.parent / "public" / "icons"
ACCENT, PAPER = (47, 93, 80), (250, 247, 242)


def draw(size: int) -> Image.Image:
    img = Image.new("RGB", (size, size), ACCENT)
    d = ImageDraw.Draw(img)
    u = size / 100
    line = max(2, round(4 * u))
    top, left, right = (50 * u, 26 * u), (28 * u, 70 * u), (72 * u, 70 * u)
    d.line([top, (50 * u, 48 * u)], fill=PAPER, width=line)
    d.line([(28 * u, 48 * u), (72 * u, 48 * u)], fill=PAPER, width=line)
    d.line([(28 * u, 48 * u), left], fill=PAPER, width=line)
    d.line([(72 * u, 48 * u), right], fill=PAPER, width=line)
    for x, y, r in ((50, 24, 9), (28, 72, 9), (72, 72, 9)):
        d.ellipse(((x - r) * u, (y - r) * u, (x + r) * u, (y + r) * u), fill=PAPER)
    return img


OUT.mkdir(parents=True, exist_ok=True)
for s in (192, 512):
    draw(s).save(OUT / f"icon-{s}.png")
