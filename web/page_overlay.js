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

const BTN = "height:34px;padding:0 14px;font:600 14px sans-serif;color:#eee;background:#333;border:1px solid #555;border-radius:4px;cursor:pointer;white-space:nowrap;";
const ON = "#2d5a8a";
const HANDLE = 8; // screen px, half size

function el(tag, css, text) {
    const e = document.createElement(tag);
    if (css) e.style.cssText = css;
    if (text != null) e.textContent = text;
    return e;
}

const viewURL = (file) => {
    const i = file.lastIndexOf("/");
    return api.apiURL(`/view?filename=${encodeURIComponent(file.slice(i + 1))}&subfolder=${encodeURIComponent(file.slice(0, i))}&type=input`);
};

const imgCache = new Map();
function loadImg(file) {
    if (!imgCache.has(file)) {
        const im = new Image();
        im.src = viewURL(file);
        imgCache.set(file, im.decode().then(() => im).catch(() => null));
    }
    return imgCache.get(file);
}

async function upload(fileObj) {
    const body = new FormData();
    body.append("image", fileObj);
    body.append("subfolder", "page_overlay");
    body.append("type", "input");
    const r = await api.fetchApi("/upload/image", { method: "POST", body });
    if (r.status !== 200) throw new Error(`upload failed: ${r.status}`);
    const j = await r.json();
    return `${j.subfolder}/${j.name}`;
}

async function openEditor(node) {
    const bg = await lastUi("po", node, node.properties?.po_bg);
    if (!bg) {
        alert("Run the workflow once so the page exists.");
        return;
    }
    const page = new Image();
    page.src = api.apiURL(`/view?filename=${encodeURIComponent(bg.filename)}&subfolder=${encodeURIComponent(bg.subfolder ?? "")}&type=${bg.type}&t=${Date.now()}`);
    try {
        await page.decode();
    } catch {
        alert("Run the workflow once so the page exists.");
        return;
    }
    const W = page.naturalWidth, H = page.naturalHeight;
    const dataW = node.widgets.find((w) => w.name === "overlays");
    let items;
    try {
        items = JSON.parse(dataW.value || "[]");
    } catch {
        items = [];
    }
    const loaded = new Map(); // file -> Image
    await Promise.all(items.map(async (it) => loaded.set(it.file, await loadImg(it.file))));
    let sel = items.length - 1;
    let lock = true;
    let cropMode = false;
    let selPt = -1;

    // ---- layout
    const overlay = el("div", "position:fixed;inset:0;z-index:10000;background:#111;display:flex;flex-direction:column;");
    const bar = el("div", "display:flex;gap:8px;align-items:center;padding:8px;background:#1d1d1d;border-bottom:1px solid #333;");
    const body = el("div", "flex:1;display:flex;min-height:0;");
    const wrapC = el("div", "flex:1;position:relative;min-width:0;");
    const canvas = el("canvas", "position:absolute;inset:0;width:100%;height:100%;");
    const side = el("div", "width:320px;display:flex;flex-direction:column;gap:8px;padding:8px;background:#1d1d1d;border-left:1px solid #333;");
    const lib = el("div", "flex:1;overflow-y:auto;display:grid;grid-template-columns:1fr 1fr;gap:8px;align-content:start;");
    const picker = el("input");
    picker.type = "file";
    picker.accept = "image/png,image/webp,image/jpeg";
    picker.multiple = true;
    picker.style.display = "none";
    wrapC.append(canvas);
    body.append(wrapC, side);
    overlay.append(bar, body, picker);

    const btn = (label, fn, parent = bar) => {
        const b = el("button", BTN, label);
        b.onclick = fn;
        parent.append(b);
        return b;
    };
    const lockBtn = btn("Lock ratio", () => {
        lock = !lock;
        lockBtn.style.background = lock ? ON : "#333";
    });
    lockBtn.style.background = ON;
    btn("Delete", () => del());
    const cropBtn = btn("Crop", () => setCrop(!cropMode));
    btn("Clear crop", () => {
        if (!items[sel]) return;
        delete items[sel].crop;
        selPt = -1;
        draw();
    });
    const setCrop = (on) => {
        cropMode = on && !!items[sel];
        cropBtn.style.background = cropMode ? ON : "#333";
        selPt = -1;
        draw();
    };
    bar.append(el("div", "flex:1;"));
    btn("Cancel", () => close(false));
    btn("Done", () => close(true)).style.background = ON;
    btn("Upload", () => picker.click(), side);
    side.append(lib);

    // ---- library
    const refreshLib = async () => {
        let files = [];
        try {
            files = await (await api.fetchApi("/page_overlay/list")).json();
        } catch (e) {
            console.warn("Page Overlay: list failed", e);
        }
        lib.replaceChildren();
        for (const f of files) {
            const cell = el("div", "aspect-ratio:1;border:1px solid #444;border-radius:4px;cursor:grab;background:repeating-conic-gradient(#2a2a2a 0 25%,#202020 0 50%) 0 0/16px 16px;display:flex;align-items:center;justify-content:center;overflow:hidden;");
            const th = el("img", "max-width:100%;max-height:100%;object-fit:contain;pointer-events:none;");
            th.src = viewURL(f);
            th.loading = "lazy";
            cell.title = f.split("/").pop();
            cell.draggable = true;
            cell.ondragstart = (e) => e.dataTransfer.setData("text/plain", f);
            cell.append(th);
            lib.append(cell);
        }
    };
    const uploadAll = async (fileList) => {
        const out = [];
        for (const f of fileList) {
            try {
                out.push(await upload(f));
            } catch (e) {
                console.warn("Page Overlay:", e);
            }
        }
        await refreshLib();
        return out;
    };
    picker.onchange = async () => {
        await uploadAll([...picker.files]);
        picker.value = "";
    };

    // ---- items
    const add = async (file, x, y) => {
        const im = await loadImg(file);
        if (!im) return;
        loaded.set(file, im);
        const s = Math.min((0.6 * W) / im.naturalWidth, (0.6 * H) / im.naturalHeight, 1);
        items.push({ file, cx: x / W, cy: y / H, w: (im.naturalWidth * s) / W, h: (im.naturalHeight * s) / H });
        sel = items.length - 1;
        draw();
    };
    const del = () => {
        if (cropMode) {
            const c = items[sel]?.crop;
            if (c && selPt >= 0) {
                c.splice(selPt, 1);
                selPt = -1;
                draw();
            }
            return;
        }
        if (sel < 0) return;
        items.splice(sel, 1);
        sel = items.length - 1;
        draw();
    };
    // crop points are stored relative to the item's box, so they follow moves and resizes
    const cropPts = (it) => {
        const r = rect(it);
        return (it.crop || []).map(([u, v]) => [r.x0 + u * r.w, r.y0 + v * r.h]);
    };
    const polyPath = (pts) => {
        const p = new Path2D();
        pts.forEach(([x, y], j) => (j ? p.lineTo(x, y) : p.moveTo(x, y)));
        p.closePath();
        return p;
    };
    const rect = (it) => {
        const w = it.w * W, h = it.h * H;
        return { x0: it.cx * W - w / 2, y0: it.cy * H - h / 2, w, h };
    };

    // ---- drawing
    const view = { k: 1, ox: 0, oy: 0 };
    const ctx = canvas.getContext("2d");
    const draw = () => {
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
        ctx.setTransform(dpr * view.k, 0, 0, dpr * view.k, dpr * view.ox, dpr * view.oy);
        ctx.drawImage(page, 0, 0);
        items.forEach((it, i) => {
            const im = loaded.get(it.file);
            if (!im) return;
            const r = rect(it);
            const cropped = it.crop?.length >= 3;
            if (cropMode && i === sel) {
                ctx.globalAlpha = 0.35; // the part being cut away, faded
                ctx.drawImage(im, r.x0, r.y0, r.w, r.h);
                ctx.globalAlpha = 1;
            }
            if (cropped || (cropMode && i === sel)) {
                if (!cropped) return;
                ctx.save();
                ctx.clip(polyPath(cropPts(it)));
                ctx.drawImage(im, r.x0, r.y0, r.w, r.h);
                ctx.restore();
            } else ctx.drawImage(im, r.x0, r.y0, r.w, r.h);
        });
        const it = items[sel];
        if (it && cropMode) {
            const px = 1 / view.k, pts = cropPts(it);
            if (pts.length >= 2) {
                ctx.lineWidth = 2 * px;
                ctx.strokeStyle = "#ffcc33";
                ctx.stroke(pts.length >= 3 ? polyPath(pts) : (() => {
                    const p = new Path2D();
                    p.moveTo(...pts[0]);
                    p.lineTo(...pts[1]);
                    return p;
                })());
            }
            pts.forEach(([x, y], j) => {
                ctx.beginPath();
                ctx.arc(x, y, 7 * px, 0, Math.PI * 2);
                ctx.fillStyle = j === selPt ? "#ff5533" : "#ffcc33";
                ctx.fill();
            });
        } else if (it) {
            const px = 1 / view.k, r = rect(it);
            ctx.setLineDash([6 * px, 4 * px]);
            ctx.lineWidth = 2 * px;
            ctx.strokeStyle = "#2ec4ff";
            ctx.strokeRect(r.x0, r.y0, r.w, r.h);
            ctx.setLineDash([]);
            ctx.fillStyle = "#2ec4ff";
            for (const [hx, hy] of corners(r)) ctx.fillRect(hx - HANDLE * px, hy - HANDLE * px, 2 * HANDLE * px, 2 * HANDLE * px);
        }
    };
    const corners = (r) => [[r.x0, r.y0], [r.x0 + r.w, r.y0], [r.x0, r.y0 + r.h], [r.x0 + r.w, r.y0 + r.h]];

    // ---- mouse
    const toImg = (e) => {
        const b = canvas.getBoundingClientRect();
        return [(e.clientX - b.left - view.ox) / view.k, (e.clientY - b.top - view.oy) / view.k];
    };
    const hit = (x, y) => {
        const px = 1 / view.k;
        if (items[sel]) {
            const c = corners(rect(items[sel])).findIndex(([hx, hy]) => Math.abs(x - hx) <= (HANDLE + 2) * px && Math.abs(y - hy) <= (HANDLE + 2) * px);
            if (c >= 0) return { i: sel, mode: "size", corner: c };
        }
        for (let i = items.length - 1; i >= 0; i--) {
            const r = rect(items[i]);
            if (x >= r.x0 && x <= r.x0 + r.w && y >= r.y0 && y <= r.y0 + r.h) return { i, mode: "move" };
        }
        return null;
    };
    let drag = null;
    const segDist = (p, a, b) => {
        const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy;
        const t = l2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2)) : 0;
        return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
    };
    const cropDown = (x, y) => {
        const it = items[sel], r = rect(it), pts = cropPts(it), px = 1 / view.k;
        const near = pts.findIndex(([qx, qy]) => Math.hypot(x - qx, y - qy) <= 10 * px);
        if (near < 0) {
            it.crop = it.crop || [];
            const uv = [Math.min(1, Math.max(0, (x - r.x0) / r.w)), Math.min(1, Math.max(0, (y - r.y0) / r.h))];
            let at = it.crop.length;
            if (pts.length >= 3) { // new points go into the nearest edge
                let best = Infinity;
                pts.forEach((a, j) => {
                    const d = segDist([x, y], a, pts[(j + 1) % pts.length]);
                    if (d < best) [best, at] = [d, j + 1];
                });
            }
            it.crop.splice(at, 0, uv);
            selPt = at;
        } else selPt = near;
        drag = { mode: "point", i: sel };
        draw();
    };
    canvas.onpointerdown = (e) => {
        const [x, y] = toImg(e);
        if (cropMode) {
            cropDown(x, y);
            canvas.setPointerCapture(e.pointerId);
            return;
        }
        const h = hit(x, y);
        if (!h) {
            sel = -1;
            draw();
            return;
        }
        sel = h.i;
        const it = items[sel], r = rect(it);
        // the corner opposite the grabbed one stays put while resizing
        const opp = h.mode === "size" ? corners(r)[3 - h.corner] : null;
        drag = { ...h, x, y, cx: it.cx, cy: it.cy, opp, ratio: r.w / r.h };
        canvas.setPointerCapture(e.pointerId);
        draw();
    };
    canvas.onpointermove = (e) => {
        const [x, y] = toImg(e);
        if (!drag) {
            if (cropMode) {
                canvas.style.cursor = "crosshair";
                return;
            }
            const h = hit(x, y);
            canvas.style.cursor = !h ? "default" : h.mode === "move" ? "move" : h.corner === 0 || h.corner === 3 ? "nwse-resize" : "nesw-resize";
            return;
        }
        const it = items[drag.i];
        if (drag.mode === "point") {
            const r = rect(it);
            it.crop[selPt] = [Math.min(1, Math.max(0, (x - r.x0) / r.w)), Math.min(1, Math.max(0, (y - r.y0) / r.h))];
        } else if (drag.mode === "move") {
            it.cx = drag.cx + (x - drag.x) / W;
            it.cy = drag.cy + (y - drag.y) / H;
        } else {
            const [ox, oy] = drag.opp;
            let w = Math.max(10, Math.abs(x - ox)), h = Math.max(10, Math.abs(y - oy));
            if (lock) {
                if (w / h > drag.ratio) h = w / drag.ratio;
                else w = h * drag.ratio;
            }
            const sx = x >= ox ? 1 : -1, sy = y >= oy ? 1 : -1;
            it.cx = (ox + (sx * w) / 2) / W;
            it.cy = (oy + (sy * h) / 2) / H;
            it.w = w / W;
            it.h = h / H;
        }
        draw();
    };
    canvas.onpointerup = () => (drag = null);
    canvas.addEventListener("wheel", (e) => {
        e.preventDefault();
        const [x, y] = toImg(e);
        const h = hit(x, y);
        const i = h ? h.i : sel;
        const it = items[i];
        if (!it) return;
        sel = i;
        const f = Math.exp(-e.deltaY * 0.0015);
        it.w = Math.max(10 / W, it.w * f);
        it.h = Math.max(10 / H, it.h * f);
        draw();
    }, { passive: false });

    // drop from the library, or straight from Explorer
    canvas.ondragover = (e) => e.preventDefault();
    canvas.ondrop = async (e) => {
        e.preventDefault();
        const [x, y] = toImg(e);
        if (e.dataTransfer.files?.length) {
            for (const f of await uploadAll([...e.dataTransfer.files])) await add(f, x, y);
        } else {
            const f = e.dataTransfer.getData("text/plain");
            if (f) await add(f, x, y);
        }
    };

    const onKey = (e) => {
        e.stopPropagation();
        if (["TEXTAREA", "INPUT", "SELECT"].includes(e.target.tagName)) return;
        if (e.key === "Delete" || e.key === "Backspace") {
            del();
            e.preventDefault();
        }
    };
    overlay.addEventListener("keydown", onKey);
    overlay.addEventListener("keyup", (e) => e.stopPropagation());
    overlay.tabIndex = -1;
    const onResize = () => draw();
    window.addEventListener("resize", onResize);

    const close = (save) => {
        if (save) {
            const r = (v) => Math.round(v * 1e5) / 1e5;
            const target = liveNode(node);
            const dataWLive = target.widgets.find((w) => w.name === "overlays");
            dataWLive.value = JSON.stringify(items.map((it) => {
                const o = { file: it.file, cx: r(it.cx), cy: r(it.cy), w: r(it.w), h: r(it.h) };
                if (it.crop?.length >= 3) o.crop = it.crop.map(([u, v]) => [r(u), r(v)]);
                return o;
            }));
            dataWLive.callback?.(dataWLive.value);
            backup("po", target, dataWLive.value);
            target.setDirtyCanvas(true, true);
            app.graph?.setDirtyCanvas?.(true, true);
            track();
        }
        window.removeEventListener("resize", onResize);
        overlay.remove();
    };

    document.body.append(overlay);
    overlay.focus();
    await refreshLib();
    draw();
}

app.registerExtension({
    name: "PageOverlay.Editor",
    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name !== "PageOverlay") return;
        const created = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            const r = created?.apply(this, arguments);
            const w = this.widgets?.find((x) => x.name === "overlays");
            if (w) {
                w.hidden = true;
                w.computeSize = () => [0, -4];
            }
            this.addWidget("button", "Edit Overlays", null, () => openEditor(this), { serialize: false });
            return r;
        };
        const executed = nodeType.prototype.onExecuted;
        nodeType.prototype.onExecuted = function (data) {
            executed?.apply(this, arguments);
            if (data?.overlay_bg?.[0]) {
                this.properties = this.properties || {};
                this.properties.po_bg = data.overlay_bg[0];
                track();
            }
        };
    },
});
