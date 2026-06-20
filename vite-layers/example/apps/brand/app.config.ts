import { defineLayerConfig } from '../../../src/index.ts'

// Northwind — a reseller brand. It inherits the entire shell (header, footer, profile, router,
// Tailwind setup) from `main` and changes only three things: its logo, its theme.css tokens and
// its Landing page. It also drops the billing page entirely.
export default defineLayerConfig({
  name: 'brand',
  extends: ['../main'],
  features: { billing: false }, // brand drops the billing page entirely (DCE)
})
