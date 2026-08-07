import { defineConfig } from '@vite-pwa/assets-generator/config';

// Исходник — public/logo.svg. Фон подложки совпадает с --color-bg, иначе
// maskable-иконка и apple-touch получили бы белые поля на тёмном логотипе.
const background = '#12100d';

export default defineConfig({
  headLinkOptions: { preset: '2023' },
  preset: {
    transparent: { sizes: [64, 192, 512], favicons: [[48, 'favicon.ico']] },
    maskable: { sizes: [512], padding: 0.3, resizeOptions: { background } },
    apple: { sizes: [180], padding: 0.3, resizeOptions: { background } },
  },
  images: ['public/logo.svg'],
});
