export default {
  name: 'base',
  features: { billing: true, shared: 'base', nested: { on: true } },
  hooks: {
    'layers:resolved': () => {},
  },
}
