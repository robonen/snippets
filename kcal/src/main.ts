import '@fontsource-variable/golos-text';
import '@fontsource/spectral/300.css';
import '@fontsource/spectral/500.css';
import './app.css';
import { createVaporApp } from 'vue';
import type { App as VueApp } from 'vue';
import { installEngine } from 'vue-sync-engine';
import App from './App';
import { CACHE_DEFAULTS, createKcalEngine, seedIfEmpty } from './data/engine';

// Стартовый каталог должен лечь в idb до первой подписки на foods-запрос.
await seedIfEmpty();

const engine = createKcalEngine();
const app = createVaporApp(App);

// installEngine типизирован под vdom-App; VaporApp имеет совместимые provide/config.
installEngine(app as unknown as VueApp, engine, { defaults: CACHE_DEFAULTS });

app.mount('#app');
