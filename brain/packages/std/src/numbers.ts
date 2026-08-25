/** Округление до десятых. */
export function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/** Округление к ближайшему кратному шага. */
export function roundTo(value: number, step: number): number {
  return Math.round(value / step) * step;
}
