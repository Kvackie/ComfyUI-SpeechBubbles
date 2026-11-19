"""Page Overlay: pastes uploaded images (e.g. a cut-out character) onto the page where you placed them in the editor.

`overlays` JSON list, in paint order (later on top):
    file  : path under ComfyUI's input folder, e.g. "page_overlay/girl.png"
    cx, cy: centre, as a fraction of page width / height
    w, h  : size, as a fraction of page width / height
    crop  : optional outline [[u, v], ...] relative to the item's box (0-1); only the inside is kept
"""
import json
import logging
import os
import random

import numpy as np
import torch
from PIL import Image, ImageChops, ImageDraw

import folder_paths
from aiohttp import web
from server import PromptServer

from .last_ui import remember

SUBFOLDER = "page_overlay"
EXTS = (".png", ".webp", ".jpg", ".jpeg")


def overlay_dir():
    d = os.path.join(folder_paths.get_input_directory(), SUBFOLDER)
    os.makedirs(d, exist_ok=True)
    return d


@PromptServer.instance.routes.get("/page_overlay/list")
async def list_overlays(request):
    d = overlay_dir()
    files = sorted((f for f in os.listdir(d) if f.lower().endswith(EXTS)), key=lambda f: -os.path.getmtime(os.path.join(d, f)))
    return web.json_response([f"{SUBFOLDER}/{f}" for f in files])


def resolve(rel):
    base = os.path.realpath(folder_paths.get_input_directory())
    p = os.path.realpath(os.path.join(base, rel))
    return p if p.startswith(base + os.sep) and os.path.isfile(p) else None


def save_temp(img, prefix):
    name = f"{prefix}_{random.randint(0, 10**9):09d}.png"
    img.save(os.path.join(folder_paths.get_temp_directory(), name), compress_level=1)
    return {"filename": name, "subfolder": "", "type": "temp"}


class PageOverlay:
    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {
            "image": ("IMAGE",),
            "overlays": ("STRING", {"default": "[]"}),
        }, "hidden": {"unique_id": "UNIQUE_ID"}}

    RETURN_TYPES = ("IMAGE",)
    RETURN_NAMES = ("image",)
    FUNCTION = "run"
    CATEGORY = "image/comic"

    def run(self, image, overlays, unique_id=None):
        try:
            items = json.loads(overlays or "[]")
        except json.JSONDecodeError:
            raise ValueError("Page Overlay: the overlay data is broken; open the editor and save again.")
        cache = {}
        out, bg, preview = [], None, None
        for i, t in enumerate(image):
            page = Image.fromarray(np.clip(t.cpu().numpy() * 255.0, 0, 255).astype(np.uint8)).convert("RGB")
            if i == 0:
                bg = save_temp(page, "pageoverlay_bg")
            draw_overlays(page, items, cache)
            if i == 0:
                preview = save_temp(page, "pageoverlay_out")
            out.append(torch.from_numpy(np.asarray(page).astype(np.float32) / 255.0))
        remember("po", unique_id, bg)
        return {"ui": {"overlay_bg": [bg], "images": [preview]}, "result": (torch.stack(out),)}


def draw_overlays(page, items, cache):
    """Pastes the overlays onto `page` (RGB PIL image) in place."""
    W, H = page.size
    for it in items:
        path = resolve(it.get("file", ""))
        if not path:
            logging.warning(f"Page Overlay: missing file {it.get('file')!r}, skipped")
            continue
        if path not in cache:
            cache[path] = Image.open(path).convert("RGBA")
        w, h = max(1, round(it["w"] * W)), max(1, round(it["h"] * H))
        layer = cache[path].resize((w, h), Image.LANCZOS)
        crop = it.get("crop")
        if isinstance(crop, list) and len(crop) >= 3:  # keep only the outlined area
            m = Image.new("L", (w * 2, h * 2), 0)
            ImageDraw.Draw(m).polygon([(u * w * 2, v * h * 2) for u, v in crop], fill=255)
            layer.putalpha(ImageChops.multiply(layer.getchannel("A"), m.resize((w, h), Image.LANCZOS)))
        page.paste(layer, (round(it["cx"] * W - w / 2), round(it["cy"] * H - h / 2)), layer)
