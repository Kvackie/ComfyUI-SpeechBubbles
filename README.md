# ComfyUI-SpeechBubbles

ComfyUI nodes for lettering comic pages: speech bubbles, sound effects and manga effect marks, placed in a visual editor.

## Nodes

- **Speech Bubbles** (`image/text`): opens an editor on the page image. Add speech, thought, shout and custom-outline bubbles, sound-effect text stretched between two edges, and effect icons (hearts, sparkles, sweat, steam, blush, anger vein, kiss mark and more). Bubbles can be moved, resized, rotated, copied and pasted; the output matches the editor.
- **Panel Fit** (`image/comic`): zoom and pan each panel image inside its panel, using a `layout_json` from [ComfyUI-PanelComposer](https://github.com/INuBq8/ComfyUI-PanelComposer). Output images are sized to each panel so Panel Compositor's `cover` mode pastes them as placed.
- **Page Overlay** (`image/comic`): paste uploaded images (for example a cut-out character) onto the page, with an optional crop outline.

Each node has an editor button; the editor opens on the image the node last received, so run the workflow once before opening it.

## Install

Clone into `ComfyUI/custom_nodes` and restart ComfyUI:

```
cd ComfyUI/custom_nodes
git clone https://github.com/Kvackie/ComfyUI-SpeechBubbles
```

No extra Python packages are needed.

## Fonts

Fonts are read from the `fonts` folder (and the Windows fonts folder). Drop any `.ttf` or `.otf` file into `fonts` to use it. [Komika Text](https://www.fontsquirrel.com/fonts/Komika-Text) is a free comic font that works well. If CC Wild Words is installed it is picked as the default font.

## Licence

MIT, see [LICENSE](LICENSE).
