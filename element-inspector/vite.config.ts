import { defineConfig } from 'vite';
import VueJsxVapor from 'vue-jsx-vapor/vite';
import tailwindcss from '@tailwindcss/vite';
import webExtension from 'vite-plugin-web-extension';

// Element Inspector — Chrome MV3 extension.
// JSX is compiled to Vue Vapor (no interop); Tailwind v4 compiles the overlay styles,
// which are injected into a Shadow DOM at runtime. `webExtension` wires the manifest
// entrypoints (background + content script) into the build.
export default defineConfig({
  plugins: [
    VueJsxVapor(),
    tailwindcss(),
    webExtension({
      manifest: 'manifest.json',
      browser: 'chrome',
      // Just build/watch into dist/ — we load it unpacked ourselves rather than
      // auto-launching a browser via web-ext.
      disableAutoLaunch: true,
    }),
  ],
});
