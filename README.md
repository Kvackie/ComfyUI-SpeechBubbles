# ComfyUI-SpeechBubbles

A ComfyUI node for lettering comic pages: speech bubbles, sound effects and manga effect marks, placed in a visual editor.

## Speech Bubbles

The node (`image/text`) opens an editor on the page image. Add speech, thought, shout and custom-outline bubbles, sound-effect text stretched between two edges, and effect icons (hearts, sparkles, sweat, steam, blush, anger vein, kiss mark and more). Bubbles can be moved, resized, rotated, copied and pasted; the output matches the editor.

The editor opens on the image the node last received, so run the workflow once before opening it.

Related: [ComfyUI-PageOverlay](https://github.com/Kvackie/ComfyUI-PageOverlay) pastes images onto a page in a similar editor.

## Install

Clone into `ComfyUI/custom_nodes` and restart ComfyUI:

```
cd ComfyUI/custom_nodes
git clone https://github.com/Kvackie/ComfyUI-SpeechBubbles
```

No extra Python packages are needed.

## Fonts

Fonts are read from the `fonts` folder (and the Windows fonts folder). Drop any `.ttf` or `.otf` file into `fonts` to use it. [Komika Text](https://www.fontsquirrel.com/fonts/Komika-Text) is a free comic font that works well.

## Licence

MIT, see [LICENSE](LICENSE).
