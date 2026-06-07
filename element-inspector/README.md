# Element Inspector

A Chrome (MV3) browser extension that lets you **pick any element on a live page and study it
on a clean canvas** — its real dimensions, colors (resolved to CSS variables), spacing, radius,
typography, plus rulers and live responsive resizing.

It's like the DevTools "inspect" cursor, but instead of staying buried in the page it lifts the
selected block out onto an isolated stage where you can measure and stress-test it.

## Features

1. **Activate** — click the toolbar icon or press `Alt+Shift+E`.
2. **Pick** — a DevTools-style cursor highlights elements on hover; click to select one.
3. **Isolate** — the page is hidden and the selected block is rendered, centered, on a canvas.
4. **Inspect** — hover any part to see its box model (margin/border/padding/content), dimensions,
   colors (shown as `var(--name)` when they match a CSS custom property, with the hex), border
   radius, spacing and typography.
5. **Measure** — zoom/pan the canvas, toggle rulers, and click a ruler to drop a guide.
6. **Responsive** — resize the frame with the drag handles, the W×H inputs, or the device presets.
   Because the block is rendered in a real iframe carrying the page's stylesheets, resizing
   **re-fires the site's actual media queries**. "Fit" resets it.

Press `Esc` (or "Close") to dismiss and return to the page — nothing on the page is modified.

## How it works

- The **background worker** relays the toolbar click / shortcut to the active tab.
- The **content script** mounts the UI into a **Shadow DOM** so the page can't style it and it
  can't leak styles into the page. The UI is built with **Vue (Vapor mode) authored in JSX/TSX**
  via [`vue-jsx-vapor`](https://vuejsx.dev/), styled with **Tailwind v4** (compiled CSS is adopted
  into the shadow root).
- The isolated block is rendered in a same-origin `srcdoc` **iframe** that copies the page's
  `<style>`/`<link>` tags, `<base href>`, `:root` custom properties and the element's ancestor
  chain (as `display:contents` wrappers, so selectors/inheritance match without the ancestors'
  layout distorting the block).

## Tech stack

Vite + [`vite-plugin-web-extension`](https://vite-plugin-web-extension.aklinker1.io/), Vue
`3.6` (Vapor), `vue-jsx-vapor`, Tailwind v4, TypeScript, Vitest.

## Develop

```bash
pnpm install
pnpm dev        # build + watch into dist/
pnpm build      # type-check + production build into dist/
pnpm test       # unit tests (color + geometry utils)
pnpm typecheck  # tsc --noEmit
pnpm icons      # regenerate the extension icons (PNG sizes + SVG source)
```

The toolbar icon sizes are generated from the source artwork `src/assets/logo.png` by
[`scripts/generate-icons.mjs`](scripts/generate-icons.mjs) (pure Node — decodes the PNG and
area-downsamples it). They are written to `public/icons/`, which Vite copies into `dist/` where
the manifest references them. To change the logo, replace `src/assets/logo.png` and run `pnpm icons`.

Then load it in Chrome:

1. Open `chrome://extensions`, enable **Developer mode**.
2. **Load unpacked** → select the `dist/` folder.
3. Open any site, click the extension icon (or `Alt+Shift+E`), and pick an element.

> Re-run `pnpm build` (or keep `pnpm dev` running) and hit the reload icon on the extension card
> after changes.

## Known limitations

- **Strict CSP pages**: a `srcdoc` iframe inherits the page's Content-Security-Policy, so on sites
  that forbid inline styles the isolated block may render imperfectly.
- Chrome/Chromium only for now. The plugin's manifest templating makes a Firefox build a feasible
  follow-up.
- Styles that depend on very deep ancestor context or `:nth-child` among original siblings may
  differ slightly, since only the direct ancestor chain is reconstructed.
