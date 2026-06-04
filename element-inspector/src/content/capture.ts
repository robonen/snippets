// Snapshot a selected element into a self-contained HTML document for the canvas iframe.
//
// Fidelity strategy:
//  - Copy every <style>/<link rel=stylesheet> from the page <head> so the page's real CSS
//    (including media queries) applies — resizing the iframe re-fires them.
//  - Set <base href> so relative URLs (images, fonts, @import) resolve.
//  - Carry the <html>/<body> classes + all :root custom properties, so theme variables and
//    body-scoped selectors keep working.
//  - Rebuild the element's ancestor chain (tag + id + class) as `display:contents` wrappers,
//    so descendant-combinator selectors and inherited styles match without the ancestors'
//    own layout boxes distorting the isolated block.

export const TARGET_ATTR = 'data-ei-target';

export interface Capture {
  srcdoc: string;
  tag: string;
  naturalWidth: number;
  naturalHeight: number;
}

export function captureElement(el: Element): Capture {
  const rect = el.getBoundingClientRect();
  const docEl = document.documentElement;

  const lang = docEl.getAttribute('lang');
  const dir = docEl.getAttribute('dir');
  const htmlClass = docEl.getAttribute('class');
  const bodyClass = document.body?.getAttribute('class') ?? null;

  const srcdoc = `<!doctype html>
<html${attr('lang', lang)}${attr('dir', dir)}${attr('class', htmlClass)}>
<head>
<meta charset="utf-8">
<base href="${escapeAttr(document.baseURI)}">
${collectHead()}
${collectRootVars()}
<style id="__ei_reset">
  html,body{margin:0!important;padding:0!important;background:transparent!important;}
  body{box-sizing:border-box!important;min-height:100vh!important;padding:32px!important;
       display:flex!important;align-items:center!important;justify-content:center!important;}
  [${TARGET_ATTR}]{flex:0 0 auto!important;}
</style>
</head>
<body${attr('class', bodyClass)}>
${buildAncestorChain(el)}
</body>
</html>`;

  return {
    srcdoc,
    tag: el.tagName.toLowerCase(),
    naturalWidth: Math.round(rect.width),
    naturalHeight: Math.round(rect.height),
  };
}

function collectHead(): string {
  const nodes = document.querySelectorAll('style, link[rel~="stylesheet"]');
  return Array.from(nodes)
    .map((node) => node.outerHTML)
    .join('\n');
}

function collectRootVars(): string {
  const cs = getComputedStyle(document.documentElement);
  let decls = '';
  for (let i = 0; i < cs.length; i++) {
    const prop = cs.item(i);
    if (!prop.startsWith('--')) continue;
    const value = cs.getPropertyValue(prop);
    // A stray `}` in a value would break the rule; such values are vanishingly rare.
    if (value && !value.includes('}')) decls += `${prop}:${value};`;
  }
  return decls ? `<style id="__ei_rootvars">:root{${decls}}</style>` : '';
}

function buildAncestorChain(el: Element): string {
  const clone = el.cloneNode(true) as Element;
  clone.setAttribute(TARGET_ATTR, '');
  let html = clone.outerHTML;

  let node = el.parentElement;
  while (node && node !== document.body && node !== document.documentElement) {
    const tag = node.tagName.toLowerCase();
    html = `${openWrapper(node, tag)}${html}</${tag}>`;
    node = node.parentElement;
  }
  return html;
}

function openWrapper(el: Element, tag: string): string {
  // `display:contents` keeps the wrapper in the tree (for selector matching + inheritance)
  // but removes its own box so parent flex/grid/padding don't distort the block.
  return `<${tag}${attr('id', el.id || null)}${attr('class', el.getAttribute('class'))} style="display:contents!important;">`;
}

function attr(name: string, value: string | null): string {
  return value ? ` ${name}="${escapeAttr(value)}"` : '';
}

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
