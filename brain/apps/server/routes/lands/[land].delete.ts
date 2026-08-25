import { HTTPError, defineHandler } from 'nitro';
import { authorized } from '../../utils/auth';
import { serverConfig } from '../../utils/config';
import { syncHub } from '../../utils/instance';

/**
 * Забыть ленд. Единственная админ-операция протокола: отзыв устройства
 * перепечатывает ленд новым секретом и заливает заново — старый образ с его
 * фейсами обязан исчезнуть, иначе дельта считала бы всё доставленным
 * (utils/hub.ts, `wipe`). Токен обязателен, как и на сокете.
 */
export default defineHandler(async (event) => {
  if (!authorized(event.req.headers.get('authorization'), serverConfig().syncToken)) {
    throw new HTTPError({ status: 401, message: 'access denied' });
  }
  const land = event.context.params?.land ?? '';
  if (land === '' || land.length > 32) {
    throw new HTTPError({ status: 400, message: 'malformed land address' });
  }
  await syncHub().wipe(land);
  return { ok: true };
});
