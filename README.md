# ComfyUI-SpeechBubbles

A ComfyUI node for lettering comic pages: speech bubbles, sound effects and manga effect marks, placed in a visual editor.

## Speech Bubbles

The node (`image/text`) opens an editor on the page image. Add speech, thought, shout and custom-outline bubbles, sound-effect text stretched between two edges, and effect icons (hearts, sparkles, sweat, steam, blush, anger vein, kiss mark and more). Bubbles can be moved, resized, rotated, copied and pasted; the output matches the editor.

The editor opens on the image the node last received, so run the workflow once before opening it.

Related: [ComfyUI-PageOverlay](https://github.com/Kvackie/ComfyUI-PageOverlay) pastes images onto a page in a similar editor.

## Install

Clone into `comfyui/custom_nodes` and restart ComfyUI:

```
cd comfyui/custom_nodes
git clone https://github.com/Kvackie/ComfyUI-SpeechBubbles
```

Sound effects need OpenCV: ComfyUI Manager installs it from `requirements.txt`, or run `pip install -r requirements.txt` with ComfyUI's Python.

## Bubble data

The editor writes the `bubbles` field as a JSON list; you only need this to edit it by hand. Positions and sizes are fractions of the page (x of its width, y and sizes of its height); turns are radians, clockwise.

| `type` | Fields |
|---|---|
| `speech`, `thought`, `shout` | `cx, cy` centre · `rx, ry` radius · `tx, ty` tail tip · `size` font size · `text` · `lines` (wrapped text) · `seed` (shout spikes) · `rot` |
| `custom` | as above, plus `pts` outline points and `smooth` (curves through them) |
| `icon` | `kind` · `x, y` · `s` size · `kx, ky` stretch · `r` turn · `dcolor, docolor` fill / outline |
| `sfx` | `text` stretched between `top` and `bottom` edge points · `color, ocolor, ow` fill / outline · `o2color, o2w` outer outline · `scolor, sx, sy` shadow · `seed, shake, grow` letter tilt and growth · `deco` decorations `[{kind, x, y, s, r}]` drawn under the letters |

Any bubble can also set `font` (file name; default is the node's font) and `heart` (`outline` or `fill`: what `<3` in the text becomes; ♡ is always outlined, ♥ always filled).

Icon kinds: `heart`, `sparkle`, `tremble`, `sweat`, `steam`, `note`, `puff`, `blush`, `throb`, `vein`, `droplets`, `spurt`, `spiral`, `kiss`, `exclaim`. SFX decorations use `heart`, `sparkle`, `sweat`, `steam`, `tremble`.

## Fonts

Fonts are read from the `fonts` folder (and the Windows fonts folder). Drop any `.ttf` or `.otf` file into `fonts` to use it. [Komika Text](https://www.fontsquirrel.com/fonts/Komika-Text) is a free comic font that works well.

## Licence

MIT, see [LICENSE](LICENSE).
