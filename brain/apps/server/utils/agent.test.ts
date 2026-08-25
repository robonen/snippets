import { describe, expect, it } from 'vitest';
import { labelFromUserAgent } from './agent';

const IPHONE_SAFARI = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 '
  + '(KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const MAC_CHROME = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) '
  + 'Chrome/128.0.0.0 Safari/537.36';
const WINDOWS_EDGE = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) '
  + 'Chrome/128.0.0.0 Safari/537.36 Edg/128.0.0.0';
const ANDROID_CHROME = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) '
  + 'Chrome/128.0.0.0 Mobile Safari/537.36';
const MAC_FIREFOX = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:130.0) Gecko/20100101 Firefox/130.0';

describe(labelFromUserAgent, () => {
  it('распознаёт устройство и браузер вместе', () => {
    expect(labelFromUserAgent(IPHONE_SAFARI)).toBe('Safari на iPhone');
    expect(labelFromUserAgent(MAC_CHROME)).toBe('Chrome на Mac');
    expect(labelFromUserAgent(MAC_FIREFOX)).toBe('Firefox на Mac');
  });

  it('Edge узнаётся РАНЬШЕ Chrome, хотя строка несёт оба токена', () => {
    expect(labelFromUserAgent(WINDOWS_EDGE)).toBe('Edge на Windows');
  });

  it('Android — тоже Linux по подстроке, но правило Android проверяется раньше', () => {
    expect(labelFromUserAgent(ANDROID_CHROME)).toBe('Chrome на Android');
  });

  it('пусто, undefined и null — честный фолбэк, не пустая строка и не исключение', () => {
    expect(labelFromUserAgent('')).toBe('неизвестное устройство');
    expect(labelFromUserAgent(undefined)).toBe('неизвестное устройство');
    expect(labelFromUserAgent(null)).toBe('неизвестное устройство');
  });

  it('незнакомая строка без опознаваемых токенов — тоже честный фолбэк', () => {
    expect(labelFromUserAgent('curl/8.4.0')).toBe('неизвестное устройство');
  });
});
