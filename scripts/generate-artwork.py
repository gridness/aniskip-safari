#!/usr/bin/env python3
"""Bundle Anime365's official assets; Pillow is only needed to refresh icon sizes."""
from pathlib import Path
import json
import shutil
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]


source = Image.open(ROOT / "Branding/anime365.png").convert("RGBA")


def icon(size, destination):
    source.resize((size, size), Image.Resampling.LANCZOS).save(destination)


web = ROOT / "Extension/Resources/icons"
web.mkdir(parents=True, exist_ok=True)
for size in (48, 96, 128):
    icon(size, web / f"icon-{size}.png")
shutil.copyfile(ROOT / "Branding/anime365-logo.png", web / "anime365-logo.png")
assets = ROOT / "App/Assets.xcassets"
app = assets / "AppIcon.appiconset"
app.mkdir(parents=True, exist_ok=True)
(assets / "Contents.json").write_text(json.dumps({"info": {"author": "xcode", "version": 1}}, indent=2) + "\n")
images = []
for size in (16, 32, 128, 256, 512):
    for scale in (1, 2):
        filename = f"icon-{size}@{scale}x.png"
        icon(size * scale, app / filename)
        images.append({"idiom": "mac", "size": f"{size}x{size}", "scale": f"{scale}x", "filename": filename})
(app / "Contents.json").write_text(json.dumps({"images": images, "info": {"author": "xcode", "version": 1}}, indent=2) + "\n")
logo = assets / "Anime365Logo.imageset"
logo.mkdir(exist_ok=True)
shutil.copyfile(ROOT / "Branding/anime365-logo.png", logo / "anime365-logo.png")
(logo / "Contents.json").write_text(json.dumps({"images": [{"idiom": "universal", "filename": "anime365-logo.png", "scale": "2x"}], "info": {"author": "xcode", "version": 1}}, indent=2) + "\n")
print("Bundled official Anime365 logo and icon representations")
