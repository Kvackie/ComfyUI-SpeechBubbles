"""Draws the editor's bubbles, effect icons and sound effects onto a page (data format: README, "Bubble data").

The geometry here is mirrored in web/speech_bubbles.js; keep both in step.
"""
import math

from PIL import Image, ImageDraw, ImageFont

SS = 3  # supersampling for smooth edges
TEXT_WIDTH = {"speech": 0.72, "thought": 0.66, "shout": 0.56}
LINE_HEIGHT = 1.18
BASELINE = 0.86


def stroke_px(h):
    return max(2, round(h * 0.0022))


def layer_box(xs, ys, pad):
    """Whole-pixel box (x0, y0, x1, y1) around the points, grown by pad."""
    return math.floor(min(xs) - pad), math.floor(min(ys) - pad), math.ceil(max(xs) + pad), math.ceil(max(ys) + pad)


def ss_layer(x0, y0, x1, y1):
    """A transparent layer for the box, SS times larger for smooth edges."""
    return Image.new("RGBA", ((x1 - x0) * SS, (y1 - y0) * SS), (0, 0, 0, 0))


def paste_layer(page, layer, x0, y0, size=None):
    """Pastes an RGBA layer onto the page at (x0, y0); size shrinks a supersampled layer first."""
    if size:
        layer = layer.resize(size, Image.LANCZOS)
    page.paste(layer.convert("RGB"), (x0, y0), layer.getchannel("A"))


def heart_points(cx, cy, fs):
    """The heart outline for a letter of font size fs, centred on (cx, cy)."""
    return [(cx + u * 0.8 * fs, cy + v * 0.8 * fs) for u, v in HEART]


class Rng:
    """Park-Miller; same sequence as the editor."""

    def __init__(self, seed):
        self.s = int(seed) % 2147483646 + 1

    def next(self):
        self.s = self.s * 16807 % 2147483647
        return (self.s - 1) / 2147483646


def geometry(b, w, h):
    """Returns (circles, polygons) in page pixels. circles: (cx, cy, rx, ry)."""
    cx, cy, rx, ry = b["cx"] * w, b["cy"] * h, max(4.0, b["rx"] * w), max(4.0, b["ry"] * h)
    tx, ty = b["tx"] * w, b["ty"] * h
    ux, uy = (tx - cx) / rx, (ty - cy) / ry
    has_tail = ux * ux + uy * uy > 1.1
    a = math.atan2(uy, ux)
    kind = b.get("type", "speech")
    circles, polys = [], []
    if kind == "thought":
        avg = (rx + ry) / 2
        rb = 0.22 * avg
        circles.append((cx, cy, rx * 0.85, ry * 0.85))
        k = max(9, round(2 * math.pi * 0.85 * avg / (1.3 * rb)))
        for i in range(k):
            t = 2 * math.pi * i / k
            circles.append((cx + rx * 0.85 * math.cos(t), cy + ry * 0.85 * math.sin(t), rb, rb))
        if has_tail:
            ex, ey = cx + rx * math.cos(a), cy + ry * math.sin(a)
            for f, r in ((0.25, 0.5), (0.55, 0.35), (0.85, 0.22)):
                circles.append((ex + (tx - ex) * f, ey + (ty - ey) * f, rb * r, rb * r))
    elif kind == "shout":
        rng = Rng(b.get("seed", 1))
        n = 14
        pts = []
        for i in range(2 * n):
            t = 2 * math.pi * i / (2 * n) + (rng.next() - 0.5) * 0.12
            f = 1.0 + (rng.next() - 0.5) * 0.14 if i % 2 == 0 else 0.72
            pts.append((cx + rx * f * math.cos(t), cy + ry * f * math.sin(t)))
        polys.append(pts)
        if has_tail:
            polys.append([(cx + rx * 0.66 * math.cos(a - 0.12), cy + ry * 0.66 * math.sin(a - 0.12)), (tx, ty),
                          (cx + rx * 0.66 * math.cos(a + 0.12), cy + ry * 0.66 * math.sin(a + 0.12))])
    else:
        circles.append((cx, cy, rx, ry))
        if has_tail:
            polys.append([(cx + rx * 0.8 * math.cos(a - 0.2), cy + ry * 0.8 * math.sin(a - 0.2)), (tx, ty),
                          (cx + rx * 0.8 * math.cos(a + 0.2), cy + ry * 0.8 * math.sin(a + 0.2))])
    return circles, polys


def wrap(text, measure, max_w):
    lines = []
    for para in str(text).split("\n"):
        line = ""
        for word in para.split():
            test = f"{line} {word}" if line else word
            if line and measure(test) > max_w:
                lines.append(line)
                line = word
            else:
                line = test
        lines.append(line)
    return lines


def catmull(pts, n=12):
    """Closed Catmull-Rom curve through pts, sampled n points per segment."""
    out, k = [], len(pts)
    for i in range(k):
        p0, p1, p2, p3 = pts[i - 1], pts[i], pts[(i + 1) % k], pts[(i + 2) % k]
        for j in range(n):
            t = j / n
            t2, t3 = t * t, t * t * t
            out.append(tuple(0.5 * (2 * p1[c] + (-p0[c] + p2[c]) * t + (2 * p0[c] - 5 * p1[c] + 4 * p2[c] - p3[c]) * t2
                                    + (-p0[c] + 3 * p1[c] - 3 * p2[c] + p3[c]) * t3) for c in (0, 1)))
    return out


def custom_outline(b, w, h):
    pts = [(x * w, y * h) for x, y in b.get("pts", [])]
    return catmull(pts) if b.get("smooth", True) and len(pts) >= 3 else pts


def centroid(poly):
    a = cx = cy = 0.0
    for i in range(len(poly)):
        x0, y0 = poly[i - 1]
        x1, y1 = poly[i]
        c = x0 * y1 - x1 * y0
        a += c
        cx += (x0 + x1) * c
        cy += (y0 + y1) * c
    if abs(a) < 1e-9:
        return sum(p[0] for p in poly) / len(poly), sum(p[1] for p in poly) / len(poly)
    return cx / (3 * a), cy / (3 * a)


def rot_about(p, c, a):
    cs, sn = math.cos(a), math.sin(a)
    dx, dy = p[0] - c[0], p[1] - c[1]
    return (c[0] + dx * cs - dy * sn, c[1] + dx * sn + dy * cs)


def pivot_of(b, w, h):
    """Page-pixel point a normal / custom bubble turns around."""
    if b.get("type") == "custom":
        out = custom_outline(b, w, h)
        return centroid(out) if len(out) >= 3 else (0.0, 0.0)
    return (b["cx"] * w, b["cy"] * h)


def unturned(b, w, h):
    """The bubble before its turn: tail tip / custom points turned back by -rot (page fractions)."""
    a = float(b.get("rot", 0) or 0)
    if not a:
        return b
    c, u = pivot_of(b, w, h), dict(b)

    def back(p):
        x, y = rot_about((p[0] * w, p[1] * h), c, -a)
        return [x / w, y / h]

    if b.get("type") == "custom":
        u["pts"] = [back(p) for p in b.get("pts", [])]
    else:
        u["tx"], u["ty"] = back((b["tx"], b["ty"]))
    return u


# ---------------------------------------------------------------- hearts in bubble text
HEART_ADV = 0.9  # heart width, as a fraction of the font size


def heart_tokens(text, mode="outline"):
    """Characters, with hearts as None: [(char | None, None | "outline" | "fill")].
    <3 follows `mode`, ♡ is always outlined, ♥ always filled."""
    out, i = [], 0
    while i < len(text):
        if text.startswith("<3", i):
            out.append((None, "fill" if mode == "fill" else "outline"))
            i += 2
        else:
            ch = text[i]
            out.append((None, "outline") if ch == "♡" else (None, "fill") if ch == "♥" else (ch, None))
            i += 1
    return out


def text_runs(line, mode):
    """Splits a line into text runs and hearts: [(str, None) | (None, "outline" | "fill")]."""
    out = []
    for ch, kind in heart_tokens(line, mode):
        if kind:
            out.append((None, kind))
        elif out and out[-1][1] is None:
            out[-1] = (out[-1][0] + ch, None)
        else:
            out.append((ch, None))
    return out


def has_hearts(line):
    return "<3" in line or "♡" in line or "♥" in line


def line_width(line, mode, measure, fs):
    return sum(HEART_ADV * fs if t is None else measure(t) for t, _ in text_runs(line, mode))


def draw_bubble(page, b, font_path):
    """Draws one bubble onto `page` (RGB PIL image) in place."""
    if b.get("type") == "sfx":
        return draw_sfx(page, b, font_path)
    if b.get("type") == "icon":
        return draw_deco(page, b, b)
    w, h = page.size
    rot = float(b.get("rot", 0) or 0)
    pivot = pivot_of(b, w, h) if rot else None
    b = unturned(b, w, h)  # drawn level, then the whole layer is turned
    s = stroke_px(h)
    if b.get("type") == "custom":
        outline = custom_outline(b, w, h)
        if len(outline) < 3:
            return
        circles, polys = [], [outline]
        tcx, tcy = centroid(outline)
        text_w = 0.7 * (max(p[0] for p in outline) - min(p[0] for p in outline))
    else:
        circles, polys = geometry(b, w, h)
        tcx, tcy = b["cx"] * w, b["cy"] * h
        text_w = 2 * b["rx"] * w * TEXT_WIDTH.get(b.get("type", "speech"), 0.72)
    xs = [c[0] - c[2] for c in circles] + [c[0] + c[2] for c in circles] + [p[0] for poly in polys for p in poly]
    ys = [c[1] - c[3] for c in circles] + [c[1] + c[3] for c in circles] + [p[1] for poly in polys for p in poly]
    x0, y0, x1, y1 = layer_box(xs, ys, 2 * s + 4)
    if rot:  # a square around the pivot that holds the bubble at any angle
        R = math.ceil(max(math.dist(pivot, (x, y)) for x in (x0, x1) for y in (y0, y1))) + 2
        x0, y0 = math.floor(pivot[0]) - R, math.floor(pivot[1]) - R
        x1, y1 = x0 + 2 * R + 2, y0 + 2 * R + 2
    layer = ss_layer(x0, y0, x1, y1)
    d = ImageDraw.Draw(layer)

    def P(x, y):
        return ((x - x0) * SS, (y - y0) * SS)

    black, white = (0, 0, 0, 255), (255, 255, 255, 255)
    for grow, col in ((s, black), (0, white)):
        for cx, cy, rx, ry in circles:
            a, c = P(cx - rx - grow, cy - ry - grow), P(cx + rx + grow, cy + ry + grow)
            d.ellipse([a, c], fill=col)
        for poly in polys:
            pts = [P(x, y) for x, y in poly]
            d.polygon(pts, fill=col)
            if grow:
                d.line(pts + [pts[0]], fill=col, width=2 * s * SS, joint="curve")
                for x, y in pts:  # round the corners the line joint misses
                    r = s * SS
                    d.ellipse([x - r, y - r, x + r, y + r], fill=col)

    fs = max(4.0, b.get("size", 0.018) * h)
    font = ImageFont.truetype(font_path, max(4, round(fs * SS)))
    mode = b.get("heart", "outline")
    measure = lambda t: font.getlength(t) / SS
    lines = b.get("lines")
    if not isinstance(lines, list):
        lines = wrap(b.get("text", ""), lambda t: line_width(t, mode, measure, fs), text_w)
    lh = LINE_HEIGHT * fs
    top = tcy - len(lines) * lh / 2
    for i, line in enumerate(lines):
        if not line:
            continue
        base = top + i * lh + BASELINE * fs
        if not has_hearts(line):
            d.text(P(tcx, base), line, font=font, fill=black, anchor="ms")
            continue
        x = tcx - line_width(line, mode, measure, fs) / 2
        for t, kind in text_runs(line, mode):
            if t is not None:
                d.text(P(x, base), t, font=font, fill=black, anchor="ls")
                x += measure(t)
                continue
            q = [P(*p) for p in heart_points(x + HEART_ADV * fs / 2, base - 0.35 * fs, fs)]
            if kind == "fill":
                d.polygon(q, fill=black)
            else:
                d.line(q + [q[0]], fill=black, width=max(1, round(0.09 * fs * SS)), joint="curve")
            x += HEART_ADV * fs

    if rot:
        layer = layer.rotate(-math.degrees(rot), resample=Image.BICUBIC, center=P(*pivot))
    paste_layer(page, layer, x0, y0, (x1 - x0, y1 - y0))


# ---------------------------------------------------------------- sound effects
SFX_STRIPS = 48


def edge_at(pts, f):
    """Point at fraction f of a polyline's length."""
    seg = [math.dist(pts[i], pts[i + 1]) for i in range(len(pts) - 1)]
    total = sum(seg) or 1.0
    d = f * total
    for i, L in enumerate(seg):
        if d <= L or i == len(seg) - 1:
            t = 0.0 if L == 0 else min(1.0, d / L)
            return (pts[i][0] + (pts[i + 1][0] - pts[i][0]) * t, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * t)
        d -= L
    return pts[-1]


def sfx_triangles(top, bottom, tw, th):
    """(source triangle, destination triangle) pairs mapping the flat text image onto the box."""
    tris = []
    for k in range(SFX_STRIPS):
        u0, u1 = k / SFX_STRIPS, (k + 1) / SFX_STRIPS
        t0, t1, b0, b1 = edge_at(top, u0), edge_at(top, u1), edge_at(bottom, u0), edge_at(bottom, u1)
        s00, s10, s11, s01 = (u0 * tw, 0), (u1 * tw, 0), (u1 * tw, th), (u0 * tw, th)
        tris.append(((s00, s10, s11), (t0, t1, b1)))
        tris.append(((s00, s11, s01), (t0, b1, b0)))
    return tris


def hex_rgba(c, default):
    try:
        c = (c or default).lstrip("#")
        return tuple(int(c[i:i + 2], 16) for i in (0, 2, 4)) + (255,)
    except ValueError:
        return hex_rgba(default, "#000000")


# ---------------------------------------------------------------- effect shapes
# Unit shapes, about 1 tall and centred on (0, 0). Mirrored in web/speech_bubbles.js.
def _centre(pts):
    xs, ys = [p[0] for p in pts], [p[1] for p in pts]
    cx, cy, hgt = (min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2, (max(ys) - min(ys)) or 1
    return [((x - cx) / hgt, (y - cy) / hgt) for x, y in pts]


def heart_shape(n=48):
    pts = []
    for i in range(n):
        t = 2 * math.pi * i / n
        pts.append((16 * math.sin(t) ** 3, -(13 * math.cos(t) - 5 * math.cos(2 * t) - 2 * math.cos(3 * t) - math.cos(4 * t))))
    return _centre(pts)


HEART = heart_shape()


def deco_shapes(kind):
    """(filled polygons, stroked polylines, stroke width) for a decoration, in unit size."""
    if kind == "heart":
        return [heart_shape()], [], 0.0
    if kind == "sparkle":
        return [[(math.cos(k * math.pi / 4 - math.pi / 2) * (0.5 if k % 2 == 0 else 0.13),
                  math.sin(k * math.pi / 4 - math.pi / 2) * (0.5 if k % 2 == 0 else 0.13)) for k in range(8)]], [], 0.0
    if kind == "sweat":
        drop = [(0.32 * math.cos(math.pi * i / 16), 0.15 + 0.32 * math.sin(math.pi * i / 16)) for i in range(17)] + [(0.0, -0.5)]
        return [drop], [], 0.0
    if kind == "steam":
        lines = [[(j * 0.28 + 0.08 * math.sin(v / 16 * 2 * math.pi * 1.5), 0.5 - v / 16) for v in range(17)] for j in (-1, 0, 1)]
        return [], lines, 0.07
    if kind == "tremble":
        arcs = [[(-0.4 + r * math.cos(-0.55 + 1.1 * i / 10), r * math.sin(-0.55 + 1.1 * i / 10)) for i in range(11)] for r in (0.25, 0.42, 0.59)]
        return [], arcs, 0.06
    if kind == "note":  # ♪
        head = [(-0.14 + 0.2 * math.cos(t) * math.cos(-0.4) - 0.13 * math.sin(t) * math.sin(-0.4),
                 0.32 + 0.2 * math.cos(t) * math.sin(-0.4) + 0.13 * math.sin(t) * math.cos(-0.4)) for t in (2 * math.pi * i / 24 for i in range(24))]
        return [head], [[(0.04, 0.28), (0.04, -0.48)], [(0.04, -0.48), (0.2, -0.36), (0.3, -0.2), (0.26, -0.04)]], 0.08
    if kind == "puff":  # breath cloud
        return [[((0.5 + 0.06 * math.cos(6 * t)) * math.cos(t), (0.3 + 0.05 * math.cos(6 * t)) * math.sin(t))
                 for t in (2 * math.pi * i / 72 for i in range(72))]], [], 0.0
    if kind == "blush":  # diagonal hatching
        return [], [[(-0.5 + 0.22 * k, 0.25), (-0.36 + 0.22 * k, -0.25)] for k in range(5)], 0.07
    if kind == "throb":  # pulse arcs on both sides
        arcs = []
        for r in (0.3, 0.46):
            arcs.append([(r * math.cos(math.pi - 0.5 + i / 10), r * math.sin(math.pi - 0.5 + i / 10)) for i in range(11)])
            arcs.append([(r * math.cos(-0.5 + i / 10), r * math.sin(-0.5 + i / 10)) for i in range(11)])
        return [], arcs, 0.06
    if kind == "vein":  # anger mark: four corner arcs
        arcs = []
        for sx, sy in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
            a0 = math.atan2(-sy, -sx)
            arcs.append([(sx * 0.48 + 0.34 * math.cos(a0 - 0.75 + 1.5 * i / 10), sy * 0.48 + 0.34 * math.sin(a0 - 0.75 + 1.5 * i / 10)) for i in range(11)])
        return [], arcs, 0.1
    if kind == "droplets":  # a spray of drops
        drop = deco_shapes("sweat")[0][0]
        out = []
        for k, a, dx, dy in ((0.55, -0.5, -0.24, 0.12), (0.45, 0.35, 0.24, 0.06), (0.32, -0.1, -0.02, -0.3), (0.24, 0.7, 0.36, -0.3)):
            c, s = math.cos(a), math.sin(a)
            out.append([(dx + k * (u * c - v * s), dy + k * (u * s + v * c)) for u, v in drop])
        return out, [], 0.0
    if kind == "spurt":  # burst lines fanning upwards
        lines = []
        for i, L in enumerate((0.42, 0.5, 0.36, 0.52, 0.4, 0.48, 0.34)):
            a = -math.pi / 2 + (i - 3) * 0.32
            lines.append([(0.12 * math.cos(a), 0.3 + 0.12 * math.sin(a)), ((0.12 + L) * math.cos(a), 0.3 + (0.12 + L) * math.sin(a))])
        return [], lines, 0.06
    if kind == "spiral":
        return [], [[((0.03 + 0.47 * i / 90) * math.cos(i / 90 * 3 * 2 * math.pi), (0.03 + 0.47 * i / 90) * math.sin(i / 90 * 3 * 2 * math.pi)) for i in range(91)]], 0.06
    if kind == "kiss":  # lips
        upper = [(-0.5, 0.0), (-0.35, -0.12), (-0.18, -0.22), (-0.06, -0.18), (0.0, -0.12), (0.06, -0.18), (0.18, -0.22), (0.35, -0.12),
                 (0.5, 0.0), (0.25, -0.02), (0.0, 0.0), (-0.25, -0.02)]
        lower = [(-0.48, 0.03), (-0.25, 0.05), (0.0, 0.06), (0.25, 0.05), (0.48, 0.03), (0.32, 0.18), (0.0, 0.27), (-0.32, 0.18)]
        return [upper, lower], [], 0.0
    if kind == "exclaim":  # !
        dot = [(0.1 * math.cos(2 * math.pi * i / 20), 0.38 + 0.1 * math.sin(2 * math.pi * i / 20)) for i in range(20)]
        return [[(-0.12, -0.5), (0.12, -0.5), (0.06, 0.18), (-0.06, 0.18)], dot], [], 0.0
    return [], [], 0.0


ICON_COLOURS = {  # standalone icons: default (fill, outline) per kind; mirrored in web/speech_bubbles.js
    "heart": ("#FF5C9A", "#000000"), "sparkle": ("#FF5C9A", "#000000"), "tremble": ("#000000", "#FFFFFF"),
    "sweat": ("#CFEAFF", "#22303C"), "steam": ("#FFFFFF", "#6B6B6B"),
    "note": ("#FF5C9A", "#000000"), "puff": ("#FFFFFF", "#6B6B6B"), "blush": ("#FF6F8E", "#FFFFFF"),
    "throb": ("#000000", "#FFFFFF"), "vein": ("#E02020", "#FFFFFF"), "droplets": ("#FFFFFF", "#3A3A3A"),
    "spurt": ("#000000", "#FFFFFF"), "spiral": ("#000000", "#FFFFFF"), "kiss": ("#E0245E", "#000000"),
    "exclaim": ("#000000", "#FFFFFF"),
}


def deco_colours(b, kind):
    """(fill, outline) of a decoration: an icon's own colours, else its effect's (sweat and steam keep theirs)."""
    f, o = ICON_COLOURS.get(kind, ICON_COLOURS["heart"])
    if b.get("type") == "icon":
        return b.get("dcolor") or f, b.get("docolor") or o
    if kind in ("sweat", "steam"):
        return f, o
    if kind == "tremble":
        return b.get("color") or f, b.get("ocolor") or o
    f, o = ICON_COLOURS["heart"]
    return b.get("dcolor") or f, b.get("docolor") or o


def place(item, pts, w, h):
    s = float(item.get("s", 0.02)) * h
    r = float(item.get("r", 0))
    kx, ky = float(item.get("kx", 1)), float(item.get("ky", 1))  # an icon's own width / height stretch
    cx, cy, cs, sn = float(item["x"]) * w, float(item["y"]) * h, math.cos(r), math.sin(r)
    return [(cx + s * (u * kx * cs - v * ky * sn), cy + s * (u * kx * sn + v * ky * cs)) for u, v in pts]


def draw_deco(page, b, item):
    w, h = page.size
    polys, lines, lw = deco_shapes(item.get("kind"))
    if not polys and not lines:
        return
    s = float(item.get("s", 0.02)) * h
    fill, outline = deco_colours(b, item.get("kind"))
    ow = max(1.5, 0.08 * s)
    P = [place(item, p, w, h) for p in polys]
    Ls = [place(item, l, w, h) for l in lines]
    pts = [q for p in P + Ls for q in p]
    x0, y0, x1, y1 = layer_box([p[0] for p in pts], [p[1] for p in pts], ow + lw * s + 4)
    layer = ss_layer(x0, y0, x1, y1)
    d = ImageDraw.Draw(layer)
    T = lambda poly: [((x - x0) * SS, (y - y0) * SS) for x, y in poly]
    for p in P:
        q = T(p)
        d.line(q + [q[0]], fill=hex_rgba(outline, "#000000"), width=max(1, round(2 * ow * SS)), joint="curve")
        d.polygon(q, fill=hex_rgba(fill, "#FF5C9A"))
    for l in Ls:  # stroked lines: halo first, then the line
        q = T(l)
        d.line(q, fill=hex_rgba(outline, "#FFFFFF"), width=max(1, round((lw * s + 2 * ow) * SS)), joint="curve")
    for l in Ls:
        d.line(T(l), fill=hex_rgba(fill, "#000000"), width=max(1, round(lw * s * SS)), joint="curve")
    paste_layer(page, layer, x0, y0, (x1 - x0, y1 - y0))


# ---------------------------------------------------------------- sound-effect text
def sfx_text(b):
    """The effect's text with runs of whitespace collapsed to single spaces."""
    return " ".join(str(b.get("text", "")).split())


def sfx_layout(b, size, measure):
    """Per-letter (token, font size, x, advance, rotation, y offset); hearts are None. measure(ch, fs) -> advance."""
    toks = [ch for ch, _ in heart_tokens(sfx_text(b))]
    shake, grow = float(b.get("shake", 0)), float(b.get("grow", 0))
    rnd, n, x, out = Rng(b.get("seed", 1)), len(toks), 0.0, []
    for i, tk in enumerate(toks):
        fs = round(size * (1 + grow * (i / (n - 1) if n > 1 else 0)))
        adv = 0.95 * fs if tk is None else measure(tk, fs)
        rot = (rnd.next() - 0.5) * 2 * shake * 0.35
        off = (rnd.next() - 0.5) * 2 * shake * 0.12 * fs
        out.append((tk, fs, x, adv, rot, off))
        x += adv + 0.02 * size
    return out, x


def sfx_text_image(b, font_path, size):
    """The flat text with its effects (shadow, outer outline, outline, fill), cropped to the ink."""
    if not sfx_text(b):
        return None
    fonts = {}
    font = lambda fs: fonts.setdefault(fs, ImageFont.truetype(font_path, fs))
    sw1 = round(float(b.get("ow", 0.08)) * size)
    sw2 = round(float(b.get("o2w", 0)) * size)
    dx, dy = round(float(b.get("sx", 0)) * size), round(float(b.get("sy", 0)) * size)
    outer = sw1 + sw2
    lay, total = sfx_layout(b, size, lambda ch, fs: font(fs).getlength(ch))
    maxfs = max(g[1] for g in lay)
    margin = int(outer + 0.5 * maxfs + abs(dx) + abs(dy) + 4)
    im = Image.new("RGBA", (int(total + 2 * margin), int(maxfs * 1.7 + 2 * margin)), (0, 0, 0, 0))
    base = margin + maxfs * 1.15
    col =lambda key, dflt: hex_rgba(b.get(key), dflt)
    passes = []
    if dx or dy:
        passes.append((col("scolor", "#000000"), outer, col("scolor", "#000000"), dx, dy, True))
    if sw2:
        passes.append((col("o2color", "#000000"), outer, col("o2color", "#000000"), 0, 0, True))
    passes.append((None, sw1, col("ocolor", "#FFFFFF"), 0, 0, False))  # outline of every letter first
    passes.append((col("color", "#000000"), 0, None, 0, 0, True))  # then every fill on top
    for fill, sw, scol, ox, oy, do_fill in passes:
        for tk, fs, x, adv, rot, off in lay:
            if tk == " " or (not do_fill and sw <= 0):
                continue
            T = int(2 * fs + 2 * outer + 4)
            tile = Image.new("RGBA", (T, T), (0, 0, 0, 0))
            d = ImageDraw.Draw(tile)
            if tk is None:
                q = heart_points(T / 2, T / 2, fs)
                if sw > 0:
                    d.line(q + [q[0]], fill=scol, width=2 * sw, joint="curve")
                if do_fill:
                    d.polygon(q, fill=fill if fill else scol)
            else:
                kw = dict(font=font(fs), anchor="ms")
                if sw > 0:
                    d.text((T / 2, T / 2 + 0.35 * fs), tk, fill=(fill if do_fill and fill else scol), stroke_width=sw, stroke_fill=scol, **kw)
                elif do_fill:
                    d.text((T / 2, T / 2 + 0.35 * fs), tk, fill=fill, **kw)
            if rot:
                tile = tile.rotate(-math.degrees(rot), resample=Image.BICUBIC)
            cx, cy = margin + x + adv / 2 + ox, base - 0.35 * fs + off + oy
            im.alpha_composite(tile, (int(round(cx - T / 2)), int(round(cy - T / 2))))
    box = im.getchannel("A").getbbox()
    if not box:
        return None
    return im.crop((max(0, box[0] - 2), max(0, box[1] - 2), min(im.width, box[2] + 2), min(im.height, box[3] + 2)))


def draw_sfx(page, b, font_path):
    import cv2
    import numpy as np
    w, h = page.size
    for item in b.get("deco", []) or []:  # decorations sit under the letters
        draw_deco(page, b, item)
    top = [(x * w, y * h) for x, y in b.get("top", [])]
    bottom = [(x * w, y * h) for x, y in b.get("bottom", [])]
    if len(top) < 2 or len(bottom) < 2:
        return
    tall = max(math.dist(edge_at(top, f / 20), edge_at(bottom, f / 20)) for f in range(21))
    src = sfx_text_image(b, font_path, max(32, min(640, round(tall * 1.3))))
    if src is None:
        return
    tw, th = src.size
    tris = sfx_triangles(top, bottom, tw, th)
    xs = [p[0] for _, dst in tris for p in dst]
    ys = [p[1] for _, dst in tris for p in dst]
    x0, y0 = max(0, math.floor(min(xs)) - 1), max(0, math.floor(min(ys)) - 1)
    x1, y1 = min(w, math.ceil(max(xs)) + 2), min(h, math.ceil(max(ys)) + 2)
    if x1 <= x0 or y1 <= y0:
        return
    map_x = np.full((y1 - y0, x1 - x0), -1, np.float32)
    map_y = np.full((y1 - y0, x1 - x0), -1, np.float32)
    gy, gx = np.mgrid[y0:y1, x0:x1].astype(np.float32)
    for s_tri, d_tri in tris:
        A = cv2.getAffineTransform(np.float32(d_tri), np.float32(s_tri))  # destination -> source
        mask = np.zeros((y1 - y0, x1 - x0), np.uint8)
        cv2.fillConvexPoly(mask, np.int32(np.round([(x - x0, y - y0) for x, y in d_tri])), 1)
        m = mask.astype(bool)
        map_x[m] = A[0, 0] * gx[m] + A[0, 1] * gy[m] + A[0, 2]
        map_y[m] = A[1, 0] * gx[m] + A[1, 1] * gy[m] + A[1, 2]
    warped = cv2.remap(np.asarray(src), map_x, map_y, cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT, borderValue=(0, 0, 0, 0))
    paste_layer(page, Image.fromarray(warped, "RGBA"), x0, y0)
