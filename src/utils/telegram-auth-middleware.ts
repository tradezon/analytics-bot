import type { Database } from 'sqlite';
import type { Middleware, Context } from 'telegraf';
import { Lang, User, UserRepository } from '../repository/types';

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
    ctx.state.user = row;
    try {
      const langFromTelegram = ctx.from?.language_code;
      repository.updateUser(
        username,
        row.last_access === 0
          ? langFromTelegram === 'ua' || langFromTelegram === 'ru'
            ? Lang.RU
            : Lang.EN
          : row.lang,
        row.tier,
        Date.now()
      );
    } catch {}
    next();
  };
}
