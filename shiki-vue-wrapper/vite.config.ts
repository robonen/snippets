import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import tailwind from '@tailwindcss/vite';
import { shiki } from './src/ShikiCode/vite-plugin-shiki';

export default defineConfig({
  plugins: [
    vue(),
    tailwind(),
    shiki({ theme: 'aurora-x' }),
  ],
});
