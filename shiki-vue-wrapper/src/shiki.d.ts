/** Импорт `*?shiki` отдаёт уже подсвеченный HTML (см. vite-plugin-shiki). */
declare module '*?shiki' {
  const html: string;
  export default html;
}
