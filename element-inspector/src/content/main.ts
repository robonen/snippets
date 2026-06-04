import { ACTIVATE_MESSAGE } from '../shared/messages';
import { startPicker } from './picker';
import type { PickerHandle } from './picker';
import { captureElement } from './capture';
import { createCanvasApp } from '../ui/mount';
import type { CanvasApp } from '../ui/mount';
import cssText from '../ui/styles/style.css?inline';

// Content-script entry. Stays dormant until the background worker sends an "activate"
// message (toolbar click / shortcut). All UI lives in a Shadow DOM host so it can't be
// styled by — or leak styles into — the page.

type Mode = 'idle' | 'picking' | 'canvas';

let mode: Mode = 'idle';
let host: HTMLElement | null = null;
let shadow: ShadowRoot | null = null;
let picker: PickerHandle | null = null;
let canvas: CanvasApp | null = null;

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === ACTIVATE_MESSAGE) activate();
});

function activate(): void {
  if (mode === 'picking') return;
  if (mode === 'canvas') deactivate();
  startPicking();
}

function startPicking(): void {
  const root = ensureHost();
  // Let `elementFromPoint` reach the page underneath while picking.
  host!.style.pointerEvents = 'none';
  mode = 'picking';
  picker = startPicker(root, onPicked, deactivate);
}

function onPicked(el: Element): void {
  picker = null;
  const capture = captureElement(el);
  const root = ensureHost();
  host!.style.pointerEvents = 'auto';
  mode = 'canvas';
  canvas = createCanvasApp(root, capture, deactivate);
}

function ensureHost(): ShadowRoot {
  if (shadow) return shadow;
  host = document.createElement('div');
  host.id = 'element-inspector-root';
  host.style.cssText = 'all:initial; position:fixed; inset:0; z-index:2147483647;';
  shadow = host.attachShadow({ mode: 'open' });

  const sheet = new CSSStyleSheet();
  // Tailwind v4 emits theme variables on `:root`, which won't match inside a shadow root.
  sheet.replaceSync(cssText.replace(/:root\b/g, ':host'));
  shadow.adoptedStyleSheets = [sheet];

  document.documentElement.appendChild(host);
  return shadow;
}

function deactivate(): void {
  if (mode === 'idle') return;
  mode = 'idle';
  if (picker) {
    const active = picker;
    picker = null;
    active.cancel();
  }
  if (canvas) {
    canvas.unmount();
    canvas = null;
  }
  if (host) {
    host.remove();
    host = null;
    shadow = null;
  }
}
