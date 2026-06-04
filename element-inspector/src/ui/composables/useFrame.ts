import { onBeforeUnmount, onMounted, watch } from 'vue';
import type { Ref } from 'vue';
import { TARGET_ATTR } from '../../content/capture';
import { computeBoxModel } from '../../utils/rect';
import type { Box, Edges } from '../../utils/rect';
import { colorKey, isTransparent, parseColor, rgbaToHex } from '../../utils/color';
import { requestExit, state } from '../store';
import type { ColorSwatch, Inspection } from '../store';

// Owns the canvas iframe: writes the captured srcdoc, then reads layout/styles back out of
// the (same-origin) iframe document to drive the inspector overlays.
export function useFrame(frameRef: Ref<HTMLIFrameElement | undefined>): {
  reinspect: () => void;
} {
  let doc: Document | null = null;
  let win: (Window & typeof globalThis) | null = null;
  let target: Element | null = null;
  let varMap = new Map<string, string>();

  const onLoad = (): void => {
    const frame = frameRef.value;
    if (!frame) return;
    doc = frame.contentDocument;
    win = frame.contentWindow as (Window & typeof globalThis) | null;
    if (!doc || !win) return;

    varMap = buildVarMap(win, doc);
    target = doc.querySelector(`[${TARGET_ATTR}]`);
    if (target) state.selected = inspect(target);

    doc.addEventListener('mousemove', onMove, true);
    doc.addEventListener('mouseleave', onLeave, true);
    doc.addEventListener('click', onClick, true);
    doc.addEventListener('keydown', onKey, true);
  };

  const onKey = (e: KeyboardEvent): void => {
    // ESC works even when focus is inside the iframe.
    if (e.key === 'Escape') {
      e.preventDefault();
      requestExit();
    }
  };

  const onMove = (e: MouseEvent): void => {
    if (state.tool !== 'inspect' || !doc) return;
    const el = doc.elementFromPoint(e.clientX, e.clientY);
    if (el) state.hover = inspect(el);
  };

  const onLeave = (): void => {
    state.hover = null;
  };

  const onClick = (e: MouseEvent): void => {
    if (state.tool !== 'inspect' || !doc) return;
    const el = doc.elementFromPoint(e.clientX, e.clientY);
    if (el) {
      target = el;
      state.selected = inspect(el);
    }
  };

  function inspect(el: Element): Inspection {
    const w = win!;
    const cs = w.getComputedStyle(el);
    const r = el.getBoundingClientRect();
    const borderBox: Box = { x: r.left, y: r.top, width: r.width, height: r.height };
    const padding = edges(cs, 'padding', '');
    const border = edges(cs, 'border', '-width');
    const margin = edges(cs, 'margin', '');

    return {
      tag: el.tagName.toLowerCase(),
      id: el.id ?? '',
      classes: typeof el.className === 'string' ? el.className.trim().split(/\s+/).filter(Boolean) : [],
      box: computeBoxModel(borderBox, padding, border, margin),
      width: Math.round(r.width),
      height: Math.round(r.height),
      radius: cs.borderRadius || '0px',
      padding: shorthand(padding),
      margin: shorthand(margin),
      font: {
        family: cs.fontFamily.split(',')[0]?.replace(/["']/g, '').trim() ?? '',
        size: cs.fontSize,
        weight: cs.fontWeight,
        lineHeight: cs.lineHeight,
      },
      colors: collectColors(cs),
    };
  }

  function collectColors(cs: CSSStyleDeclaration): ColorSwatch[] {
    const swatches: ColorSwatch[] = [];
    const seen = new Set<string>();
    const add = (label: string, value: string): void => {
      const color = parseColor(value);
      if (!color || isTransparent(color)) return;
      const key = label + colorKey(color);
      if (seen.has(key)) return;
      seen.add(key);
      swatches.push({ label, color, hex: rgbaToHex(color), varName: varMap.get(colorKey(color)) ?? null });
    };
    add('Text', cs.color);
    add('Background', cs.backgroundColor);
    if (parseFloat(cs.borderTopWidth) > 0) add('Border', cs.borderTopColor);
    if (parseFloat(cs.outlineWidth) > 0) add('Outline', cs.outlineColor);
    return swatches;
  }

  const reinspect = (): void => {
    if (target && win) state.selected = inspect(target);
  };

  function teardown(): void {
    if (!doc) return;
    doc.removeEventListener('mousemove', onMove, true);
    doc.removeEventListener('mouseleave', onLeave, true);
    doc.removeEventListener('click', onClick, true);
    doc.removeEventListener('keydown', onKey, true);
    doc = null;
    win = null;
  }

  const load = (): void => {
    const frame = frameRef.value;
    if (!frame) return;
    teardown();
    frame.srcdoc = state.srcdoc;
  };

  onMounted(() => {
    const frame = frameRef.value;
    if (!frame) return;
    frame.addEventListener('load', onLoad);
    if (state.srcdoc) load();
  });

  // Re-render on a new capture (kept for future "re-pick without exiting").
  watch(
    () => state.srcdoc,
    () => load(),
  );

  // Resizing the frame re-fires the page's media queries; recompute boxes after relayout.
  watch(
    () => [state.frameWidth, state.frameHeight],
    () => requestAnimationFrame(reinspect),
  );

  onBeforeUnmount(() => {
    teardown();
    frameRef.value?.removeEventListener('load', onLoad);
  });

  return { reinspect };
}

function buildVarMap(win: Window, doc: Document): Map<string, string> {
  const map = new Map<string, string>();
  const cs = win.getComputedStyle(doc.documentElement);
  const probe = doc.createElement('span');
  probe.style.display = 'none';
  doc.body.appendChild(probe);
  // Sentinel trick: invalid `color` assignments are rejected, leaving the sentinel in place,
  // which lets us tell real colors from non-color custom properties (e.g. `--gap: 8px`).
  const sentinel = 'rgb(1, 2, 3)';

  for (let i = 0; i < cs.length; i++) {
    const prop = cs.item(i);
    if (!prop.startsWith('--')) continue;
    const raw = cs.getPropertyValue(prop).trim();
    if (!raw) continue;
    probe.style.color = sentinel;
    probe.style.color = raw;
    const resolved = win.getComputedStyle(probe).color;
    if (resolved === sentinel) continue;
    const color = parseColor(resolved);
    if (!color || isTransparent(color)) continue;
    const key = colorKey(color);
    if (!map.has(key)) map.set(key, prop);
  }

  probe.remove();
  return map;
}

function edges(cs: CSSStyleDeclaration, prefix: string, suffix: string): Edges {
  const get = (side: string): number => parseFloat(cs.getPropertyValue(`${prefix}-${side}${suffix}`)) || 0;
  return { top: get('top'), right: get('right'), bottom: get('bottom'), left: get('left') };
}

function shorthand(e: Edges): string {
  const v = [e.top, e.right, e.bottom, e.left].map((n) => Math.round(n));
  if (v.every((n) => n === v[0])) return `${v[0]}px`;
  return v.map((n) => `${n}px`).join(' ');
}
