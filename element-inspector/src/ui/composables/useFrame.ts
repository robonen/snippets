import { markRaw, onBeforeUnmount, onMounted, watch } from 'vue';
import type { Ref } from 'vue';
import { TARGET_ATTR } from '../../content/capture';
import { computeBoxModel } from '../../utils/rect';
import type { Box, Edges } from '../../utils/rect';
import { colorKey, isTransparent, parseColor, rgbaToHex } from '../../utils/color';
import { requestExit, state } from '../store';
import type { ColorSwatch, Inspection, LayoutInfo, LayoutProp, StyleItem } from '../store';

// Owns the canvas iframe: writes the captured srcdoc, then reads layout/styles back out of
// the (same-origin) iframe document to drive the inspector overlays.
export function useFrame(frameRef: Ref<HTMLIFrameElement | undefined>): {
  reinspect: () => void;
} {
  let doc: Document | null = null;
  let win: (Window & typeof globalThis) | null = null;
  let target: Element | null = null;
  let varMap = new Map<string, string>();
  let removalObserver: MutationObserver | null = null;
  // Hover hot-path state: the last element we inspected (skip re-work while the cursor stays on
  // it) and a pending rAF id (coalesce a burst of mousemove events into one inspect per frame).
  let lastHover: Element | null = null;
  let moveRaf = 0;
  let movePoint = { x: 0, y: 0 };

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

    // If the inspected element is removed from the frame document (e.g. a script in the
    // captured markup tears it down), there is nothing left to inspect — close the overlay.
    removalObserver = new MutationObserver(() => {
      if (target && !target.isConnected) requestExit();
    });
    removalObserver.observe(doc, { childList: true, subtree: true });
  };

  const onKey = (e: KeyboardEvent): void => {
    // ESC works even when focus is inside the iframe.
    if (e.key === 'Escape') {
      e.preventDefault();
      requestExit();
    }
  };

  const flushMove = (): void => {
    moveRaf = 0;
    if (!doc) return;
    const el = doc.elementFromPoint(movePoint.x, movePoint.y);
    if (!el || el === lastHover) return; // same element under cursor → nothing to recompute
    lastHover = el;
    state.hover = inspect(el);
  };

  const onMove = (e: MouseEvent): void => {
    // Coalesce a burst of mousemove events into a single inspect on the next frame.
    movePoint.x = e.clientX;
    movePoint.y = e.clientY;
    if (!moveRaf) moveRaf = requestAnimationFrame(flushMove);
  };

  const onLeave = (): void => {
    lastHover = null;
    state.hover = null;
  };

  const onClick = (e: MouseEvent): void => {
    if (!doc) return;
    // Always swallow the click so the captured markup can't navigate (links) or trip an
    // interactive control while you analyse it. Re-selecting is opt-in (clicks are locked by
    // default to avoid misclicks); when unlocked, a click re-targets the inspector.
    e.preventDefault();
    e.stopPropagation();
    if (!state.clicksEnabled) return;
    const el = doc.elementFromPoint(e.clientX, e.clientY);
    if (el) {
      target = el;
      state.selected = inspect(el);
    }
  };

  function inspect(el: Element): Inspection {
    const w = win!;
    const cs = w.getComputedStyle(el);
    const parentCs = el.parentElement ? w.getComputedStyle(el.parentElement) : null;
    const r = el.getBoundingClientRect();
    const borderBox: Box = { x: r.left, y: r.top, width: r.width, height: r.height };
    const padding = edges(cs, 'padding', '');
    const border = edges(cs, 'border', '-width');
    const margin = edges(cs, 'margin', '');

    // The inspection is an immutable snapshot replaced wholesale on each hover/click; mark it
    // raw so Vue never deep-proxies its nested box-model / arrays (hot path on every mousemove).
    return markRaw({
      tag: el.tagName.toLowerCase(),
      id: el.id ?? '',
      classes: typeof el.className === 'string' ? el.className.trim().split(/\s+/).filter(Boolean) : [],
      box: computeBoxModel(borderBox, padding, border, margin),
      width: Math.round(r.width),
      height: Math.round(r.height),
      radius: cs.borderRadius || '0px',
      padding: shorthand(padding),
      margin: shorthand(margin),
      layout: detectLayout(el, cs, parentCs, r),
      typography: collectTypography(cs, parentCs),
      effects: collectEffects(cs),
      colors: collectColors(el, cs, parentCs),
    });
  }

  // A computed value counts as "inherited" when it's an inheritable property and resolves to
  // the same thing on the parent — i.e. the element didn't set it itself. A heuristic (a rule
  // could coincidentally re-set the same value), but a reliable signal in practice.
  function inheritedFrom(parentCs: CSSStyleDeclaration | null, prop: string, value: string): boolean {
    return parentCs != null && parentCs.getPropertyValue(prop) === value;
  }

  function collectColors(
    el: Element,
    cs: CSSStyleDeclaration,
    parentCs: CSSStyleDeclaration | null,
  ): ColorSwatch[] {
    const swatches: ColorSwatch[] = [];
    const seen = new Set<string>();
    const add = (label: string, value: string, inheritProp?: string): void => {
      const color = parseColor(value);
      if (!color || isTransparent(color)) return;
      const key = label + colorKey(color);
      if (seen.has(key)) return;
      seen.add(key);
      swatches.push({
        label,
        color,
        hex: rgbaToHex(color),
        varName: varMap.get(colorKey(color)) ?? null,
        inherited: inheritProp ? inheritedFrom(parentCs, inheritProp, value) : false,
      });
    };
    add('Text', cs.color, 'color');
    add('Background', cs.backgroundColor);
    if (parseFloat(cs.borderTopWidth) > 0) add('Border', cs.borderTopColor);
    if (parseFloat(cs.outlineWidth) > 0) add('Outline', cs.outlineColor);
    if (cs.textDecorationLine !== 'none') add('Decoration', cs.textDecorationColor);
    add('Caret', cs.caretColor, 'caret-color');
    add('Accent', cs.accentColor, 'accent-color');
    const shadowColor = firstColor(cs.boxShadow);
    if (shadowColor) add('Shadow', shadowColor);
    if (el.namespaceURI === 'http://www.w3.org/2000/svg') {
      add('Fill', cs.fill, 'fill');
      add('Stroke', cs.stroke, 'stroke');
    }
    return swatches;
  }

  function collectTypography(cs: CSSStyleDeclaration, parentCs: CSSStyleDeclaration | null): StyleItem[] {
    const items: StyleItem[] = [];
    const add = (label: string, prop: string, value = cs.getPropertyValue(prop)): void => {
      if (!value || value === 'normal' || value === 'none' || value === 'auto') return;
      items.push({ label, value, inherited: inheritedFrom(parentCs, prop, value) });
    };
    items.push({
      label: 'Font',
      value: cs.fontFamily.split(',')[0]?.replace(/["']/g, '').trim() || '—',
      inherited: inheritedFrom(parentCs, 'font-family', cs.fontFamily),
    });
    add('Size', 'font-size');
    add('Weight', 'font-weight');
    add('Line', 'line-height');
    add('Letter', 'letter-spacing');
    add('Align', 'text-align');
    add('Transform', 'text-transform');
    add('Style', 'font-style');
    add('Decoration', 'text-decoration-line');
    add('Whitespace', 'white-space');
    return items;
  }

  function collectEffects(cs: CSSStyleDeclaration): StyleItem[] {
    const items: StyleItem[] = [];
    const add = (label: string, value: string, hideWhen: string[]): void => {
      if (!value || hideWhen.includes(value)) return;
      items.push({ label, value });
    };
    add('Opacity', cs.opacity, ['1']);
    add('Shadow', cs.boxShadow, ['none']);
    add('Filter', cs.filter, ['none']);
    add('Backdrop', cs.backdropFilter || cs.getPropertyValue('-webkit-backdrop-filter'), ['none', '']);
    add('Blend', cs.mixBlendMode, ['normal']);
    add('Transform', cs.transform, ['none']);
    add('Cursor', cs.cursor, ['auto']);
    return items;
  }

  const reinspect = (): void => {
    if (!target || !win) return;
    // A relayout (resize / media query) can drop the element out of flow or hide it; once it
    // no longer renders a box there is nothing to inspect, so dismiss the overlay.
    if (!target.isConnected || win.getComputedStyle(target).display === 'none') {
      requestExit();
      return;
    }
    // Boxes moved — invalidate the hover skip so the next mousemove re-inspects.
    lastHover = null;
    state.selected = inspect(target);
  };

  function teardown(): void {
    removalObserver?.disconnect();
    removalObserver = null;
    if (moveRaf) {
      cancelAnimationFrame(moveRaf);
      moveRaf = 0;
    }
    lastHover = null;
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

// Summarize the element's layout: its own container model (flex/grid flow + alignment + gap)
// and, when it sits inside a flex/grid parent, how it places itself as an item. `parentCs` and
// `rect` are passed in from the caller's single computed-style / bounding-rect reads.
function detectLayout(
  el: Element,
  cs: CSSStyleDeclaration,
  parentCs: CSSStyleDeclaration | null,
  rect: DOMRect,
): LayoutInfo {
  const display = cs.display;
  const isFlex = display === 'flex' || display === 'inline-flex';
  const isGrid = display === 'grid' || display === 'inline-grid';
  const props: LayoutProp[] = [];

  if (isFlex) {
    props.push({ label: 'Direction', value: cs.flexDirection });
    if (cs.flexWrap !== 'nowrap') props.push({ label: 'Wrap', value: cs.flexWrap });
    props.push({ label: 'Justify', value: cs.justifyContent });
    props.push({ label: 'Align', value: cs.alignItems });
  } else if (isGrid) {
    props.push({ label: 'Columns', value: summarizeTracks(cs.gridTemplateColumns) });
    props.push({ label: 'Rows', value: summarizeTracks(cs.gridTemplateRows) });
    if (cs.gridAutoFlow !== 'row') props.push({ label: 'Auto flow', value: cs.gridAutoFlow });
    props.push({ label: 'Justify', value: cs.justifyItems });
    props.push({ label: 'Align', value: cs.alignItems });
  }
  if (isFlex || isGrid) {
    const g = formatGap(cs);
    if (g) props.push({ label: 'Gap', value: g });
  }

  // Item placement, when this element is a child of a flex/grid container.
  if (parentCs) {
    const pd = parentCs.display;
    if (PARENT_FLEX.test(pd)) {
      if (cs.flex !== '0 1 auto') props.push({ label: 'Flex (self)', value: cs.flex });
      if (cs.alignSelf !== 'auto' && cs.alignSelf !== 'normal') {
        props.push({ label: 'Align self', value: cs.alignSelf });
      }
    } else if (PARENT_GRID.test(pd)) {
      const area = cs.gridArea;
      if (area && area !== 'auto' && area !== 'auto / auto / auto / auto') {
        props.push({ label: 'Grid area', value: area });
      }
    }
  }

  const geometry = isFlex || isGrid ? captureGeometry(el, cs, isGrid, rect) : EMPTY_GEOMETRY;
  return { display, kind: isFlex ? 'flex' : isGrid ? 'grid' : 'block', props, ...geometry };
}

const PARENT_FLEX = /(^|-)flex$/;
const PARENT_GRID = /(^|-)grid$/;

const EMPTY_GEOMETRY: Pick<LayoutInfo, 'gridLines' | 'gaps' | 'items'> = {
  gridLines: null,
  gaps: [],
  items: [],
};

// Build the visual-overlay geometry (track lines, gap rects, item boxes) in iframe-content
// pixels — the same coordinate space as the box model, so the overlay maps them with the
// current pan/zoom exactly like the measurement layer.
function captureGeometry(
  el: Element,
  cs: CSSStyleDeclaration,
  isGrid: boolean,
  rect: DOMRect,
): Pick<LayoutInfo, 'gridLines' | 'gaps' | 'items'> {
  const bl = parseFloat(cs.borderLeftWidth) || 0;
  const bt = parseFloat(cs.borderTopWidth) || 0;
  const pl = parseFloat(cs.paddingLeft) || 0;
  const pt = parseFloat(cs.paddingTop) || 0;
  const contentX = rect.left + bl + pl;
  const contentY = rect.top + bt + pt;
  const contentW = rect.width - bl - (parseFloat(cs.borderRightWidth) || 0) - pl - (parseFloat(cs.paddingRight) || 0);
  const contentH = rect.height - bt - (parseFloat(cs.borderBottomWidth) || 0) - pt - (parseFloat(cs.paddingBottom) || 0);

  const items: Box[] = [];
  const children = el.children;
  for (let i = 0; i < children.length; i++) {
    const cr = children[i]!.getBoundingClientRect();
    if (cr.width === 0 && cr.height === 0) continue;
    items.push({ x: cr.left, y: cr.top, width: cr.width, height: cr.height });
  }

  const gaps: Box[] = [];
  const colGap = parseFloat(cs.columnGap) || 0;
  const rowGap = parseFloat(cs.rowGap) || 0;

  if (isGrid) {
    const cols = parseTracks(cs.gridTemplateColumns);
    const rows = parseTracks(cs.gridTemplateRows);
    const xs: number[] = [contentX];
    let x = contentX;
    for (let i = 0; i < cols.length; i++) {
      x += cols[i]!;
      if (i < cols.length - 1) {
        if (colGap > 0) gaps.push({ x, y: contentY, width: colGap, height: contentH });
        x += colGap;
      }
      xs.push(x);
    }
    const ys: number[] = [contentY];
    let y = contentY;
    for (let i = 0; i < rows.length; i++) {
      y += rows[i]!;
      if (i < rows.length - 1) {
        if (rowGap > 0) gaps.push({ x: contentX, y, width: contentW, height: rowGap });
        y += rowGap;
      }
      ys.push(y);
    }
    return { gridLines: cols.length ? { xs, ys } : null, gaps, items };
  }

  // Flex: shade the gaps between consecutive items along the main axis (same-line pairs).
  const isRow = cs.flexDirection.startsWith('row');
  const gapPx = isRow ? colGap : rowGap;
  if (gapPx > 0 && items.length > 1) {
    const sorted = [...items].sort((a, b) => (isRow ? a.x - b.x : a.y - b.y));
    for (let i = 0; i < sorted.length - 1; i++) {
      const a = sorted[i]!;
      const b = sorted[i + 1]!;
      if (isRow && b.x - (a.x + a.width) > 0.5 && spans(a.y, a.height, b.y, b.height)) {
        const start = a.x + a.width;
        const top = Math.min(a.y, b.y);
        gaps.push({ x: start, y: top, width: b.x - start, height: Math.max(a.y + a.height, b.y + b.height) - top });
      } else if (!isRow && b.y - (a.y + a.height) > 0.5 && spans(a.x, a.width, b.x, b.width)) {
        const start = a.y + a.height;
        const left = Math.min(a.x, b.x);
        gaps.push({ x: left, y: start, width: Math.max(a.x + a.width, b.x + b.width) - left, height: b.y - start });
      }
    }
  }
  return { gridLines: null, gaps, items };
}

// Split on whitespace that is not inside parentheses (e.g. keep `minmax(0, 1fr)` intact).
const TRACK_SPLIT = /\s+(?![^(]*\))/;
const COLOR_TOKEN = /(rgba?\([^)]*\)|hsla?\([^)]*\)|#[0-9a-f]{3,8})/i;

/** Parse a computed grid template (resolved to px) into track sizes; `none` → []. */
function parseTracks(value: string): number[] {
  if (!value || value === 'none') return [];
  return value
    .trim()
    .split(TRACK_SPLIT)
    .map((t) => parseFloat(t))
    .filter((n) => !Number.isNaN(n));
}

/** Do two 1D ranges [aStart, aStart+aLen] and [bStart, bStart+bLen] overlap? */
function spans(aStart: number, aLen: number, bStart: number, bLen: number): boolean {
  return aStart < bStart + bLen && bStart < aStart + aLen;
}

/** First color token in a CSS value (e.g. the color of a `box-shadow`), or null. */
function firstColor(value: string): string | null {
  if (!value || value === 'none') return null;
  const m = value.match(COLOR_TOKEN);
  return m ? m[0] : null;
}

function summarizeTracks(value: string): string {
  if (!value || value === 'none') return 'none';
  const count = value.trim().split(TRACK_SPLIT).length;
  return `${count} × ${value}`;
}

function formatGap(cs: CSSStyleDeclaration): string {
  const row = cs.rowGap === 'normal' ? '0px' : cs.rowGap;
  const col = cs.columnGap === 'normal' ? '0px' : cs.columnGap;
  if (parseFloat(row) === 0 && parseFloat(col) === 0) return '';
  return row === col ? row : `${row} ${col}`;
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
