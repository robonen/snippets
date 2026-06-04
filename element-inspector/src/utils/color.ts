// Pure color helpers. Everything here is DOM-free so it can be unit-tested directly.
// Resolving named colors / CSS-variable values to rgb is done with a DOM probe elsewhere
// (see `useFrame`), which then feeds the resulting `rgb()` strings into `parseColor`.

export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

const clampByte = (n: number): number => Math.max(0, Math.min(255, Math.round(n)));
const clampAlpha = (n: number): number => Math.max(0, Math.min(1, n));

function toNumber(value: string): number {
  const trimmed = value.trim();
  if (trimmed.endsWith('%')) return (parseFloat(trimmed) / 100) * 255;
  return parseFloat(trimmed);
}

/** Parse `rgb(...)` / `rgba(...)` in both comma and space (`r g b / a`) syntaxes. */
export function parseRgb(input: string): Rgba | null {
  const match = input.trim().match(/^rgba?\(([^)]+)\)$/i);
  if (!match || match[1] == null) return null;
  const parts = match[1].split(/[\s,/]+/).filter(Boolean);
  if (parts.length < 3) return null;

  const r = toNumber(parts[0]!);
  const g = toNumber(parts[1]!);
  const b = toNumber(parts[2]!);
  if ([r, g, b].some(Number.isNaN)) return null;

  let a = 1;
  if (parts[3] != null) {
    a = parts[3].endsWith('%') ? parseFloat(parts[3]) / 100 : parseFloat(parts[3]);
    if (Number.isNaN(a)) a = 1;
  }
  return { r: clampByte(r), g: clampByte(g), b: clampByte(b), a: clampAlpha(a) };
}

/** Parse `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`. */
export function parseHex(input: string): Rgba | null {
  const match = input.trim().match(/^#([0-9a-f]{3,8})$/i);
  if (!match || match[1] == null) return null;
  let hex = match[1];
  if (hex.length === 3 || hex.length === 4) {
    hex = hex
      .split('')
      .map((c) => c + c)
      .join('');
  }
  if (hex.length !== 6 && hex.length !== 8) return null;

  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  const a = hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1;
  return { r, g, b, a: clampAlpha(a) };
}

/** Parse a color from the common notations browsers return from `getComputedStyle`. */
export function parseColor(input: string): Rgba | null {
  return parseRgb(input) ?? parseHex(input);
}

const byteToHex = (n: number): string => clampByte(n).toString(16).padStart(2, '0');

/** Serialize to `#rrggbb`, or `#rrggbbaa` when not fully opaque. */
export function rgbaToHex({ r, g, b, a }: Rgba): string {
  const base = `#${byteToHex(r)}${byteToHex(g)}${byteToHex(b)}`;
  return a >= 1 ? base : base + byteToHex(a * 255);
}

/** A stable key for de-duplicating colors in a Map. */
export function colorKey(color: Rgba): string {
  return `${color.r},${color.g},${color.b},${Math.round(color.a * 100)}`;
}

/** Treat fully transparent colors as "no color". */
export function isTransparent(color: Rgba): boolean {
  return color.a === 0;
}

/** Human-friendly label: hex when opaque, otherwise the rgba() form. */
export function formatColor(color: Rgba): string {
  if (color.a >= 1) return rgbaToHex(color);
  return `rgba(${color.r}, ${color.g}, ${color.b}, ${Number(color.a.toFixed(2))})`;
}
