import json
import os
import random

import numpy as np
import torch
from PIL import Image

import folder_paths
from aiohttp import web
from server import PromptServer

from .bubbles import draw_bubble

FONT_DIRS = [os.path.join(os.path.dirname(__file__), "fonts"), os.path.join(os.environ.get("WINDIR", r"C:\Windows"), "Fonts")]


def list_fonts():
    fonts = {}
    for d in FONT_DIRS:
        if os.path.isdir(d):
            for f in sorted(os.listdir(d)):
                if f.lower().endswith((".ttf", ".otf")) and f not in fonts:
                    fonts[f] = os.path.join(d, f)
    return fonts


FONTS = list_fonts()
# CC Wild Words (the usual manga lettering font) when it's installed, under whatever file name it came with
_WILD = sorted((f for f in FONTS if "wildwords" in f.lower().replace(" ", "").replace("_", "").replace("-", "")),
               key=lambda f: (any(k in f.lower() for k in ("bold", "italic", "lower")), f))
DEFAULT_FONT = next(iter(_WILD), None) or next((f for f in ("comicbd.ttf", "arialbd.ttf", "arial.ttf") if f in FONTS), next(iter(FONTS), ""))


LAST = {}  # node id -> the page it last received, so the editor opens on it even after a cached run


@PromptServer.instance.routes.get("/speech_bubbles/last/{uid}")
async def get_last(request):
    data = LAST.get(request.match_info["uid"])
    return web.json_response(data) if data is not None else web.Response(status=404)


@PromptServer.instance.routes.get("/speech_bubbles/font/{name}")
async def get_font(request):
    path = FONTS.get(request.match_info["name"])
    if not path:
        return web.Response(status=404)
    return web.FileResponse(path, headers={"Cache-Control": "max-age=3600"})


def save_temp(img, prefix):
    name = f"{prefix}_{random.randint(0, 10**9):09d}.png"
    img.save(os.path.join(folder_paths.get_temp_directory(), name), compress_level=1)
    return {"filename": name, "subfolder": "", "type": "temp"}


class SpeechBubbles:
    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {
            "image": ("IMAGE",),
            "font": (list(FONTS) or [""], {"default": DEFAULT_FONT}),
            "bubbles": ("STRING", {"default": "[]"}),
        }, "hidden": {"unique_id": "UNIQUE_ID"}}

    RETURN_TYPES = ("IMAGE",)
    RETURN_NAMES = ("image",)
    FUNCTION = "run"
    CATEGORY = "image/text"

    def run(self, image, font, bubbles, unique_id=None):
        try:
            items = json.loads(bubbles or "[]")
        except json.JSONDecodeError:
            raise ValueError("Speech Bubbles: the bubble data is broken; open the editor and save again.")
        font_path = FONTS.get(font) or FONTS.get(DEFAULT_FONT)
        if not font_path:
            raise ValueError("Speech Bubbles: no fonts found; put a .ttf or .otf file in the node's fonts folder.")
        out, bg, preview = [], None, None
        for i, t in enumerate(image):
            page = Image.fromarray(np.clip(t.cpu().numpy() * 255.0, 0, 255).astype(np.uint8)).convert("RGB")
            if i == 0:
                bg = save_temp(page, "speechbubbles_bg")
            for b in items:
                draw_bubble(page, b, FONTS.get(b.get("font")) or font_path)
            if i == 0:
                preview = save_temp(page, "speechbubbles_out")
            out.append(torch.from_numpy(np.asarray(page).astype(np.float32) / 255.0))
        if unique_id is not None:
            LAST[str(unique_id)] = bg
        return {"ui": {"bubble_bg": [bg], "images": [preview]}, "result": (torch.stack(out),)}


NODE_CLASS_MAPPINGS = {"SpeechBubbles": SpeechBubbles}
NODE_DISPLAY_NAME_MAPPINGS = {"SpeechBubbles": "Speech Bubbles"}
WEB_DIRECTORY = "web"
__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "WEB_DIRECTORY"]
