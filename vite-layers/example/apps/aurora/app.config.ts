import { defineLayerConfig } from '../../../src/index.ts'

// Aurora — a dark-themed brand. Like Northwind it inherits the whole shell from `main` and changes
// only its logo, theme.css and Landing. It keeps the billing page but turns off the beta accent,
// showing that each brand toggles a different subset of features.
export default defineLayerConfig({
  name: 'aurora',
  extends: ['../main'],
  features: { betaBanner: false }, // keeps `billing` (inherited true); drops the beta pill
})
