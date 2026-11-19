import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";
// the node as it is now: ComfyUI rebuilds every node when it reconnects after a restart, so an editor opened
// before that must write into the rebuilt node, not the old one. The result is also kept in this browser as a backup.
function liveNode(node) {
    const live = app.graph?.getNodeById?.(node.id);
    return live && live.type === node.type ? live : node;
}
function backup(kind, node, value) {
    try {
        localStorage.setItem(`speech_bubbles_backup:${kind}:${node.id}`, JSON.stringify({ at: Date.now(), value }));
    } catch {}
}

// the node's latest page from this server session (also after a cached run), else the copy saved in the workflow
async function lastUi(kind, node, saved) {
    try {
        const r = await api.fetchApi(`/speech_bubbles/last/${kind}/${node.id}`);
        if (r.ok) return await r.json();
    } catch {}
    return saved;
}
// let ComfyUI's change tracker see the change, so switching workflow tabs or reloading doesn't roll it back
function track() {
    app.graph?.change?.();
    app.extensionManager?.workflow?.activeWorkflow?.changeTracker?.checkState?.();
}

// Geometry mirrors bubbles.py; keep both in step.
const TEXT_WIDTH = { speech: 0.72, thought: 0.66, shout: 0.56 };
const LINE_HEIGHT = 1.18;
const BASELINE = 0.86;
const SFX_STRIPS = 48;
const strokePx = (h) => Math.max(2, Math.round(h * 0.0022));

const SFX_PRESETS = {
    Classic: { color: "#000000", ocolor: "#FFFFFF", ow: 0.08, o2color: "#000000", o2w: 0, scolor: "#000000", sx: 0, sy: 0 },
    "Bold red": { color: "#E02020", ocolor: "#000000", ow: 0.06, o2color: "#FFFFFF", o2w: 0.06, scolor: "#000000", sx: 0, sy: 0 },
    "Pop yellow": { color: "#FFD21F", ocolor: "#C0161B", ow: 0.07, o2color: "#000000", o2w: 0.05, scolor: "#000000", sx: 0.06, sy: 0.06 },
    "Ghost white": { color: "#FFFFFF", ocolor: "#000000", ow: 0.07, o2color: "#000000", o2w: 0, scolor: "#000000", sx: 0, sy: 0 },
    "Heart pink": { color: "#FF6FAE", ocolor: "#FFFFFF", ow: 0.07, o2color: "#7A0F3A", o2w: 0.05, scolor: "#000000", sx: 0, sy: 0 },
    Shadowed: { color: "#FFFFFF", ocolor: "#000000", ow: 0.05, o2color: "#000000", o2w: 0, scolor: "#000000", sx: 0.08, sy: 0.08 },
};
// letter and decoration settings an effect starts with
const SFX_EXTRA = { shake: 0, grow: 0, kinds: {}, amount: 6, dsize: 1, dcolor: "#FF5C9A", docolor: "#000000" };
const DECO_KINDS = [["heart", "Hearts"], ["sparkle", "Sparkles"], ["tremble", "Tremble"], ["sweat", "Sweat"], ["steam", "Steam"]];

function rng(seed) {
    let s = (Math.floor(seed) % 2147483646) + 1;
    return () => {
        s = (s * 16807) % 2147483647;
        return (s - 1) / 2147483646;
    };
}

function geometry(b, w, h) {
    const cx = b.cx * w, cy = b.cy * h, rx = Math.max(4, b.rx * w), ry = Math.max(4, b.ry * h);
    const tx = b.tx * w, ty = b.ty * h;
    const ux = (tx - cx) / rx, uy = (ty - cy) / ry;
    const hasTail = ux * ux + uy * uy > 1.1;
    const a = Math.atan2(uy, ux);
    const circles = [], polys = [];
    const on = (f, t) => [cx + rx * f * Math.cos(t), cy + ry * f * Math.sin(t)];
    if (b.type === "thought") {
        const avg = (rx + ry) / 2, rb = 0.22 * avg;
        circles.push([cx, cy, rx * 0.85, ry * 0.85]);
        const k = Math.max(9, Math.round((2 * Math.PI * 0.85 * avg) / (1.3 * rb)));
        for (let i = 0; i < k; i++) {
            const t = (2 * Math.PI * i) / k;
            circles.push([cx + rx * 0.85 * Math.cos(t), cy + ry * 0.85 * Math.sin(t), rb, rb]);
        }
        if (hasTail) {
            const ex = cx + rx * Math.cos(a), ey = cy + ry * Math.sin(a);
            for (const [f, r] of [[0.25, 0.5], [0.55, 0.35], [0.85, 0.22]]) {
                circles.push([ex + (tx - ex) * f, ey + (ty - ey) * f, rb * r, rb * r]);
            }
        }
    } else if (b.type === "shout") {
        const r = rng(b.seed ?? 1), n = 14, pts = [];
        for (let i = 0; i < 2 * n; i++) {
            const t = (2 * Math.PI * i) / (2 * n) + (r() - 0.5) * 0.12;
            const f = i % 2 === 0 ? 1.0 + (r() - 0.5) * 0.14 : 0.72;
            pts.push(on(f, t));
        }
        polys.push(pts);
        if (hasTail) polys.push([on(0.66, a - 0.12), [tx, ty], on(0.66, a + 0.12)]);
    } else {
        circles.push([cx, cy, rx, ry]);
        if (hasTail) polys.push([on(0.8, a - 0.2), [tx, ty], on(0.8, a + 0.2)]);
    }
    return { circles, polys };
}

// closed Catmull-Rom curve through pts, n samples per segment
function catmull(pts, n = 12) {
    const out = [], k = pts.length;
    for (let i = 0; i < k; i++) {
        const p0 = pts[(i - 1 + k) % k], p1 = pts[i], p2 = pts[(i + 1) % k], p3 = pts[(i + 2) % k];
        for (let j = 0; j < n; j++) {
            const t = j / n, t2 = t * t, t3 = t2 * t;
            out.push([0, 1].map((c) => 0.5 * (2 * p1[c] + (-p0[c] + p2[c]) * t + (2 * p0[c] - 5 * p1[c] + 4 * p2[c] - p3[c]) * t2
                + (-p0[c] + 3 * p1[c] - 3 * p2[c] + p3[c]) * t3)));
        }
    }
    return out;
}
const customPts = (b, w, h) => (b.pts || []).map(([x, y]) => [x * w, y * h]);
const customOutline = (b, w, h) => {
    const p = customPts(b, w, h);
    return (b.smooth ?? true) && p.length >= 3 ? catmull(p) : p;
};
function centroid(poly) {
    let a = 0, cx = 0, cy = 0;
    for (let i = 0; i < poly.length; i++) {
        const [x0, y0] = poly[(i - 1 + poly.length) % poly.length], [x1, y1] = poly[i];
        const c = x0 * y1 - x1 * y0;
        a += c;
        cx += (x0 + x1) * c;
        cy += (y0 + y1) * c;
    }
    if (Math.abs(a) < 1e-9) return [poly.reduce((s, p) => s + p[0], 0) / poly.length, poly.reduce((s, p) => s + p[1], 0) / poly.length];
    return [cx / (3 * a), cy / (3 * a)];
}

// ---- turning (mirrored in bubbles.py): rot = radians, clockwise; tail tip / custom points are stored turned
const rotAbout = ([x, y], [cx, cy], a) => {
    const cs = Math.cos(a), sn = Math.sin(a), dx = x - cx, dy = y - cy;
    return [cx + dx * cs - dy * sn, cy + dx * sn + dy * cs];
};
function pivotOf(b, w, h) { // page pixels
    if (b.type === "custom") {
        const out = customOutline(b, w, h);
        return out.length >= 3 ? centroid(out) : [0, 0];
    }
    return [b.cx * w, b.cy * h];
}
function unturned(b, w, h) { // the bubble before its turn (page fractions)
    const a = b.rot || 0;
    if (!a) return b;
    const c = pivotOf(b, w, h), u = { ...b };
    const back = ([x, y]) => {
        const [px, py] = rotAbout([x * w, y * h], c, -a);
        return [px / w, py / h];
    };
    if (b.type === "custom") u.pts = (b.pts || []).map(back);
    else [u.tx, u.ty] = back([b.tx, b.ty]);
    return u;
}

// ---- hearts in bubble text (mirrored in bubbles.py): <3 follows the bubble's heart mode, ♡ outlined, ♥ filled
const HEART_ADV = 0.9;
function textRuns(line, mode) {
    const out = [];
    let buf = "";
    for (let i = 0; i < line.length;) {
        let kind = null, step = 1;
        if (line.startsWith("<3", i)) [kind, step] = [mode === "fill" ? "fill" : "outline", 2];
        else if (line[i] === "♡") kind = "outline";
        else if (line[i] === "♥") kind = "fill";
        if (kind) {
            if (buf) out.push([buf, null]);
            buf = "";
            out.push([null, kind]);
            i += step;
        } else buf += line[i++];
    }
    if (buf) out.push([buf, null]);
    return out;
}
const hasHearts = (line) => line.includes("<3") || line.includes("♡") || line.includes("♥");
const lineWidth = (line, mode, measure, fs) => textRuns(line, mode).reduce((s, [t]) => s + (t === null ? HEART_ADV * fs : measure(t)), 0);

// sound effects: text stretched between the top and bottom edges
function edgeAt(pts, f) {
    const seg = pts.slice(0, -1).map((p, i) => Math.hypot(pts[i + 1][0] - p[0], pts[i + 1][1] - p[1]));
    const total = seg.reduce((a, b) => a + b, 0) || 1;
    let d = f * total;
    for (let i = 0; i < seg.length; i++) {
        const L = seg[i];
        if (d <= L || i === seg.length - 1) {
            const t = L === 0 ? 0 : Math.min(1, d / L);
            return [pts[i][0] + (pts[i + 1][0] - pts[i][0]) * t, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * t];
        }
        d -= L;
    }
    return pts[pts.length - 1];
}
function sfxTriangles(top, bottom, tw, th) {
    const tris = [];
    for (let k = 0; k < SFX_STRIPS; k++) {
        const u0 = k / SFX_STRIPS, u1 = (k + 1) / SFX_STRIPS;
        const t0 = edgeAt(top, u0), t1 = edgeAt(top, u1), b0 = edgeAt(bottom, u0), b1 = edgeAt(bottom, u1);
        const s00 = [u0 * tw, 0], s10 = [u1 * tw, 0], s11 = [u1 * tw, th], s01 = [u0 * tw, th];
        tris.push([[s00, s10, s11], [t0, t1, b1]]);
        tris.push([[s00, s11, s01], [t0, b1, b0]]);
    }
    return tris;
}
const sfxPts = (b, w, h) => [(b.top || []).map(([x, y]) => [x * w, y * h]), (b.bottom || []).map(([x, y]) => [x * w, y * h])];
const sfxRegion = (b, w, h) => {
    const [t, bt] = sfxPts(b, w, h);
    return [...t, ...bt.slice().reverse()];
};
// ---- effect shapes: unit size, centred on (0, 0); mirrored in bubbles.py
function centreShape(pts) {
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
    const hgt = Math.max(...ys) - Math.min(...ys) || 1;
    return pts.map(([x, y]) => [(x - cx) / hgt, (y - cy) / hgt]);
}
function heartShape(n = 48) {
    const pts = [];
    for (let i = 0; i < n; i++) {
        const t = (2 * Math.PI * i) / n;
        pts.push([16 * Math.sin(t) ** 3, -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t))]);
    }
    return centreShape(pts);
}
const HEART = heartShape();
function decoShapes(kind) {
    if (kind === "heart") return [[HEART], [], 0];
    if (kind === "sparkle") return [[[...Array(8)].map((_, k) => {
        const a = (k * Math.PI) / 4 - Math.PI / 2, r = k % 2 === 0 ? 0.5 : 0.13;
        return [Math.cos(a) * r, Math.sin(a) * r];
    })], [], 0];
    if (kind === "sweat") {
        const drop = [...Array(17)].map((_, i) => [0.32 * Math.cos((Math.PI * i) / 16), 0.15 + 0.32 * Math.sin((Math.PI * i) / 16)]);
        drop.push([0, -0.5]);
        return [[drop], [], 0];
    }
    if (kind === "steam") return [[], [-1, 0, 1].map((j) => [...Array(17)].map((_, v) => [j * 0.28 + 0.08 * Math.sin((v / 16) * 2 * Math.PI * 1.5), 0.5 - v / 16])), 0.07];
    if (kind === "tremble") return [[], [0.25, 0.42, 0.59].map((r) => [...Array(11)].map((_, i) => [-0.4 + r * Math.cos(-0.55 + (1.1 * i) / 10), r * Math.sin(-0.55 + (1.1 * i) / 10)])), 0.06];
    const PI = Math.PI, cos = Math.cos, sin = Math.sin;
    if (kind === "note") { // ♪
        const head = [...Array(24)].map((_, i) => {
            const t = (2 * PI * i) / 24;
            return [-0.14 + 0.2 * cos(t) * cos(-0.4) - 0.13 * sin(t) * sin(-0.4), 0.32 + 0.2 * cos(t) * sin(-0.4) + 0.13 * sin(t) * cos(-0.4)];
        });
        return [[head], [[[0.04, 0.28], [0.04, -0.48]], [[0.04, -0.48], [0.2, -0.36], [0.3, -0.2], [0.26, -0.04]]], 0.08];
    }
    if (kind === "puff") return [[[...Array(72)].map((_, i) => { // breath cloud
        const t = (2 * PI * i) / 72;
        return [(0.5 + 0.06 * cos(6 * t)) * cos(t), (0.3 + 0.05 * cos(6 * t)) * sin(t)];
    })], [], 0];
    if (kind === "blush") return [[], [...Array(5)].map((_, k) => [[-0.5 + 0.22 * k, 0.25], [-0.36 + 0.22 * k, -0.25]]), 0.07];
    if (kind === "throb") { // pulse arcs on both sides
        const arcs = [];
        for (const r of [0.3, 0.46]) {
            arcs.push([...Array(11)].map((_, i) => [r * cos(PI - 0.5 + i / 10), r * sin(PI - 0.5 + i / 10)]));
            arcs.push([...Array(11)].map((_, i) => [r * cos(-0.5 + i / 10), r * sin(-0.5 + i / 10)]));
        }
        return [[], arcs, 0.06];
    }
    if (kind === "vein") { // anger mark: four corner arcs
        const arcs = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sy]) => {
            const a0 = Math.atan2(-sy, -sx);
            return [...Array(11)].map((_, i) => [sx * 0.48 + 0.34 * cos(a0 - 0.75 + (1.5 * i) / 10), sy * 0.48 + 0.34 * sin(a0 - 0.75 + (1.5 * i) / 10)]);
        });
        return [[], arcs, 0.1];
    }
    if (kind === "droplets") { // a spray of drops
        const drop = decoShapes("sweat")[0][0];
        return [[[0.55, -0.5, -0.24, 0.12], [0.45, 0.35, 0.24, 0.06], [0.32, -0.1, -0.02, -0.3], [0.24, 0.7, 0.36, -0.3]].map(([k, a, dx, dy]) =>
            drop.map(([u, v]) => [dx + k * (u * cos(a) - v * sin(a)), dy + k * (u * sin(a) + v * cos(a))])), [], 0];
    }
    if (kind === "spurt") return [[], [0.42, 0.5, 0.36, 0.52, 0.4, 0.48, 0.34].map((L, i) => { // burst lines fanning upwards
        const a = -PI / 2 + (i - 3) * 0.32;
        return [[0.12 * cos(a), 0.3 + 0.12 * sin(a)], [(0.12 + L) * cos(a), 0.3 + (0.12 + L) * sin(a)]];
    }), 0.06];
    if (kind === "spiral") return [[], [[...Array(91)].map((_, i) => [(0.03 + (0.47 * i) / 90) * cos((i / 90) * 3 * 2 * PI), (0.03 + (0.47 * i) / 90) * sin((i / 90) * 3 * 2 * PI)])], 0.06];
    if (kind === "kiss") return [[ // lips
        [[-0.5, 0.0], [-0.35, -0.12], [-0.18, -0.22], [-0.06, -0.18], [0.0, -0.12], [0.06, -0.18], [0.18, -0.22], [0.35, -0.12], [0.5, 0.0], [0.25, -0.02], [0.0, 0.0], [-0.25, -0.02]],
        [[-0.48, 0.03], [-0.25, 0.05], [0.0, 0.06], [0.25, 0.05], [0.48, 0.03], [0.32, 0.18], [0.0, 0.27], [-0.32, 0.18]],
    ], [], 0];
    if (kind === "exclaim") return [[ // !
        [[-0.12, -0.5], [0.12, -0.5], [0.06, 0.18], [-0.06, 0.18]],
        [...Array(20)].map((_, i) => [0.1 * cos((2 * PI * i) / 20), 0.38 + 0.1 * sin((2 * PI * i) / 20)]),
    ], [], 0];
    return [[], [], 0];
}
// standalone icons ("icon" items): default fill / outline per kind; mirrored in bubbles.py
const ICON_COLOURS = {
    heart: ["#FF5C9A", "#000000"], sparkle: ["#FF5C9A", "#000000"], tremble: ["#000000", "#FFFFFF"], sweat: ["#CFEAFF", "#22303C"], steam: ["#FFFFFF", "#6B6B6B"],
    note: ["#FF5C9A", "#000000"], puff: ["#FFFFFF", "#6B6B6B"], blush: ["#FF6F8E", "#FFFFFF"], throb: ["#000000", "#FFFFFF"], vein: ["#E02020", "#FFFFFF"],
    droplets: ["#FFFFFF", "#3A3A3A"], spurt: ["#000000", "#FFFFFF"], spiral: ["#000000", "#FFFFFF"], kiss: ["#E0245E", "#000000"], exclaim: ["#000000", "#FFFFFF"],
};
// everything the Icons menu offers (the first five also ring sound effects automatically)
const ICON_KINDS = [["heart", "Heart"], ["sparkle", "Sparkle"], ["tremble", "Tremble"], ["sweat", "Sweat"], ["steam", "Steam"],
    ["note", "Note ♪"], ["puff", "Breath puff"], ["blush", "Blush"], ["throb", "Throb"], ["vein", "Anger vein"],
    ["droplets", "Droplets"], ["spurt", "Spurt lines"], ["spiral", "Spiral"], ["kiss", "Kiss mark"], ["exclaim", "Exclamation"]];
function decoColours(b, kind) {
    if (b.type === "icon") {
        const d = ICON_COLOURS[kind] || ICON_COLOURS.heart;
        return [b.dcolor || d[0], b.docolor || d[1]];
    }
    if (kind === "tremble") return [b.color || "#000000", b.ocolor || "#FFFFFF"];
    if (kind === "sweat") return ["#CFEAFF", "#22303C"];
    if (kind === "steam") return ["#FFFFFF", "#6B6B6B"];
    return [b.dcolor || "#FF5C9A", b.docolor || "#000000"];
}
function placeShape(item, pts, w, h) { // kx / ky stretch an icon along its own width / height
    const s = (item.s ?? 0.02) * h, r = item.r ?? 0, cs = Math.cos(r), sn = Math.sin(r), cx = item.x * w, cy = item.y * h;
    const kx = item.kx ?? 1, ky = item.ky ?? 1;
    return pts.map(([u, v]) => [cx + s * (u * kx * cs - v * ky * sn), cy + s * (u * kx * sn + v * ky * cs)]);
}
// a small picture of a decoration kind, for its button
function iconCanvas(kind, px = 22) {
    const c = document.createElement("canvas"), dpr = window.devicePixelRatio || 1;
    c.width = c.height = Math.round(px * dpr);
    c.style.cssText = `width:${px}px;height:${px}px;display:block;pointer-events:none;`;
    const g = c.getContext("2d");
    g.scale(dpr, dpr);
    drawDeco(g, { type: "icon" }, { kind, x: 0.5, y: 0.5, s: kind === "steam" || kind === "tremble" ? 0.72 : 0.62 }, px, px);
    return c;
}
function drawDeco(ctx, b, item, w, h) {
    const [polys, lines, lw] = decoShapes(item.kind);
    const s = (item.s ?? 0.02) * h, [fill, outline] = decoColours(b, item.kind), ow = Math.max(1.5, 0.08 * s);
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    for (const p of polys) {
        const q = placeShape(item, p, w, h);
        ctx.beginPath();
        q.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
        ctx.closePath();
        ctx.lineWidth = 2 * ow;
        ctx.strokeStyle = outline;
        ctx.stroke();
        ctx.fillStyle = fill;
        ctx.fill();
    }
    for (const [width, col] of [[lw * s + 2 * ow, outline], [lw * s, fill]]) {
        for (const l of lines) {
            const q = placeShape(item, l, w, h);
            ctx.beginPath();
            q.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
            ctx.lineWidth = width;
            ctx.strokeStyle = col;
            ctx.stroke();
        }
    }
}

// ---- sound-effect text, letter by letter (tilt, growth, inline hearts); mirrored in bubbles.py
function sfxTokens(text) {
    const out = [];
    for (let i = 0; i < text.length;) {
        if (text.startsWith("<3", i)) {
            out.push(null);
            i += 2;
        } else if ("♡♥".includes(text[i])) {
            out.push(null);
            i += 1;
        } else out.push(text[i++]);
    }
    return out;
}
function sfxLayout(b, size, measure) {
    const toks = sfxTokens(String(b.text ?? "").split(/\s+/).filter(Boolean).join(" "));
    const shake = b.shake ?? 0, grow = b.grow ?? 0, rnd = rng(b.seed ?? 1), n = toks.length, out = [];
    let x = 0;
    toks.forEach((tk, i) => {
        const fs = Math.round(size * (1 + grow * (n > 1 ? i / (n - 1) : 0)));
        const adv = tk === null ? 0.95 * fs : measure(tk, fs);
        const rot = (rnd() - 0.5) * 2 * shake * 0.35, off = (rnd() - 0.5) * 2 * shake * 0.12 * fs;
        out.push([tk, fs, x, adv, rot, off]);
        x += adv + 0.02 * size;
    });
    return [out, x];
}
const textCache = new Map();
function sfxTextCanvas(b, family, size) {
    const text = String(b.text ?? "").split(/\s+/).filter(Boolean).join(" ");
    if (!text) return null;
    const key = JSON.stringify([text, family, size, b.ow, b.o2w, b.sx, b.sy, b.color, b.ocolor, b.o2color, b.scolor, b.shake, b.grow, b.seed]);
    if (textCache.has(key)) return textCache.get(key);
    const probe = document.createElement("canvas").getContext("2d");
    const measure = (ch, fs) => {
        probe.font = `${fs}px "${family}"`;
        return probe.measureText(ch).width;
    };
    const sw1 = Math.round((b.ow ?? 0.08) * size), sw2 = Math.round((b.o2w ?? 0) * size), outer = sw1 + sw2;
    const dx = Math.round((b.sx ?? 0) * size), dy = Math.round((b.sy ?? 0) * size);
    const [lay, total] = sfxLayout(b, size, measure);
    const maxfs = Math.max(...lay.map((g) => g[1]));
    const margin = Math.floor(outer + 0.5 * maxfs + Math.abs(dx) + Math.abs(dy) + 4);
    const c = document.createElement("canvas");
    c.width = Math.floor(total + 2 * margin);
    c.height = Math.floor(maxfs * 1.7 + 2 * margin);
    const g = c.getContext("2d");
    g.lineJoin = "round";
    const base = margin + maxfs * 1.15;
    const passes = [];
    if (dx || dy) passes.push([b.scolor || "#000000", outer, b.scolor || "#000000", dx, dy, true]);
    if (sw2) passes.push([b.o2color || "#000000", outer, b.o2color || "#000000", 0, 0, true]);
    passes.push([null, sw1, b.ocolor || "#FFFFFF", 0, 0, false]); // outline of every letter first
    passes.push([b.color || "#000000", 0, null, 0, 0, true]); // then every fill on top
    for (const [fill, sw, scol, ox, oy, doFill] of passes) {
        for (const [tk, fs, x, adv, rot, off] of lay) {
            if (tk === " " || (!doFill && sw <= 0)) continue;
            g.save();
            g.translate(margin + x + adv / 2 + ox, base - 0.35 * fs + off + oy);
            g.rotate(rot);
            g.lineWidth = 2 * sw;
            g.strokeStyle = scol;
            g.fillStyle = doFill && fill ? fill : scol;
            if (tk === null) {
                g.beginPath();
                HEART.forEach(([u, v], i) => (i ? g.lineTo(u * 0.8 * fs, v * 0.8 * fs) : g.moveTo(u * 0.8 * fs, v * 0.8 * fs)));
                g.closePath();
                if (sw > 0) g.stroke();
                if (doFill) g.fill();
            } else {
                g.font = `${fs}px "${family}"`;
                g.textAlign = "center";
                g.textBaseline = "alphabetic";
                if (sw > 0) g.strokeText(tk, 0, 0.35 * fs);
                if (doFill || sw > 0) g.fillText(tk, 0, 0.35 * fs);
            }
            g.restore();
        }
    }
    // crop to the ink: scan in from each edge and stop at the first inked row/column (same box as a full scan)
    const cwid = c.width, chei = c.height;
    const px32 = new Uint32Array(g.getImageData(0, 0, cwid, chei).data.buffer); // alpha is the top byte
    const rowInk = (y) => { for (let x = 0, o = y * cwid; x < cwid; x++) if (px32[o + x] >>> 24) return true; return false; };
    let y0 = 0, y1 = chei - 1;
    while (y0 < chei && !rowInk(y0)) y0++;
    if (y0 >= chei) return null;
    while (y1 > y0 && !rowInk(y1)) y1--;
    const colInk = (x) => { for (let y = y0; y <= y1; y++) if (px32[y * cwid + x] >>> 24) return true; return false; };
    let x0 = 0, x1 = cwid - 1;
    while (x0 < cwid && !colInk(x0)) x0++;
    while (x1 > x0 && !colInk(x1)) x1--;
    const cx0 = Math.max(0, x0 - 2), cy0 = Math.max(0, y0 - 2), cw = Math.min(c.width, x1 + 3) - cx0, ch = Math.min(c.height, y1 + 3) - cy0;
    const out = document.createElement("canvas");
    out.width = cw;
    out.height = ch;
    out.getContext("2d").drawImage(c, cx0, cy0, cw, ch, 0, 0, cw, ch);
    if (textCache.size > 64) textCache.clear();
    textCache.set(key, out);
    return out;
}

// automatic decoration layout around an effect's box (then adjustable item by item)
function genDeco(b, w, h) {
    const reg = sfxRegion(b, w, h), xs = reg.map((p) => p[0]), ys = reg.map((p) => p[1]);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    const bw = x1 - x0, bh = Math.max(8, y1 - y0), cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    const kinds = b.kinds || {}, n = Math.max(1, Math.round(b.amount ?? 6)), ds = b.dsize ?? 1, r = rng(b.dseed ?? 1), out = [];
    const put = (kind, x, y, s, rot) => out.push({ kind, x: x / w, y: y / h, s: s / h, r: rot });
    const ring = (kind, count, base) => {
        for (let i = 0; i < count; i++) {
            const a = (i / count) * 2 * Math.PI + (r() - 0.5) * 0.6, k = 1.05 + r() * 0.3;
            put(kind, cx + Math.cos(a) * ((bw / 2) * k + 0.2 * bh), cy + Math.sin(a) * ((bh / 2) * k + 0.25 * bh), base * bh * ds * (0.6 + 0.4 * r()), (r() - 0.5) * 0.7);
        }
    };
    if (kinds.heart) ring("heart", n, 0.38);
    if (kinds.sparkle) ring("sparkle", Math.ceil(n * 0.6), 0.32);
    if (kinds.tremble) {
        put("tremble", x0 - 0.05 * bh, cy, 0.9 * bh * ds, Math.PI);
        put("tremble", x1 + 0.05 * bh, cy, 0.9 * bh * ds, 0);
    }
    if (kinds.sweat) for (let i = 0; i < Math.ceil(n / 3); i++) put("sweat", x0 + bw * (0.1 + 0.8 * r()), y0 - 0.35 * bh - r() * 0.3 * bh, 0.3 * bh * ds, (r() - 0.5) * 0.4);
    if (kinds.steam) for (let i = 0; i < (n > 6 ? 2 : 1); i++) put("steam", x0 + bw * (0.3 + 0.4 * r()), y0 - 0.6 * bh, 0.9 * bh * ds, 0);
    return out;
}
function affine(s, d) {
    const [[s0x, s0y], [s1x, s1y], [s2x, s2y]] = s, [[d0x, d0y], [d1x, d1y], [d2x, d2y]] = d;
    const den = s0x * (s1y - s2y) + s1x * (s2y - s0y) + s2x * (s0y - s1y);
    const k = (q0, q1, q2) => [
        (q0 * (s1y - s2y) + q1 * (s2y - s0y) + q2 * (s0y - s1y)) / den,
        (q0 * (s2x - s1x) + q1 * (s0x - s2x) + q2 * (s1x - s0x)) / den,
        (q0 * (s1x * s2y - s2x * s1y) + q1 * (s2x * s0y - s0x * s2y) + q2 * (s0x * s1y - s1x * s0y)) / den,
    ];
    const [a, c, e] = k(d0x, d1x, d2x), [bb, dd, f] = k(d0y, d1y, d2y);
    return [a, bb, c, dd, e, f];
}
function drawSfx(ctx, b, w, h, family) {
    for (const item of b.deco || []) drawDeco(ctx, b, item, w, h); // decorations sit under the letters
    const [top, bottom] = sfxPts(b, w, h);
    if (top.length < 2 || bottom.length < 2) return;
    let tall = 0;
    for (let i = 0; i <= 20; i++) {
        const p = edgeAt(top, i / 20), q = edgeAt(bottom, i / 20);
        tall = Math.max(tall, Math.hypot(p[0] - q[0], p[1] - q[1]));
    }
    // the editor renders at a size rounded to 32 px so dragging stays fast; the output uses the exact size
    const src = sfxTextCanvas(b, family, Math.max(32, Math.min(640, Math.round((tall * 1.3) / 32) * 32)));
    if (!src) return;
    for (const [s, d] of sfxTriangles(top, bottom, src.width, src.height)) {
        const [cx, cy] = [(d[0][0] + d[1][0] + d[2][0]) / 3, (d[0][1] + d[1][1] + d[2][1]) / 3];
        const grow = (p) => { // a hair larger, so neighbouring triangles leave no seams
            const vx = p[0] - cx, vy = p[1] - cy, L = Math.hypot(vx, vy) || 1;
            return [p[0] + (vx / L) * 0.75, p[1] + (vy / L) * 0.75];
        };
        ctx.save();
        ctx.beginPath();
        d.map(grow).forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
        ctx.closePath();
        ctx.clip();
        ctx.transform(...affine(s, d));
        ctx.drawImage(src, 0, 0);
        ctx.restore();
    }
}

function wrap(text, measure, maxW) {
    const lines = [];
    for (const para of String(text).split("\n")) {
        let line = "";
        for (const word of para.split(/\s+/).filter(Boolean)) {
            const test = line ? `${line} ${word}` : word;
            if (line && measure(test) > maxW) {
                lines.push(line);
                line = word;
            } else line = test;
        }
        lines.push(line);
    }
    return lines;
}

function drawBubble(ctx, b, w, h, family) {
    if (b.type === "sfx") return drawSfx(ctx, b, w, h, family);
    if (b.type === "icon") return drawDeco(ctx, b, b, w, h);
    const rot = b.rot || 0;
    if (rot) { // drawn level, turned around its pivot
        const [px, py] = pivotOf(b, w, h);
        ctx.save();
        ctx.translate(px, py);
        ctx.rotate(rot);
        ctx.translate(-px, -py);
    }
    drawLevel(ctx, b, unturned(b, w, h), w, h, family);
    if (rot) ctx.restore();
}
function drawLevel(ctx, orig, b, w, h, family) {
    const s = strokePx(h);
    let circles, polys, tcx, tcy, textW;
    if (b.type === "custom") {
        const outline = customOutline(b, w, h);
        if (outline.length < 3) return;
        circles = [];
        polys = [outline];
        [tcx, tcy] = centroid(outline);
        const xs = outline.map((p) => p[0]);
        textW = 0.7 * (Math.max(...xs) - Math.min(...xs));
    } else {
        ({ circles, polys } = geometry(b, w, h));
        tcx = b.cx * w;
        tcy = b.cy * h;
        textW = 2 * b.rx * w * (TEXT_WIDTH[b.type] ?? 0.72);
    }
    for (const [grow, col] of [[s, "#000"], [0, "#fff"]]) {
        ctx.fillStyle = col;
        ctx.strokeStyle = col;
        for (const [cx, cy, rx, ry] of circles) {
            ctx.beginPath();
            ctx.ellipse(cx, cy, rx + grow, ry + grow, 0, 0, Math.PI * 2);
            ctx.fill();
        }
        for (const poly of polys) {
            ctx.beginPath();
            poly.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
            ctx.closePath();
            ctx.fill();
            if (grow) {
                ctx.lineWidth = 2 * s;
                ctx.lineJoin = "round";
                ctx.stroke();
            }
        }
    }
    const fs = Math.max(4, (b.size ?? 0.018) * h);
    ctx.font = `${fs}px "${family}"`;
    ctx.fillStyle = "#000";
    ctx.strokeStyle = "#000";
    ctx.textBaseline = "alphabetic";
    const mode = b.heart || "outline", measure = (t) => ctx.measureText(t).width;
    orig.lines = wrap(b.text ?? "", (t) => lineWidth(t, mode, measure, fs), textW); // kept on the saved bubble
    const lh = LINE_HEIGHT * fs;
    const top = tcy - (orig.lines.length * lh) / 2;
    orig.lines.forEach((line, i) => {
        if (!line) return;
        const base = top + i * lh + BASELINE * fs;
        if (!hasHearts(line)) {
            ctx.textAlign = "center";
            ctx.fillText(line, tcx, base);
            return;
        }
        ctx.textAlign = "left";
        let x = tcx - lineWidth(line, mode, measure, fs) / 2;
        for (const [t, kind] of textRuns(line, mode)) {
            if (t !== null) {
                ctx.fillText(t, x, base);
                x += measure(t);
                continue;
            }
            const hx = x + (HEART_ADV * fs) / 2, hy = base - 0.35 * fs;
            ctx.beginPath();
            HEART.forEach(([u, v], j) => (j ? ctx.lineTo(hx + u * 0.8 * fs, hy + v * 0.8 * fs) : ctx.moveTo(hx + u * 0.8 * fs, hy + v * 0.8 * fs)));
            ctx.closePath();
            if (kind === "fill") ctx.fill();
            else {
                ctx.lineWidth = Math.max(1, 0.09 * fs);
                ctx.lineJoin = "round";
                ctx.stroke();
            }
            x += HEART_ADV * fs;
        }
    });
}

const fontCache = new Map();
const famOf = (name) => "sb_" + String(name).replace(/[^a-z0-9]/gi, "_");
function loadFont(name) {
    if (!fontCache.has(name)) {
        const face = new FontFace(famOf(name), `url(${api.apiURL("/speech_bubbles/font/" + encodeURIComponent(name))})`);
        fontCache.set(name, face.load().then((f) => {
            document.fonts.add(f);
            return true;
        }).catch((e) => {
            console.warn("Speech Bubbles: font load failed", name, e);
            return false;
        }));
    }
    return fontCache.get(name);
}

function hideWidget(w) {
    if (!w) return;
    w.hidden = true;
    w.computeSize = () => [0, -4];
}

function el(tag, css, text) {
    const e = document.createElement(tag);
    if (css) e.style.cssText = css;
    if (text != null) e.textContent = text;
    return e;
}

function inPoly(x, y, poly) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const [xi, yi] = poly[i], [xj, yj] = poly[j];
        if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
}
function segDist(p, a, b) {
    const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy;
    const t = l2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2)) : 0;
    return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

let sbClipboard = null; // Ctrl+C / Ctrl+V in the editor; kept between editor openings
const BTN = "height:34px;padding:0 14px;font:600 14px sans-serif;color:#eee;background:#333;border:1px solid #555;border-radius:4px;cursor:pointer;white-space:nowrap;";
const ON = "#2d5a8a";
const LABEL = "font:13px sans-serif;color:#bbb;white-space:nowrap;";

async function openEditor(node) {
    const bg = await lastUi("sb", node, node.properties?.sb_bg);
    if (!bg) {
        alert("Run the workflow once so the page exists.");
        return;
    }
    const dataW = node.widgets.find((w) => w.name === "bubbles");
    const fontW = node.widgets.find((w) => w.name === "font");
    const fontName = fontW?.value ?? "";
    const fontNames = fontW?.options?.values ?? [fontName];
    const img = new Image();
    img.src = api.apiURL(`/view?filename=${encodeURIComponent(bg.filename)}&subfolder=${encodeURIComponent(bg.subfolder ?? "")}&type=${bg.type}&t=${Date.now()}`);
    try {
        await img.decode();
    } catch {
        alert("Run the workflow once so the page exists.");
        return;
    }
    const W = img.naturalWidth, H = img.naturalHeight;

    let bubbles;
    try {
        bubbles = JSON.parse(dataW.value || "[]");
    } catch {
        bubbles = [];
    }
    for (const b of bubbles) b.font = b.font || fontName;
    await Promise.all([...new Set([fontName, ...bubbles.map((b) => b.font)])].map(loadFont));
    let sel = bubbles.length ? bubbles.length - 1 : -1;
    let selPt = null; // { list: "pts" | "top" | "bottom", i }
    let lastFont = sel >= 0 ? bubbles[sel].font : fontName;
    let lastType = "speech";
    let lastSize = bubbles.find((b) => b.size)?.size ?? 0.018;
    let lastHeart = "outline";
    let lastSfx = { ...SFX_PRESETS.Classic, ...SFX_EXTRA };
    let selDeco = -1;

    // ---- layout
    const overlay = el("div", "position:fixed;inset:0;z-index:10000;background:#111;display:flex;flex-direction:column;");
    const bar = el("div", "display:flex;gap:8px;align-items:center;padding:8px;background:#1d1d1d;border-bottom:1px solid #333;flex-wrap:nowrap;");
    const body = el("div", "flex:1;display:flex;min-height:0;");
    const wrapC = el("div", "flex:1;position:relative;min-width:0;");
    const canvas = el("canvas", "position:absolute;inset:0;width:100%;height:100%;cursor:default;");
    const side = el("div", "width:340px;display:flex;flex-direction:column;gap:8px;padding:8px;background:#1d1d1d;border-left:1px solid #333;");
    const text = el("textarea", "flex:1;resize:none;font:18px sans-serif;color:#eee;background:#262626;border:1px solid #555;border-radius:4px;padding:8px;");
    wrapC.append(canvas);
    body.append(wrapC, side);
    overlay.append(bar, body);

    const btn = (label, fn, parent = bar) => {
        const b = el("button", BTN, label);
        b.onclick = fn;
        parent.append(b);
        return b;
    };
    const typeSel = el("select", BTN);
    for (const t of ["speech", "thought", "shout"]) typeSel.append(new Option(t[0].toUpperCase() + t.slice(1), t));

    const add = (type, x, y, kind) => {
        const m = Math.min(W, H);
        let b;
        if (type === "icon") {
            b = { type, kind, x: x / W, y: y / H, s: 0.05, kx: 1, ky: 1, r: 0, font: lastFont };
            bubbles.push(b);
            sel = bubbles.length - 1;
            selPt = null;
            selDeco = -1;
            sync();
            return;
        }
        if (type === "custom") {
            const rx = 0.09 * m, ry = 0.06 * m;
            b = { type, pts: [...Array(10)].map((_, i) => [(x + rx * Math.cos((i / 10) * 2 * Math.PI)) / W, (y + ry * Math.sin((i / 10) * 2 * Math.PI)) / H]), smooth: true, size: lastSize, text: "" };
        } else if (type === "sfx") {
            const hw = 0.15 * m, hh = 0.05 * m;
            b = {
                type, top: [[(x - hw) / W, (y - hh) / H], [(x + hw) / W, (y - hh) / H]], bottom: [[(x - hw) / W, (y + hh) / H], [(x + hw) / W, (y + hh) / H]], text: "",
                ...SFX_EXTRA, ...lastSfx, kinds: { ...lastSfx.kinds }, seed: Math.floor(Math.random() * 1e9), dseed: Math.floor(Math.random() * 1e9), deco: [],
            };
        } else {
            b = { type, cx: x / W, cy: y / H, rx: (0.09 * m) / W, ry: (0.06 * m) / H, tx: (x - 0.03 * m) / W, ty: (y + 0.12 * m) / H, size: lastSize, text: "", seed: Math.floor(Math.random() * 1e9) };
        }
        b.font = lastFont;
        if (type !== "sfx") b.heart = lastHeart;
        bubbles.push(b);
        sel = bubbles.length - 1;
        selPt = null;
        lastType = type;
        sync();
        text.focus();
    };
    const center = () => [view.ox, view.oy].map((o, i) => (([wrapC.clientWidth, wrapC.clientHeight][i] / 2 - o) / view.k));
    btn("Speech", () => add("speech", ...center()));
    btn("Thought", () => add("thought", ...center()));
    btn("Shout", () => add("shout", ...center()));
    btn("Custom", () => add("custom", ...center()));
    btn("SFX", () => add("sfx", ...center()));
    // Icons menu: a grid of standalone icons; a click drops one in the middle of the view
    const iconMenu = el("div", "position:absolute;top:52px;display:none;grid-template-columns:repeat(3, 1fr);gap:6px;padding:8px;background:#1d1d1d;border:1px solid #555;border-radius:4px;z-index:1;");
    for (const [k, label] of ICON_KINDS) {
        const it = el("button", BTN + "display:flex;align-items:center;gap:8px;height:40px;padding:0 10px;");
        it.append(iconCanvas(k, 26), el("span", "font:14px sans-serif;color:#eee;", label));
        it.onclick = () => {
            iconMenu.style.display = "none";
            add("icon", ...center(), k);
        };
        iconMenu.append(it);
    }
    const iconMenuBtn = btn("Icons ▾", () => {
        if (iconMenu.style.display === "grid") return (iconMenu.style.display = "none");
        iconMenu.style.left = `${iconMenuBtn.getBoundingClientRect().left}px`;
        iconMenu.style.display = "grid";
    });
    overlay.addEventListener("pointerdown", (e) => {
        if (iconMenu.style.display === "grid" && !iconMenu.contains(e.target) && e.target !== iconMenuBtn) iconMenu.style.display = "none";
    });
    bar.append(el("div", "width:16px;"));
    bar.append(typeSel);
    // side panel: what <3 turns into in the selected bubble's text (♡ is always outlined, ♥ always filled)
    const heartBox = el("div", "display:none;align-items:center;gap:8px;");
    const heartBtns = {};
    heartBox.append(el("span", LABEL + "width:84px;", "<3 in text"));
    for (const [mode, label] of [["outline", "♡ Outline"], ["fill", "♥ Filled"]]) {
        heartBtns[mode] = btn(label, () => {
            const b = bubbles[sel];
            if (!b || b.type === "sfx" || b.type === "icon") return;
            b.heart = mode;
            lastHeart = mode;
            sync();
        }, heartBox);
    }
    const smoothBtn = btn("Smooth", () => {
        const b = bubbles[sel];
        if (b?.type !== "custom") return;
        b.smooth = !(b.smooth ?? true);
        sync();
    });
    const fontBtn = btn("", () => togglePicker());
    fontBtn.style.cssText += "max-width:260px;overflow:hidden;text-overflow:ellipsis;";

    // font picker: each row shows a sample in its own font, loaded when the row scrolls into view
    const picker = el("div", "position:absolute;top:52px;width:440px;max-height:70vh;display:none;flex-direction:column;background:#1d1d1d;border:1px solid #555;border-radius:4px;z-index:1;");
    const filter = el("input", "margin:8px;height:32px;padding:0 8px;font:15px sans-serif;color:#eee;background:#262626;border:1px solid #555;border-radius:4px;");
    filter.placeholder = "Filter";
    const list = el("div", "overflow-y:auto;min-height:0;");
    picker.append(filter, list);
    const rows = [];
    const seen = new IntersectionObserver((entries) => {
        for (const en of entries) {
            if (!en.isIntersecting) continue;
            const r = en.target;
            seen.unobserve(r);
            loadFont(r.dataset.font).then((ok) => ok && (r.firstChild.style.fontFamily = `"${famOf(r.dataset.font)}"`));
        }
    }, { root: list });
    for (const name of fontNames) {
        const r = el("div", "display:flex;align-items:center;gap:14px;height:46px;padding:0 12px;cursor:pointer;white-space:nowrap;");
        r.dataset.font = name;
        r.append(el("span", "width:110px;flex:none;font-size:26px;color:#eee;overflow:hidden;", "Aa Bb"),
            el("span", "font:14px sans-serif;color:#bbb;overflow:hidden;text-overflow:ellipsis;", name));
        r.onmouseenter = () => r.dataset.font !== curFont() && (r.style.background = "#2a2a2a");
        r.onmouseleave = () => r.dataset.font !== curFont() && (r.style.background = "");
        r.onclick = () => setFont(name);
        list.append(r);
        rows.push(r);
    }
    filter.oninput = () => {
        const q = filter.value.toLowerCase();
        for (const r of rows) r.style.display = r.dataset.font.toLowerCase().includes(q) ? "flex" : "none";
    };
    const curFont = () => (sel >= 0 ? bubbles[sel].font : lastFont);
    const togglePicker = () => {
        if (picker.style.display === "flex") return (picker.style.display = "none");
        picker.style.left = `${fontBtn.getBoundingClientRect().left}px`;
        picker.style.display = "flex";
        for (const r of rows) r.style.background = r.dataset.font === curFont() ? ON : "";
        for (const r of rows) seen.observe(r);
        rows.find((r) => r.dataset.font === curFont())?.scrollIntoView({ block: "center" });
        filter.focus();
    };
    const setFont = (name) => {
        lastFont = name;
        if (sel >= 0) bubbles[sel].font = name;
        fontBtn.textContent = name;
        picker.style.display = "none";
        loadFont(name).then(() => draw());
    };
    overlay.addEventListener("pointerdown", (e) => {
        if (picker.style.display === "flex" && !picker.contains(e.target) && e.target !== fontBtn) picker.style.display = "none";
    });

    const sizeDown = btn("A−", () => resize(1 / 1.1));
    const sizeUp = btn("A+", () => resize(1.1));
    btn("Delete", () => del());
    bar.append(el("div", "flex:1;"));
    btn("Cancel", () => close(false));
    btn("Done", () => close(true)).style.background = ON;

    // ---- sound effect panel (side), shown while an SFX is selected
    const sfxBox = el("div", "display:none;flex-direction:column;gap:6px;");
    const presetSel = el("select", BTN);
    presetSel.append(new Option("Preset", ""));
    for (const k of Object.keys(SFX_PRESETS)) presetSel.append(new Option(k, k));
    presetSel.onchange = () => {
        const b = bubbles[sel];
        if (b?.type === "sfx" && SFX_PRESETS[presetSel.value]) Object.assign(b, SFX_PRESETS[presetSel.value]);
        presetSel.value = "";
        sync();
    };
    sfxBox.append(presetSel);
    const sfxCtl = {};
    const row = (label, ...kids) => {
        const r = el("div", "display:flex;align-items:center;gap:8px;");
        r.append(el("span", LABEL + "width:84px;", label), ...kids);
        sfxBox.append(r);
    };
    const colorIn = (key) => {
        const c = el("input", "width:44px;height:28px;border:none;background:none;padding:0;cursor:pointer;");
        c.type = "color";
        c.oninput = () => setSfx(key, c.value);
        sfxCtl[key] = c;
        return c;
    };
    const slider = (key, min, max) => {
        const s = el("input", "flex:1;");
        s.type = "range";
        s.min = min;
        s.max = max;
        s.step = 0.005;
        s.oninput = () => setSfx(key, parseFloat(s.value));
        sfxCtl[key] = s;
        return s;
    };
    row("Fill", colorIn("color"));
    row("Outline", colorIn("ocolor"), slider("ow", 0, 0.25));
    row("Outer", colorIn("o2color"), slider("o2w", 0, 0.25));
    row("Shadow", colorIn("scolor"));
    row("Shadow X", slider("sx", -0.3, 0.3));
    row("Shadow Y", slider("sy", -0.3, 0.3));
    row("Shake", slider("shake", 0, 1));
    row("Grow", slider("grow", 0, 2));
    // decorations: kinds on/off, amount, size, colours; any change lays them out again
    const kindBtns = {};
    const kindRow = el("div", "display:flex;flex-wrap:wrap;gap:6px;");
    for (const [k, label] of DECO_KINDS) {
        const kb = el("button", BTN + "height:34px;padding:0 8px;");
        kb.title = label;
        kb.append(iconCanvas(k));
        kb.onclick = () => {
            const b = bubbles[sel];
            if (b?.type !== "sfx") return;
            b.kinds = { ...(b.kinds || {}), [k]: !(b.kinds || {})[k] };
            lastSfx.kinds = { ...b.kinds };
            relayout(b);
        };
        kindBtns[k] = kb;
        kindRow.append(kb);
    }
    sfxBox.append(kindRow);
    row("Amount", slider("amount", 1, 16));
    sfxCtl.amount.step = 1;
    row("Deco size", slider("dsize", 0.3, 2.5));
    row("Hearts", colorIn("dcolor"), colorIn("docolor"));
    btn("Shuffle", () => {
        const b = bubbles[sel];
        if (b?.type !== "sfx") return;
        b.dseed = Math.floor(Math.random() * 1e9);
        relayout(b);
    }, sfxBox);
    // ---- item list (side, under the text): every bubble, effect and icon; click a row to select it
    const itemList = el("div", "flex:0 1 auto;max-height:38%;min-height:60px;overflow-y:auto;display:flex;flex-direction:column;gap:2px;background:#262626;border:1px solid #555;border-radius:4px;padding:4px;");
    const iconName = Object.fromEntries(ICON_KINDS);
    const itemLabel = (b) => {
        if (b.type === "icon") return iconName[b.kind] || b.kind;
        const t = String(b.text || "").replace(/\s+/g, " ").trim();
        const kind = b.type === "sfx" ? "SFX" : b.type[0].toUpperCase() + b.type.slice(1);
        return `${kind}: ${t || "—"}`;
    };
    const renderList = () => {
        itemList.replaceChildren(...bubbles.map((b, i) => {
            const r = el("div", `display:flex;align-items:center;gap:8px;height:30px;flex:none;padding:0 8px;border-radius:3px;cursor:pointer;white-space:nowrap;overflow:hidden;font:14px sans-serif;color:#eee;background:${i === sel ? ON : "transparent"};`);
            if (b.type === "icon") r.append(iconCanvas(b.kind, 20));
            r.append(el("span", "overflow:hidden;text-overflow:ellipsis;", itemLabel(b)));
            r.onclick = () => {
                sel = i;
                selPt = null;
                selDeco = -1;
                sync();
            };
            return r;
        }));
        itemList.children[sel]?.scrollIntoView({ block: "nearest" });
    };

    // ---- icon panel (side), shown while a standalone icon is selected
    const iconBox = el("div", "display:none;flex-direction:column;gap:6px;");
    const iconCtl = {};
    for (const [key, label, i] of [["dcolor", "Fill", 0], ["docolor", "Outline", 1]]) {
        const r = el("div", "display:flex;align-items:center;gap:8px;");
        const c = el("input", "width:44px;height:28px;border:none;background:none;padding:0;cursor:pointer;");
        c.type = "color";
        c.oninput = () => {
            const b = bubbles[sel];
            if (b?.type !== "icon") return;
            b[key] = c.value;
            draw();
        };
        iconCtl[key] = [c, i];
        r.append(el("span", LABEL + "width:84px;", label), c);
        iconBox.append(r);
    }
    btn("Default colours", () => {
        const b = bubbles[sel];
        if (b?.type !== "icon") return;
        delete b.dcolor;
        delete b.docolor;
        sync();
    }, iconBox);
    const relayout = (b) => {
        b.deco = genDeco(b, W, H);
        selDeco = -1;
        sync();
    };
    const setSfx = (key, v) => {
        const b = bubbles[sel];
        if (b?.type !== "sfx") return;
        b[key] = v;
        lastSfx[key] = v;
        if (key === "amount" || key === "dsize") return relayout(b);
        draw();
    };

    const resize = (f) => {
        const b = bubbles[sel];
        if (!b) return;
        if (b.type === "icon") {
            b.s = Math.min(1, Math.max(0.003, b.s * f));
            draw();
            return;
        }
        if (b.type === "sfx") { // letters follow the shape, so scale the whole effect (and its decorations) around its centre
            const reg = sfxRegion(b, 1, 1), xs = reg.map((p) => p[0]), ys = reg.map((p) => p[1]);
            const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
            const sc = (arr) => arr.map(([x, y]) => [cx + (x - cx) * f, cy + (y - cy) * f]);
            b.top = sc(b.top);
            b.bottom = sc(b.bottom);
            (b.deco || []).forEach((d) => {
                d.x = cx + (d.x - cx) * f;
                d.y = cy + (d.y - cy) * f;
                d.s *= f;
            });
            draw();
            return;
        }
        b.size = Math.min(0.2, Math.max(0.004, (b.size ?? 0.018) * f));
        lastSize = b.size;
        draw();
    };
    const del = () => {
        const b = bubbles[sel];
        if (!b) return;
        if (b.type === "sfx" && selDeco >= 0) { // remove one decoration
            b.deco.splice(selDeco, 1);
            selDeco = -1;
            draw();
            return;
        }
        if (selPt) { // remove a point, keeping the shape valid
            const arr = b[selPt.list];
            const keepEnds = selPt.list !== "pts";
            const min = selPt.list === "pts" ? 3 : 2;
            if (arr.length > min && !(keepEnds && (selPt.i === 0 || selPt.i === arr.length - 1))) arr.splice(selPt.i, 1);
            selPt = null;
            draw();
            return;
        }
        bubbles.splice(sel, 1);
        sel = bubbles.length - 1;
        sync();
    };
    typeSel.onchange = () => {
        const b = bubbles[sel];
        if (!b || b.type === "custom" || b.type === "sfx" || b.type === "icon") return;
        b.type = typeSel.value;
        lastType = typeSel.value;
        draw();
    };
    text.oninput = () => {
        if (sel < 0 || bubbles[sel].type === "icon") return;
        bubbles[sel].text = text.value;
        draw();
        const row = itemList.children[sel]?.lastChild;
        if (row) row.textContent = itemLabel(bubbles[sel]);
    };
    const sync = () => {
        const b = bubbles[sel];
        const icon = b?.type === "icon";
        const shaped = b && (b.type === "custom" || b.type === "sfx" || icon);
        text.disabled = !b || icon;
        typeSel.disabled = !b || shaped;
        text.value = b && !icon ? b.text : "";
        if (b && !shaped) typeSel.value = b.type;
        smoothBtn.style.display = b?.type === "custom" ? "" : "none";
        heartBox.style.display = b && b.type !== "sfx" && !icon ? "flex" : "none";
        for (const [mode, hb] of Object.entries(heartBtns)) hb.style.background = (b?.heart || "outline") === mode ? ON : "#333";
        iconBox.style.display = icon ? "flex" : "none";
        if (icon) for (const [k, [c, i]] of Object.entries(iconCtl)) c.value = decoColours(b, b.kind)[i];
        renderList();
        smoothBtn.style.background = b?.type === "custom" && (b.smooth ?? true) ? ON : "#333";
        sizeDown.disabled = sizeUp.disabled = !b;
        sizeDown.style.opacity = sizeUp.style.opacity = b ? "" : "0.4";
        sfxBox.style.display = b?.type === "sfx" ? "flex" : "none";
        if (b?.type === "sfx") {
            for (const [k, c] of Object.entries(sfxCtl)) c.value = b[k] ?? SFX_PRESETS.Classic[k] ?? SFX_EXTRA[k];
            for (const [k, kb] of Object.entries(kindBtns)) kb.style.background = (b.kinds || {})[k] ? ON : "#333";
        }
        fontBtn.textContent = b ? b.font : lastFont;
        if (b) lastFont = b.font;
        draw();
    };

    // ---- drawing
    const view = { k: 1, ox: 0, oy: 0 };
    const ctx = canvas.getContext("2d");
    const handle = (x, y, on) => {
        const px = 1 / view.k;
        ctx.beginPath();
        ctx.arc(x, y, 7 * px, 0, Math.PI * 2);
        ctx.fillStyle = on ? "#ff5533" : "#2ec4ff";
        ctx.fill();
    };
    const pathOf = (poly) => {
        ctx.beginPath();
        poly.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
        ctx.closePath();
    };
    // redraws are coalesced to one per frame, so sliders and colour pickers don't queue up full renders
    let drawPending = false;
    const draw = () => {
        if (drawPending) return;
        drawPending = true;
        requestAnimationFrame(() => {
            drawPending = false;
            drawNow();
        });
    };
    let bgCache = null; // the page scaled to screen size once, instead of the full-size page every frame
    const drawNow = () => {
        const dpr = window.devicePixelRatio || 1;
        const cw = wrapC.clientWidth, ch = wrapC.clientHeight;
        if (canvas.width !== Math.round(cw * dpr) || canvas.height !== Math.round(ch * dpr)) {
            canvas.width = Math.round(cw * dpr);
            canvas.height = Math.round(ch * dpr);
        }
        view.k = Math.min((cw - 24) / W, (ch - 24) / H);
        view.ox = (cw - W * view.k) / 2;
        view.oy = (ch - H * view.k) / 2;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.fillStyle = "#111";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        const bw = Math.max(1, Math.round(W * view.k * dpr)), bh = Math.max(1, Math.round(H * view.k * dpr));
        if (!bgCache || bgCache.width !== bw || bgCache.height !== bh) {
            bgCache = document.createElement("canvas");
            bgCache.width = bw;
            bgCache.height = bh;
            const g = bgCache.getContext("2d");
            g.imageSmoothingQuality = "high";
            g.drawImage(img, 0, 0, bw, bh);
        }
        ctx.drawImage(bgCache, Math.round(dpr * view.ox), Math.round(dpr * view.oy));
        ctx.setTransform(dpr * view.k, 0, 0, dpr * view.k, dpr * view.ox, dpr * view.oy);
        const px = 1 / view.k;
        bubbles.forEach((b, i) => {
            if (b.type === "sfx") { // the box only shows in the editor: tinted while selected, dashed otherwise
                pathOf(sfxRegion(b, W, H));
                if (i === sel) {
                    ctx.fillStyle = "rgba(46,196,255,0.28)";
                    ctx.fill();
                } else {
                    ctx.setLineDash([6 * px, 4 * px]);
                    ctx.lineWidth = 1.5 * px;
                    ctx.strokeStyle = "rgba(46,196,255,0.7)";
                    ctx.stroke();
                    ctx.setLineDash([]);
                }
            }
            drawBubble(ctx, b, W, H, famOf(b.font));
        });
        const b = bubbles[sel];
        if (!b) return;
        ctx.lineWidth = 2 * px;
        ctx.strokeStyle = "#2ec4ff";
        const boxed = b.type === "custom" || b.type === "sfx" || b.type === "icon";
        if (boxed) { // scale box: drag the corner square to scale the whole shape
            const [x0, y0, x1, y1] = scaleBox(b);
            ctx.save();
            ctx.globalAlpha = 0.5;
            ctx.setLineDash([3 * px, 5 * px]);
            ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
            ctx.restore();
            ctx.fillStyle = "#2ec4ff";
            ctx.fillRect(x1 - 7 * px, y1 - 7 * px, 14 * px, 14 * px);
            ctx.fillRect(x1 - 4 * px, (y0 + y1) / 2 - 9 * px, 8 * px, 18 * px); // width only
            ctx.fillRect((x0 + x1) / 2 - 9 * px, y1 - 4 * px, 18 * px, 8 * px); // height only
        }
        if (b.type === "custom") {
            ctx.setLineDash([6 * px, 4 * px]);
            pathOf(customPts(b, W, H));
            ctx.stroke();
            ctx.setLineDash([]);
            customPts(b, W, H).forEach(([x, y], j) => handle(x, y, selPt?.list === "pts" && selPt.i === j));
        } else if (b.type === "sfx") {
            pathOf(sfxRegion(b, W, H));
            ctx.stroke();
            const [t, bt] = sfxPts(b, W, H);
            t.forEach(([x, y], j) => handle(x, y, selPt?.list === "top" && selPt.i === j));
            bt.forEach(([x, y], j) => handle(x, y, selPt?.list === "bottom" && selPt.i === j));
            (b.deco || []).forEach((d, j) => { // decoration handles: small squares
                ctx.fillStyle = j === selDeco ? "#ff5533" : "#ffcc33";
                ctx.fillRect(d.x * W - 6 * px, d.y * H - 6 * px, 12 * px, 12 * px);
            });
        } else if (b.type !== "icon") {
            const cx = b.cx * W, cy = b.cy * H, rx = b.rx * W, ry = b.ry * H;
            ctx.save(); // the box and size square turn with the bubble
            ctx.translate(cx, cy);
            ctx.rotate(b.rot || 0);
            ctx.translate(-cx, -cy);
            ctx.setLineDash([6 * px, 4 * px]);
            ctx.strokeRect(cx - rx, cy - ry, 2 * rx, 2 * ry);
            ctx.setLineDash([]);
            ctx.fillStyle = "#2ec4ff";
            ctx.fillRect(cx + rx - 7 * px, cy + ry - 7 * px, 14 * px, 14 * px);
            ctx.restore();
            ctx.beginPath();
            ctx.arc(b.tx * W, b.ty * H, 8 * px, 0, Math.PI * 2);
            ctx.fill();
        }
        const [hx, hy, ax, ay] = rotHandle(b); // turn handle: a round knob on a stem above the bubble
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(hx, hy);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(hx, hy, 8 * px, 0, Math.PI * 2);
        ctx.fillStyle = "#111";
        ctx.fill();
        ctx.lineWidth = 2.5 * px;
        ctx.stroke();
    };

    // ---- mouse
    const toImg = (e) => {
        const r = canvas.getBoundingClientRect();
        return [(e.clientX - r.left - view.ox) / view.k, (e.clientY - r.top - view.oy) / view.k];
    };
    const inside = (b, x, y) => {
        if (b.type === "custom") return inPoly(x, y, customOutline(b, W, H));
        if (b.type === "sfx") return inPoly(x, y, sfxRegion(b, W, H));
        if (b.type === "icon") return inPoly(x, y, iconBox4(b));
        [x, y] = rotAbout([x, y], [b.cx * W, b.cy * H], -(b.rot || 0));
        const u = (x - b.cx * W) / (b.rx * W), v = (y - b.cy * H) / (b.ry * H);
        return u * u + v * v <= 1;
    };
    // an icon's (turned, stretched) box corners in image pixels
    const iconBox4 = (b) => placeShape(b, [[-0.55, -0.55], [0.55, -0.55], [0.55, 0.55], [-0.55, 0.55]], W, H);
    // the point a bubble turns around, and its turn handle [knob x, knob y, stem x, stem y] (image pixels)
    const rotPivot = (b) => {
        if (b.type === "icon") return [b.x * W, b.y * H];
        if (b.type === "sfx") {
            const reg = sfxRegion(b, W, H), xs = reg.map((p) => p[0]), ys = reg.map((p) => p[1]);
            return [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
        }
        return pivotOf(b, W, H);
    };
    const rotHandle = (b) => {
        const stem = 32 / view.k;
        if (b.type === "custom" || b.type === "sfx" || b.type === "icon") {
            const [x0, y0, x1] = scaleBox(b), mx = (x0 + x1) / 2;
            return [mx, y0 - stem, mx, y0];
        }
        const c = [b.cx * W, b.cy * H], top = b.cy * H - b.ry * H, a = b.rot || 0;
        return [...rotAbout([c[0], top - stem], c, a), ...rotAbout([c[0], top], c, a)];
    };
    // points and edges of the selected custom bubble / sound effect
    const pointHit = (b, x, y) => {
        const px = 1 / view.k, near = (p) => Math.hypot(x - p[0], y - p[1]) <= 11 * px;
        if (b.type === "custom") {
            const i = customPts(b, W, H).findIndex(near);
            return i >= 0 ? { list: "pts", i } : null;
        }
        if (b.type === "sfx") {
            const [t, bt] = sfxPts(b, W, H);
            let i = t.findIndex(near);
            if (i >= 0) return { list: "top", i };
            i = bt.findIndex(near);
            return i >= 0 ? { list: "bottom", i } : null;
        }
        return null;
    };
    const edgeHit = (b, x, y) => { // where a click on an edge inserts a new point
        const px = 1 / view.k, lim = 10 * px;
        if (b.type === "custom") {
            const p = customPts(b, W, H), out = customOutline(b, W, H);
            let best = Infinity, at = -1;
            p.forEach((a, j) => {
                const d = segDist([x, y], a, p[(j + 1) % p.length]);
                if (d < best) [best, at] = [d, j + 1];
            });
            const onCurve = out.some((a, j) => segDist([x, y], a, out[(j + 1) % out.length]) <= lim);
            return best <= lim || onCurve ? { list: "pts", i: at } : null;
        }
        if (b.type === "sfx") {
            const [t, bt] = sfxPts(b, W, H);
            for (const [name, arr] of [["top", t], ["bottom", bt]]) {
                for (let j = 0; j < arr.length - 1; j++) if (segDist([x, y], arr[j], arr[j + 1]) <= lim) return { list: name, i: j + 1 };
            }
        }
        return null;
    };
    const decoHit = (b, x, y) => {
        if (b?.type !== "sfx") return -1;
        const px = 1 / view.k, d = b.deco || [];
        for (let j = d.length - 1; j >= 0; j--) {
            if (Math.hypot(x - d[j].x * W, y - d[j].y * H) <= Math.max(10 * px, 0.45 * d[j].s * H)) return j;
        }
        return -1;
    };
    // padded bounding box of a custom bubble / sound effect, in image pixels
    const scaleBox = (b) => {
        const pad = 14 / view.k, out = b.type === "custom" ? customOutline(b, W, H) : b.type === "icon" ? iconBox4(b) : sfxRegion(b, W, H);
        const xs = out.map((p) => p[0]), ys = out.map((p) => p[1]);
        return [Math.min(...xs) - pad, Math.min(...ys) - pad, Math.max(...xs) + pad, Math.max(...ys) + pad];
    };
    const hit = (x, y) => {
        const px = 1 / view.k, b = bubbles[sel];
        if (b) {
            const [hx, hy] = rotHandle(b);
            if (Math.hypot(x - hx, y - hy) <= 11 * px) return { i: sel, mode: "rotate" };
        }
        if (b && (b.type === "custom" || b.type === "sfx" || b.type === "icon")) {
            const [x0, y0, x1, y1] = scaleBox(b), near = (hx, hy) => Math.abs(x - hx) <= 10 * px && Math.abs(y - hy) <= 10 * px;
            if (near(x1, y1)) return { i: sel, mode: "scale" };
            if (near(x1, (y0 + y1) / 2)) return { i: sel, mode: "scaleX" };
            if (near((x0 + x1) / 2, y1)) return { i: sel, mode: "scaleY" };
        }
        if (b) {
            const dj = decoHit(b, x, y);
            if (dj >= 0) return { i: sel, mode: "deco", j: dj };
            const p = pointHit(b, x, y);
            if (p) return { i: sel, mode: "point", pt: p };
            const e = edgeHit(b, x, y);
            if (e) return { i: sel, mode: "insert", pt: e };
            if (b.type !== "custom" && b.type !== "sfx" && b.type !== "icon") {
                if (Math.hypot(x - b.tx * W, y - b.ty * H) <= 12 * px) return { i: sel, mode: "tail" };
                const [sx, sy] = rotAbout([(b.cx + b.rx) * W, (b.cy + b.ry) * H], [b.cx * W, b.cy * H], b.rot || 0);
                if (Math.abs(x - sx) <= 10 * px && Math.abs(y - sy) <= 10 * px) return { i: sel, mode: "size" };
            }
        }
        for (let i = bubbles.length - 1; i >= 0; i--) if (inside(bubbles[i], x, y)) return { i, mode: "move" };
        return null;
    };
    const shift = (b, dx, dy, from) => { // move a whole bubble by (dx, dy) page fractions from its drag-start copy
        if (b.type === "custom") b.pts = from.pts.map(([x, y]) => [x + dx, y + dy]);
        else if (b.type === "icon") {
            b.x = from.x + dx;
            b.y = from.y + dy;
        } else if (b.type === "sfx") {
            b.top = from.top.map(([x, y]) => [x + dx, y + dy]);
            b.bottom = from.bottom.map(([x, y]) => [x + dx, y + dy]);
        } else {
            b.cx = from.cx + dx;
            b.cy = from.cy + dy;
        }
    };
    let drag = null;
    canvas.onpointerdown = (e) => {
        if (document.activeElement !== overlay) overlay.focus(); // keys (Delete, Ctrl+C / V) go to the page again after typing
        const [x, y] = toImg(e);
        const h = hit(x, y);
        if (!h) {
            sel = -1;
            selPt = null;
            selDeco = -1;
            sync();
            return;
        }
        if (h.i !== sel) {
            sel = h.i;
            selPt = null;
            selDeco = -1;
            sync();
        }
        selDeco = h.mode === "deco" ? h.j : -1;
        const b = bubbles[sel];
        if (h.mode === "insert") {
            b[h.pt.list].splice(h.pt.i, 0, [x / W, y / H]);
            h.mode = "point";
        }
        selPt = h.mode === "point" ? h.pt : null;
        drag = { ...h, x, y, from: JSON.parse(JSON.stringify(b)) };
        if (h.mode === "rotate") { // turn around the pivot by the knob's angle change
            drag.c = rotPivot(b);
            drag.a0 = Math.atan2(y - drag.c[1], x - drag.c[0]);
        }
        if (h.mode.startsWith("scale")) { // scale around the shape's centre, by the handle's distance from it
            const [x0, y0, x1, y1] = scaleBox(b);
            drag.c = [(x0 + x1) / 2, (y0 + y1) / 2];
            drag.d0 = Math.max(1, Math.hypot(x - drag.c[0], y - drag.c[1]));
            drag.dx0 = Math.max(1, Math.abs(x - drag.c[0]));
            drag.dy0 = Math.max(1, Math.abs(y - drag.c[1]));
        }
        canvas.setPointerCapture(e.pointerId);
        draw();
    };
    canvas.onpointermove = (e) => {
        const [x, y] = toImg(e);
        if (!drag) {
            const h = hit(x, y);
            canvas.style.cursor = !h ? "default" : h.mode === "move" ? "move" : h.mode === "size" || h.mode === "scale" ? "nwse-resize" : h.mode === "scaleX" ? "ew-resize" : h.mode === "scaleY" ? "ns-resize" : h.mode === "rotate" ? "grab" : h.mode === "insert" ? "copy" : "crosshair";
            return;
        }
        const b = bubbles[drag.i];
        if (drag.mode === "deco") {
            const d0 = drag.from.deco[drag.j];
            b.deco[drag.j].x = d0.x + (x - drag.x) / W;
            b.deco[drag.j].y = d0.y + (y - drag.y) / H;
        } else if (drag.mode === "move") {
            shift(b, (x - drag.x) / W, (y - drag.y) / H, drag.from);
            (b.deco || []).forEach((d, j) => { // decorations travel with their effect
                d.x = drag.from.deco[j].x + (x - drag.x) / W;
                d.y = drag.from.deco[j].y + (y - drag.y) / H;
            });
        }
        else if (drag.mode.startsWith("scale")) {
            // corner: whole shape, text and decorations keep their form; side handles: width or height only,
            // text and decoration sizes stay (custom text re-wraps to the new width)
            const uni = drag.mode === "scale";
            const s = Math.max(0.05, Math.hypot(x - drag.c[0], y - drag.c[1]) / drag.d0);
            const sx = uni ? s : drag.mode === "scaleX" ? Math.max(0.05, Math.abs(x - drag.c[0]) / drag.dx0) : 1;
            const sy = uni ? s : drag.mode === "scaleY" ? Math.max(0.05, Math.abs(y - drag.c[1]) / drag.dy0) : 1;
            const cx = drag.c[0] / W, cy = drag.c[1] / H, f = drag.from;
            const sc = (arr) => arr.map(([px, py]) => [cx + (px - cx) * sx, cy + (py - cy) * sy]);
            if (b.type === "icon") { // corner: size; side bars: the icon's own width / height
                if (uni) b.s = Math.min(1, Math.max(0.003, f.s * s));
                else {
                    b.kx = Math.max(0.05, (f.kx ?? 1) * sx);
                    b.ky = Math.max(0.05, (f.ky ?? 1) * sy);
                }
            } else if (b.type === "custom") {
                b.pts = sc(f.pts);
                if (uni) {
                    b.size = Math.min(0.2, Math.max(0.004, (f.size ?? 0.018) * s));
                    lastSize = b.size;
                }
            } else {
                b.top = sc(f.top);
                b.bottom = sc(f.bottom);
                (b.deco || []).forEach((d, j) => {
                    const d0 = f.deco[j];
                    d.x = cx + (d0.x - cx) * sx;
                    d.y = cy + (d0.y - cy) * sy;
                    d.s = uni ? d0.s * s : d0.s;
                });
            }
        }
        else if (drag.mode === "rotate") { // Shift: 15° steps
            let da = Math.atan2(y - drag.c[1], x - drag.c[0]) - drag.a0;
            if (e.shiftKey) da = Math.round(da / (Math.PI / 12)) * (Math.PI / 12);
            const f = drag.from, c = drag.c;
            const turn = ([px, py]) => {
                const [qx, qy] = rotAbout([px * W, py * H], c, da);
                return [qx / W, qy / H];
            };
            const norm = (a) => Math.atan2(Math.sin(a), Math.cos(a));
            if (b.type === "icon") b.r = norm((f.r ?? 0) + da);
            else if (b.type === "sfx") {
                b.top = f.top.map(turn);
                b.bottom = f.bottom.map(turn);
                (b.deco || []).forEach((d, j) => {
                    [d.x, d.y] = turn([f.deco[j].x, f.deco[j].y]);
                    d.r = norm((f.deco[j].r ?? 0) + da);
                });
            } else {
                b.rot = norm((f.rot || 0) + da);
                if (b.type === "custom") b.pts = f.pts.map(turn);
                else [b.tx, b.ty] = turn([f.tx, f.ty]);
            }
        }
        else if (drag.mode === "point") b[drag.pt.list][drag.pt.i] = [x / W, y / H];
        else if (drag.mode === "size") { // measured along the bubble's own (turned) axes
            const [lx, ly] = rotAbout([x, y], [b.cx * W, b.cy * H], -(b.rot || 0));
            b.rx = Math.max(20, Math.abs(lx - b.cx * W)) / W;
            b.ry = Math.max(20, Math.abs(ly - b.cy * H)) / H;
        } else {
            b.tx = x / W;
            b.ty = y / H;
        }
        draw();
    };
    canvas.onpointerup = () => (drag = null);
    canvas.addEventListener("wheel", (e) => { // scroll over a decoration to size it
        const b = bubbles[sel];
        const [x, y] = toImg(e);
        const j = decoHit(b, x, y);
        if (j < 0) return;
        e.preventDefault();
        selDeco = j;
        b.deco[j].s = Math.max(0.002, b.deco[j].s * Math.exp(-e.deltaY * 0.0015));
        draw();
    }, { passive: false });
    canvas.ondblclick = (e) => {
        const [x, y] = toImg(e);
        if (!hit(x, y)) add(lastType, x, y);
        else text.focus();
    };

    // keys stay inside the editor
    const onKey = (e) => {
        e.stopPropagation();
        if (["TEXTAREA", "INPUT", "SELECT"].includes(e.target.tagName)) return;
        if (e.key === "Delete" || e.key === "Backspace") {
            del();
            e.preventDefault();
        }
        const k = e.key.toLowerCase();
        if ((e.ctrlKey || e.metaKey) && k === "c" && bubbles[sel]) { // copy the selected item
            sbClipboard = JSON.parse(JSON.stringify(bubbles[sel]));
            e.preventDefault();
        }
        if ((e.ctrlKey || e.metaKey) && k === "v" && sbClipboard) { // paste a copy, nudged so it doesn't hide the original
            const b = JSON.parse(JSON.stringify(sbClipboard));
            const d = 0.03 * Math.min(W, H);
            nudge(b, d / W, d / H);
            bubbles.push(b);
            sbClipboard = JSON.parse(JSON.stringify(b)); // the next paste steps on again
            sel = bubbles.length - 1;
            selPt = null;
            selDeco = -1;
            sync();
            e.preventDefault();
        }
    };
    const nudge = (b, dx, dy) => { // move any item by page fractions (tail, points, decorations included)
        const mv = ([x, y]) => [x + dx, y + dy];
        if (b.type === "custom") b.pts = b.pts.map(mv);
        else if (b.type === "sfx") {
            b.top = b.top.map(mv);
            b.bottom = b.bottom.map(mv);
            (b.deco || []).forEach((d) => { d.x += dx; d.y += dy; });
        } else if (b.type === "icon") {
            b.x += dx;
            b.y += dy;
        } else {
            b.cx += dx;
            b.cy += dy;
            b.tx += dx;
            b.ty += dy;
        }
    };
    overlay.addEventListener("keydown", onKey);
    overlay.addEventListener("keyup", (e) => e.stopPropagation());
    overlay.tabIndex = -1;
    const onResize = () => draw();
    window.addEventListener("resize", onResize);

    const close = (save) => {
        if (save) {
            drawNow(); // refresh wrapped lines
            const r = (v) => Math.round(v * 1e5) / 1e5;
            const rp = (arr) => arr.map(([x, y]) => [r(x), r(y)]);
            const target = liveNode(node);
            const dataWLive = target.widgets.find((w) => w.name === "bubbles");
            dataWLive.value = JSON.stringify(bubbles.map((b) => {
                if (b.type === "icon") {
                    const o = { type: b.type, kind: b.kind, x: r(b.x), y: r(b.y), s: r(b.s), kx: r(b.kx ?? 1), ky: r(b.ky ?? 1), r: r(b.r ?? 0) };
                    if (b.dcolor) o.dcolor = b.dcolor;
                    if (b.docolor) o.docolor = b.docolor;
                    return o;
                }
                if (b.type === "custom") return { type: b.type, pts: rp(b.pts), smooth: b.smooth ?? true, size: r(b.size ?? 0.018), text: b.text, lines: b.lines, font: b.font, rot: r(b.rot || 0), heart: b.heart || "outline" };
                if (b.type === "sfx") {
                    const o = { type: b.type, top: rp(b.top), bottom: rp(b.bottom), text: b.text, font: b.font, seed: b.seed ?? 1, dseed: b.dseed ?? 1 };
                    for (const k of [...Object.keys(SFX_PRESETS.Classic), ...Object.keys(SFX_EXTRA)]) {
                        const v = b[k] ?? SFX_PRESETS.Classic[k] ?? SFX_EXTRA[k];
                        o[k] = typeof v === "number" ? r(v) : v;
                    }
                    o.deco = (b.deco || []).map((d) => ({ kind: d.kind, x: r(d.x), y: r(d.y), s: r(d.s), r: r(d.r ?? 0) }));
                    return o;
                }
                return {
                    type: b.type, cx: r(b.cx), cy: r(b.cy), rx: r(b.rx), ry: r(b.ry), tx: r(b.tx), ty: r(b.ty),
                    size: r(b.size), text: b.text, lines: b.lines, seed: b.seed, font: b.font, rot: r(b.rot || 0), heart: b.heart || "outline",
                };
            }));
            dataWLive.callback?.(dataWLive.value);
            backup("sb", target, dataWLive.value);
            target.setDirtyCanvas(true, true);
            app.graph?.setDirtyCanvas?.(true, true);
            track();
        }
        window.removeEventListener("resize", onResize);
        overlay.remove();
    };

    side.append(sfxBox, iconBox, heartBox, text, el("span", LABEL, "Items"), itemList);
    overlay.append(picker, iconMenu);
    document.body.append(overlay);
    overlay.focus();
    sync();
}

app.registerExtension({
    name: "SpeechBubbles.Editor",
    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name !== "SpeechBubbles") return;
        const created = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            const r = created?.apply(this, arguments);
            hideWidget(this.widgets?.find((w) => w.name === "bubbles"));
            this.addWidget("button", "Edit Bubbles", null, () => openEditor(this), { serialize: false });
            return r;
        };
        const executed = nodeType.prototype.onExecuted;
        nodeType.prototype.onExecuted = function (data) {
            executed?.apply(this, arguments);
            if (data?.bubble_bg?.[0]) {
                this.properties = this.properties || {};
                this.properties.sb_bg = data.bubble_bg[0];
                track();
            }
        };
    },
});
