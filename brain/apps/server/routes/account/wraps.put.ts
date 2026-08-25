import { HTTPError, defineEventHandler, readBody } from 'nitro/h3';
import { hasSession } from '../../utils/request';
import { isWrapKind, replaceWraps } from '../../utils/wraps';
import type { StoredWrap } from '../../utils/wraps';

/**
 * Заместить обёртки целиком (docs/01-security.md §2, §7): клиент — владелец
 * истины (у него DEK и все KEK), сервер лишь зеркалит последний снимок.
 *
 * Форма проверяется, СОДЕРЖИМОЕ — нет: `blob` для сервера непрозрачные байты
 * (план Р5). `kind` ограничен `passkey`/`passphrase` — обёртка ключа
 * устройства (`device`) не покидает устройство никогда, и если она сюда
 * всё-таки попала, это дефект клиента, а не то, что стоит молча сохранить.
 */
export default defineEventHandler(async (event) => {
  if (!(await hasSession(event))) {
    throw new HTTPError({ status: 401, message: 'нет сессии' });
  }

  const body = await readBody<unknown>(event);
  if (!Array.isArray(body)) {
    throw new HTTPError({ status: 400, message: 'тело обязано быть массивом обёрток' });
  }

  const wraps: StoredWrap[] = body.map((entry, index) => {
    const v = entry as Partial<StoredWrap> | null;
    if (typeof v !== 'object' || v === null) {
      throw new HTTPError({ status: 400, message: `обёртка №${index}: не объект` });
    }
    if (typeof v.label !== 'string' || v.label === '') {
      throw new HTTPError({ status: 400, message: `обёртка №${index}: пустая метка` });
    }
    if (!isWrapKind(v.kind)) {
      throw new HTTPError({ status: 400, message: `обёртка «${v.label}»: вид «${String(v.kind)}» не годится для сервера` });
    }
    if (typeof v.blob !== 'string' || v.blob === '') {
      throw new HTTPError({ status: 400, message: `обёртка «${v.label}»: пустой blob` });
    }
    return { label: v.label, kind: v.kind, blob: v.blob };
  });

  // Дубликат метки — не ошибка формы, а состояние, которое нельзя молча
  // зеркалить: непонятно, которая из двух копий правда.
  const labels = new Set(wraps.map(w => w.label));
  if (labels.size !== wraps.length) {
    throw new HTTPError({ status: 400, message: 'повторяющаяся метка обёртки в теле запроса' });
  }

  await replaceWraps(wraps);
  return { ok: true };
});
