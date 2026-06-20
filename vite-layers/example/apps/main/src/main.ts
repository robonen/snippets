import { createApp } from 'vue'
import App from '@/App.vue'

// `@/style.css` (Tailwind entry) lives only in the base layer, so every brand shares it.
// `@/theme.css` is layer-resolved: each brand ships its own token file that shadows the base's,
// recoloring the whole shared UI. Imported after style.css so its :root vars win the cascade.
import '@/style.css'
import '@/assets/theme.css'

createApp(App).mount('#app')
