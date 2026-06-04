import { createVaporApp } from 'vue';
import type { App as VaporApp } from 'vue';
import App from './App';
import { initFromCapture, onExit } from './store';
import type { Capture } from '../content/capture';

export interface CanvasApp {
  unmount: () => void;
}

// Mount the Vue Vapor canvas app into the shadow root for a freshly captured element.
export function createCanvasApp(root: ShadowRoot, capture: Capture, onClose: () => void): CanvasApp {
  initFromCapture(capture);
  onExit(onClose);

  const mountEl = document.createElement('div');
  mountEl.style.cssText = 'position:fixed;inset:0;z-index:2147483647;';
  root.appendChild(mountEl);

  const app: VaporApp = createVaporApp(App);
  app.mount(mountEl);

  return {
    unmount() {
      app.unmount();
      mountEl.remove();
    },
  };
}
