import { readFile } from 'node:fs/promises';
import type { Plugin } from 'vite';
import {
  createHighlighterCore,
  type HighlighterCore,
  type ShikiTransformer,
} from 'shiki/core';
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript';

const SHIKI_QUERY = 'shiki';

/** Расширение файла -> id грамматики Shiki. */
const EXT_TO_LANG: Record<string, string> = {
  js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'jsx',
  ts: 'typescript', mts: 'typescript', cts: 'typescript', tsx: 'tsx',
  vue: 'vue', json: 'json', jsonc: 'jsonc', css: 'css', scss: 'scss',
  html: 'html', md: 'markdown', py: 'python', rs: 'rust', go: 'go',
  sh: 'bash', bash: 'bash', yml: 'yaml', yaml: 'yaml', toml: 'toml', sql: 'sql',
};

export interface ShikiPluginOptions {
  /** Одиночная тема (по умолчанию aurora-x). Игнорируется, если задан `themes`. */
  theme?: string;
  /** Парные темы — Shiki отдаёт HTML с CSS-переменными для light/dark. */
  themes?: { light: string; dark: string };
  /** Доп. соответствия расширение -> язык поверх дефолтных. */
  langAlias?: Record<string, string>;
  /** Трансформеры Shiki (номера строк, диффы и т.п.). */
  transformers?: ShikiTransformer[];
}

/**
 * Импорт `./snippet.ts?shiki` возвращает строку с уже подсвеченным HTML.
 * Вся работа Shiki происходит в Node на этапе сборки/дева — в бандл клиента
 * не попадает ни движок, ни грамматики. Zero runtime.
 *
 * Язык берётся из расширения файла, либо из `?shiki&lang=...`.
 */
export function shiki(options: ShikiPluginOptions = {}): Plugin {
  const { theme = 'aurora-x', themes, transformers } = options;
  const extToLang = { ...EXT_TO_LANG, ...options.langAlias };

  let highlighter: Promise<HighlighterCore> | null = null;
  const loadedLangs = new Set<string>();
  const loadedThemes = new Set<string>();

  const getHighlighter = () => {
    highlighter ??= createHighlighterCore({
      langs: [],
      themes: [],
      engine: createJavaScriptRegexEngine(),
    });
    return highlighter;
  };

  const ensureLang = async (hl: HighlighterCore, lang: string) => {
    if (loadedLangs.has(lang)) return;
    const mod = await import(`shiki/langs/${lang}.mjs`);
    await hl.loadLanguage(mod.default);
    loadedLangs.add(lang);
  };

  const ensureTheme = async (hl: HighlighterCore, name: string) => {
    if (loadedThemes.has(name)) return;
    const mod = await import(`shiki/themes/${name}.mjs`);
    await hl.loadTheme(mod.default);
    loadedThemes.add(name);
  };

  return {
    name: 'vite-plugin-shiki',
    enforce: 'pre',

    async load(id) {
      const [filepath, rawQuery] = id.split('?', 2);
      if (!rawQuery) return;

      const params = new URLSearchParams(rawQuery);
      if (!params.has(SHIKI_QUERY)) return;

      const ext = filepath.split('.').pop()?.toLowerCase() ?? '';
      const lang = params.get('lang') ?? extToLang[ext] ?? ext ?? 'text';

      // Перечитываем исходник сами + регистрируем как зависимость для HMR.
      const source = await readFile(filepath, 'utf8');
      this.addWatchFile(filepath);

      const hl = await getHighlighter();
      await ensureLang(hl, lang);
      if (themes) {
        await ensureTheme(hl, themes.light);
        await ensureTheme(hl, themes.dark);
      } else {
        await ensureTheme(hl, theme);
      }

      const html = hl.codeToHtml(source.replace(/\n$/, ''), {
        lang,
        ...(themes ? { themes } : { theme }),
        transformers,
      });

      return { code: `export default ${JSON.stringify(html)}`, map: null };
    },
  };
}
