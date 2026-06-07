export default {
  name: 'app',
  features: {
    billing: false,
    nested: { enabled: false, deep: { on: true } },
    'kebab-flag': true,
  },
}
