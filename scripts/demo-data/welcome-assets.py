#!/usr/bin/env python3
"""Crop and convert the shots from shots.mjs into the welcome page's images.

    python3 scripts/demo-data/welcome-assets.py <shots-dir> [out-dir]

out-dir defaults to apps/web/public/screenshots/welcome. Needs Pillow with WebP support.
Boxes are in CSS pixels of the shot's viewport (1440 px wide on desktop, 390 px for the
phone); the shot's device pixel ratio is read from its width.
"""

import sys
from pathlib import Path

from PIL import Image

DESKTOP_WIDTH = 1600
PHONE_WIDTH = 600

# (output name, source shot, viewport width, (left, top, right, bottom) in CSS px, max output width)
ASSETS = [
    # Sidebar and the "Activity" row cut away; stops above the footer and devtools button.
    ('dashboard', 'dashboard', 1440, (256, 16, 1424, 740), DESKTOP_WIDTH),
    ('timeline-day', 'timeline-day', 1440, (248, 0, 1432, 815), DESKTOP_WIDTH),
    # From the trigger row down: the presets above are personal and must not show (#1474).
    ('correlations', 'correlations-alcohol', 1440, (262, 216, 1418, 836), DESKTOP_WIDTH),
    ('challenge', 'challenge', 1440, (252, 16, 1428, 830), DESKTOP_WIDTH),
    ('feed-post', 'feed-own', 1440, (490, 278, 1190, 830), 1000),
    ('places', 'places', 1440, (250, 60, 1430, 832), DESKTOP_WIDTH),
    ('timeline-mobile', 'timeline-mobile', 390, (0, 0, 390, 582), PHONE_WIDTH),
]

THEMES = ['light', 'dark']


def build(shots: Path, out: Path) -> None:
    out.mkdir(parents=True, exist_ok=True)
    total = 0
    for name, source, viewport_width, box, max_width in ASSETS:
        for theme in THEMES:
            image = Image.open(shots / f'{source}-{theme}.png').convert('RGB')
            scale = image.width / viewport_width
            image = image.crop(tuple(round(v * scale) for v in box))
            if image.width > max_width:
                height = round(image.height * max_width / image.width)
                image = image.resize((max_width, height), Image.LANCZOS)
            target = out / f'{name}-{theme}.webp'
            image.save(target, 'WEBP', quality=80, method=6)
            size = target.stat().st_size
            total += size
            print(f'{target} {image.width}x{image.height} {size // 1024} KiB')
    print(f'total {total // 1024} KiB')


if __name__ == '__main__':
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    repo = Path(__file__).resolve().parents[2]
    default_out = repo / 'apps' / 'web' / 'public' / 'screenshots' / 'welcome'
    build(Path(sys.argv[1]), Path(sys.argv[2]) if len(sys.argv) > 2 else default_out)
