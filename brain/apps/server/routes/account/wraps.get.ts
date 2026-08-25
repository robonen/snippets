import { HTTPError, defineEventHandler } from 'nitro/h3';
import { hasSession } from '../../utils/request';
import { listWraps } from '../../utils/wraps';

/**
 * Обёртки ключа для нового устройства (docs/01-security.md §2, §7).
 *
 * Только cookie — БЕЗ Bearer-фолбэка (в отличие от `/sync/...`): `SYNC_TOKEN`
 * открывает регистрацию credential'а, а не чтение чужих обёрток ключа
 * (`utils/request.ts`, план Р2 «(а)»). Сервер отдаёт байты как есть — он их не
 * читает и не может: обёртка бесполезна без своего KEK (план Р5).
 */
export default defineEventHandler(async (event) => {
  if (!(await hasSession(event))) {
    throw new HTTPError({ status: 401, message: 'нет сессии' });
  }
  return listWraps();
});
