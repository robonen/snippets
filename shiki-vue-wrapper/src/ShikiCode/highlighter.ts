import { createHighlighterCore, type HighlighterCore } from 'shiki/core';
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript';
import js from 'shiki/langs/javascript.mjs';
import aurora from 'shiki/themes/aurora-x.mjs';

const createShiki = () =>
  createHighlighterCore({
    langs: [js],
    themes: [aurora],
    engine: createJavaScriptRegexEngine(),
  });

let instance: Promise<HighlighterCore> | null =
  import.meta.hot?.data.shiki ?? null;

export const getShiki = () => {
  if (!instance) {
    instance = createShiki();
    if (import.meta.hot) import.meta.hot.data.shiki = instance;
  }
  return instance;
}

export const disposeShiki = async () => {
  if (!instance) return;
  ;(await instance).dispose();
  instance = null;
  if (import.meta.hot) import.meta.hot.data.shiki = undefined;
}

if (import.meta.hot) import.meta.hot.accept();