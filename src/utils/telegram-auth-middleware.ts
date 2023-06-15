import type { Database } from 'sqlite';
import type { Middleware, Context } from 'telegraf';
import type { User } from '../commands/admin';
import { Lang } from '../commands/admin';

export function createAuthMiddleware(db: Database): Middleware<Context> {
  const accessDenied = (ctx: Context) => {
    ctx.replyWithHTML('<b>Access denied</b> ❌');
  };
  return async (ctx, next) => {
    const username = ctx.from?.username;
    if (!username) return accessDenied(ctx);
    let row: User | undefined;
    try {
      row = await db.get(
        'SELECT * from User WHERE telegram_username LIKE (?)',
        username
      );
      if (!row) return accessDenied(ctx);
    } catch {
      return accessDenied(ctx);
    }
    ctx.state.user = row;
    try {
      const langFromTelegram = ctx.from?.language_code;
      db.run(
        'UPDATE User SET lang=(?), last_access=(?) WHERE telegram_username LIKE (?)',
        row.last_access === 0
          ? langFromTelegram === 'ua' || langFromTelegram === 'ru'
            ? Lang.RU
            : Lang.EN
          : row.lang,
        Date.now(),
        username
      );
    } catch {}
    next();
  };
}
