export default {
  name: 'app',
  features: { flag: 'dev', shared: true },
  $production: { features: { flag: 'prod' } },
}
