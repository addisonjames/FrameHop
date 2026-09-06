# FrameHop

A faster way to move around your Figma and FigJam files.

**[Install from the Figma Community](https://www.figma.com/community/plugin/1319412441392289036/framehop)** · [framehop.xyz](https://framehop.xyz/)

## Features

- **Frame History:** FrameHop keeps a list of your recently selected layers,
  Frames, Components, Component Variants, Sections and anything else you click.
- **Hop Around:** Click any Layer in the list to instantly jump to it. Works
  across Pages too.
- **Favorite Frames:** Mark any Layer as a favorite for quick access. Rename
  them and drag to reorder.
- **Viewports and Selections:** Save your current viewport or a multi-layer
  selection, and restore it in a single click.
- **Keyboard Shortcuts:** Reach FrameHop's commands from Figma's Quick Action
  Menu.
- **FigJam:** Full FigJam support.

## Development

Requires Node.js.

```
npm install
npm run watch    # or npm run build for a one-off compile
```

`code.ts` compiles to `code.js`, which is what `manifest.json` loads — commit both.

## License

MIT
