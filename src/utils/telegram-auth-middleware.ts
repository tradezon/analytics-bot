import type { Middleware, Context } from 'telegraf';
import { Lang } from '../repository/types';
import type { User, UserRepository } from '../repository/types';
import logger from '../logger';

export function createAuthMiddleware(
  repository: UserRepository
): Middleware<Context> {
  const accessDenied = (ctx: Context) => {
    ctx.replyWithHTML('<b>Access denied</b> ❌');
  };
  return async (ctx, next) => {
    const username = ctx.from?.username;
    if (!username) return accessDenied(ctx);
    let row: User | null;
    try {
      row = await repository.getUser(username);
      if (!row) return accessDenied(ctx);
    } catch {
      return accessDenied(ctx);
    }
    const langFromTelegram = ctx.from?.language_code;
    const user: User = {
      ...row,
      lang:
        row.last_access === 0
          ? langFromTelegram === 'ua' || langFromTelegram === 'ru'
            ? Lang.RU
            : Lang.EN
          : row.lang,
      last_access: Date.now(),
      chat_id: ctx.chat?.id || row.chat_id
    };
    ctx.state.user = user;
    logger.trace(`new access user=${username} chat_id=${user.chat_id}`);
    try {
      repository.updateUser(
        user.telegram_username,
        user.lang,
        user.tier,
        user.last_access,
        user.chat_id
      );
    } catch {}
    next();
  };
}
