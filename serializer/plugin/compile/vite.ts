import { transform, type TransformOptions } from './transformer.ts';

export interface SerializerPluginOptions extends TransformOptions {
  /**
   * Glob patterns to include. Defaults to all `.ts` / `.tsx` / `.mts` / `.cts` files.
   */
  include?: RegExp;
  /**
   * Glob patterns to exclude (in addition to node_modules which is always excluded).
   */
  exclude?: RegExp;
}

/**
 * Vite plugin for compile-time codec generation.
 *
 * Add to vite.config.ts:
 *
 *   import { serializerCodegen } from '@perf/serializer/codegen/vite';
 *
 *   export default {
 *     plugins: [serializerCodegen()],
 *   };
 *
 * In source code, write:
 *
 *   import { type, u53, f64, str } from '@perf/serializer';
 *   const Ticker = type('Ticker', { symbol: str, last: f64 });
 *
 * The plugin replaces each `type(...)` / `oneOf(...)` call with an inline IIFE
 * that produces the same codec, eliminating runtime `new Function` compilation.
 */
export interface VitePlugin {
  name: string;
  enforce?: 'pre' | 'post';
  transform(code: string, id: string): { code: string; map: null } | null;
}

export function serializerCodegen(options: SerializerPluginOptions = {}): VitePlugin {
  const include = options.include ?? /\.(?:ts|tsx|mts|cts)$/;
  const exclude = options.exclude;

  return {
    name: 'perf-serializer-codegen',
    enforce: 'pre',
    transform(code: string, id: string) {
      if (id.includes('node_modules')) return null;
      if (!include.test(id)) return null;
      if (exclude && exclude.test(id)) return null;
      // Quick negative: file doesn't even contain the word `type` or `oneOf`
      if (!code.includes('type(') && !code.includes('oneOf(')) return null;

      try {
        const result = transform(code, id, options);
        if (result.transformedCount === 0) return null;
        return { code: result.code, map: null };
      } catch (err) {
        // Don't break the build on parse errors — leave source as-is so the
        // runtime fallback handles it.
        const msg = (err as Error).message ?? String(err);
        // eslint-disable-next-line no-console
        console.warn(`[perf-serializer-codegen] skipped ${id}: ${msg}`);
        return null;
      }
    },
  };
}

export default serializerCodegen;
