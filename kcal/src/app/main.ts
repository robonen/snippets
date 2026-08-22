import '@fontsource-variable/golos-text';
import '@fontsource/spectral/300.css';
import '@fontsource/spectral/500.css';
import './app.css';
import { createVaporApp } from 'vue';
import { installSpace } from '@sync/vue';
import App from './App';
import { openKcal } from '@/db/space';

// Ленд поднимается из IndexedDB до монтирования: первый кадр рисуется уже по
// данным. При первом запуске здесь же переносится база старого движка либо
// сеется стартовый каталог.
const kcal = await openKcal();

const app = createVaporApp(App);
installSpace(app, kcal.space);
app.mount('#app');
