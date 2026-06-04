// DevTools-style element picker. Draws a highlight box + label inside the extension's
// shadow root and resolves with the clicked element. Uses capture-phase listeners so it
// beats the page's own handlers (links won't navigate, buttons won't fire).

export interface PickerHandle {
  cancel: () => void;
}

const HIGHLIGHT_STYLE =
  'position:fixed;z-index:2147483646;pointer-events:none;box-sizing:border-box;' +
  'border:2px solid #3b82f6;background:rgba(59,130,246,0.16);' +
  'box-shadow:0 0 0 1px rgba(255,255,255,0.5);border-radius:2px;' +
  'transition:left 60ms ease,top 60ms ease,width 60ms ease,height 60ms ease;display:none;';

const LABEL_STYLE =
  'position:fixed;z-index:2147483647;pointer-events:none;display:none;' +
  'background:#1e293b;color:#f8fafc;font:600 11px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;' +
  'padding:3px 7px;border-radius:5px;white-space:nowrap;box-shadow:0 4px 12px rgba(0,0,0,0.35);';

export function startPicker(
  root: ShadowRoot,
  onPick: (el: Element) => void,
  onCancel: () => void,
): PickerHandle {
  const highlight = document.createElement('div');
  highlight.style.cssText = HIGHLIGHT_STYLE;
  const label = document.createElement('div');
  label.style.cssText = LABEL_STYLE;
  root.append(highlight, label);

  let current: Element | null = null;
  let done = false;

  const place = (el: Element): void => {
    const r = el.getBoundingClientRect();
    highlight.style.display = 'block';
    highlight.style.left = `${r.left}px`;
    highlight.style.top = `${r.top}px`;
    highlight.style.width = `${r.width}px`;
    highlight.style.height = `${r.height}px`;

    label.textContent = describe(el, r);
    label.style.display = 'block';
    const above = r.top - 26;
    label.style.left = `${Math.max(2, Math.min(r.left, window.innerWidth - label.offsetWidth - 4))}px`;
    label.style.top = `${above >= 2 ? above : r.bottom + 6}px`;
  };

  const onMove = (e: MouseEvent): void => {
    const el = document.elementFromPoint(e.clientX, e.clientY);
    if (!el || el === current) return;
    current = el;
    place(el);
  };

  const onScroll = (): void => {
    if (current) place(current);
  };

  const swallow = (e: Event): void => {
    e.preventDefault();
    e.stopImmediatePropagation();
  };

  const onClick = (e: MouseEvent): void => {
    swallow(e);
    const el = current ?? document.elementFromPoint(e.clientX, e.clientY);
    if (el) finish(() => onPick(el));
  };

  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') {
      swallow(e);
      finish(onCancel);
    }
  };

  function finish(cb: () => void): void {
    if (done) return;
    done = true;
    cleanup();
    cb();
  }

  function cleanup(): void {
    window.removeEventListener('mousemove', onMove, true);
    window.removeEventListener('mousedown', swallow, true);
    window.removeEventListener('mouseup', swallow, true);
    window.removeEventListener('click', onClick, true);
    window.removeEventListener('contextmenu', swallow, true);
    window.removeEventListener('keydown', onKey, true);
    window.removeEventListener('scroll', onScroll, true);
    highlight.remove();
    label.remove();
  }

  window.addEventListener('mousemove', onMove, true);
  window.addEventListener('mousedown', swallow, true);
  window.addEventListener('mouseup', swallow, true);
  window.addEventListener('click', onClick, true);
  window.addEventListener('contextmenu', swallow, true);
  window.addEventListener('keydown', onKey, true);
  window.addEventListener('scroll', onScroll, true);

  return {
    cancel: () => finish(onCancel),
  };
}

function describe(el: Element, r: DOMRect): string {
  const tag = el.tagName.toLowerCase();
  const id = el.id ? `#${el.id}` : '';
  let cls = '';
  if (typeof el.className === 'string' && el.className.trim()) {
    cls = '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.');
  }
  return `${tag}${id}${cls}  ${Math.round(r.width)}×${Math.round(r.height)}`;
}
