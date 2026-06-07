import { defineLayerConfig } from '../../../src/index.ts'

export default defineLayerConfig({
  name: 'brand',
  extends: ['../main'],
  features: { billing: false }, // brand drops the billing page entirely (DCE)
})
