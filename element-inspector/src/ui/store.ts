import { reactive } from 'vue';
import type { BoxModel } from '../utils/rect';
import type { Rgba } from '../utils/color';
import type { Capture } from '../content/capture';

export interface ColorSwatch {
  label: string;
  color: Rgba;
  hex: string;
  varName: string | null;
}

export interface Inspection {
  tag: string;
  id: string;
  classes: string[];
  /** Box-model rects in iframe-content pixels. */
  box: BoxModel;
  width: number;
  height: number;
  radius: string;
  padding: string;
  margin: string;
  font: { family: string; size: string; weight: string; lineHeight: string };
  colors: ColorSwatch[];
}

export interface DevicePreset {
  label: string;
  width: number;
  height: number;
}

export const DEVICE_PRESETS: DevicePreset[] = [
  { label: '320', width: 320, height: 568 },
  { label: '375', width: 375, height: 667 },
  { label: '768', width: 768, height: 1024 },
  { label: '1024', width: 1024, height: 768 },
  { label: '1440', width: 1440, height: 900 },
];

export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 4;
const MIN_FRAME = 80;

interface State {
  srcdoc: string;
  tag: string;
  naturalWidth: number;
  naturalHeight: number;
  frameWidth: number;
  frameHeight: number;
  zoom: number;
  panX: number;
  panY: number;
  tool: 'inspect' | 'guides';
  showRulers: boolean;
  guides: { x: number[]; y: number[] };
  hover: Inspection | null;
  selected: Inspection | null;
  viewportW: number;
  viewportH: number;
}

export const state = reactive<State>({
  srcdoc: '',
  tag: '',
  naturalWidth: 0,
  naturalHeight: 0,
  frameWidth: 0,
  frameHeight: 0,
  zoom: 1,
  panX: 0,
  panY: 0,
  tool: 'inspect',
  showRulers: true,
  guides: { x: [], y: [] },
  hover: null,
  selected: null,
  viewportW: 0,
  viewportH: 0,
});

const clamp = (n: number, min: number, max: number): number => Math.max(min, Math.min(max, n));

let exitHandler: (() => void) | null = null;
export function onExit(fn: () => void): void {
  exitHandler = fn;
}
export function requestExit(): void {
  exitHandler?.();
}

export function initFromCapture(capture: Capture): void {
  state.srcdoc = capture.srcdoc;
  state.tag = capture.tag;
  state.naturalWidth = capture.naturalWidth;
  state.naturalHeight = capture.naturalHeight;
  // Give the frame breathing room around the natural-sized block.
  state.frameWidth = Math.max(MIN_FRAME, capture.naturalWidth + 64);
  state.frameHeight = Math.max(MIN_FRAME, capture.naturalHeight + 64);
  state.zoom = 1;
  state.tool = 'inspect';
  state.guides = { x: [], y: [] };
  state.hover = null;
  state.selected = null;
}

export function setFrameSize(width: number, height: number): void {
  state.frameWidth = Math.max(MIN_FRAME, Math.round(width));
  state.frameHeight = Math.max(MIN_FRAME, Math.round(height));
}

export function setDevice(preset: DevicePreset): void {
  setFrameSize(preset.width, preset.height);
}

export function rotateFrame(): void {
  setFrameSize(state.frameHeight, state.frameWidth);
}

export function resetSize(): void {
  setFrameSize(state.naturalWidth + 64, state.naturalHeight + 64);
  state.zoom = 1;
}

export function setZoom(zoom: number): void {
  state.zoom = clamp(zoom, MIN_ZOOM, MAX_ZOOM);
}

/** Zoom by a factor while keeping the viewport point (cx, cy) anchored. */
export function zoomAt(factor: number, cx: number, cy: number): void {
  const next = clamp(state.zoom * factor, MIN_ZOOM, MAX_ZOOM);
  const ratio = next / state.zoom;
  state.panX = cx - (cx - state.panX) * ratio;
  state.panY = cy - (cy - state.panY) * ratio;
  state.zoom = next;
}

/** Center the frame within a viewport of the given size. */
export function centerIn(viewportWidth: number, viewportHeight: number): void {
  state.panX = Math.round((viewportWidth - state.frameWidth * state.zoom) / 2);
  state.panY = Math.round((viewportHeight - state.frameHeight * state.zoom) / 2);
}

/** Re-center using the last known viewport size (tracked by the Stage). */
export function recenter(): void {
  if (state.viewportW && state.viewportH) centerIn(state.viewportW, state.viewportH);
}

export function addGuide(axis: 'x' | 'y', position: number): void {
  state.guides[axis].push(Math.round(position));
}

export function clearGuides(): void {
  state.guides = { x: [], y: [] };
}
