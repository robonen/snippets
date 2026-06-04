// Pure geometry helpers for the box-model overlay and distance measuring. DOM-free.

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Edges {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface BoxModel {
  margin: Box;
  border: Box;
  padding: Box;
  content: Box;
}

/**
 * Derive the four nested boxes of the CSS box model from the border box
 * (what `getBoundingClientRect` returns) plus the computed edge widths.
 */
export function computeBoxModel(borderBox: Box, padding: Edges, border: Edges, margin: Edges): BoxModel {
  const marginBox: Box = {
    x: borderBox.x - margin.left,
    y: borderBox.y - margin.top,
    width: borderBox.width + margin.left + margin.right,
    height: borderBox.height + margin.top + margin.bottom,
  };
  const paddingBox: Box = {
    x: borderBox.x + border.left,
    y: borderBox.y + border.top,
    width: borderBox.width - border.left - border.right,
    height: borderBox.height - border.top - border.bottom,
  };
  const contentBox: Box = {
    x: paddingBox.x + padding.left,
    y: paddingBox.y + padding.top,
    width: paddingBox.width - padding.left - padding.right,
    height: paddingBox.height - padding.top - padding.bottom,
  };
  return { margin: marginBox, border: { ...borderBox }, padding: paddingBox, content: contentBox };
}

/** Axis-aligned gap between two boxes (0 on an axis where they overlap). */
export function gap(a: Box, b: Box): { dx: number; dy: number } {
  const dx = b.x > a.x + a.width ? b.x - (a.x + a.width) : a.x > b.x + b.width ? a.x - (b.x + b.width) : 0;
  const dy = b.y > a.y + a.height ? b.y - (a.y + a.height) : a.y > b.y + b.height ? a.y - (b.y + b.height) : 0;
  return { dx: Math.round(dx), dy: Math.round(dy) };
}

/** Round a px value to at most 2 decimals, dropping a trailing `.0`. */
export function roundPx(n: number): number {
  return Math.round(n * 100) / 100;
}
