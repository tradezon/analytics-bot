import type { Telegraf } from 'telegraf';
import type { ExtraReplyMessage } from 'telegraf/src/telegram-types';
import type { FmtString } from 'telegraf/src/format';
import { User, UserRepository } from '../repository/types';
import logger from '../logger';

export interface NotificationService {
  notify(
    user: User | number,
    text: string | FmtString,
    extra?: ExtraReplyMessage
  ): Promise<boolean>;
}

export function createNotificationService(
  repository: UserRepository,
  bot: Telegraf
): NotificationService {
  const notify = async (
    user: User | number,
    text: string | FmtString,
    extra?: ExtraReplyMessage
  ): Promise<boolean> => {
    const currentUser = await repository.getUserById(
      typeof user === 'number' ? user : user.id
    );
    if (!currentUser) return false;
    try {
      const result = await bot.telegram.sendMessage(
        currentUser.chat_id,
        text,
        extra
      );
      if (result) return true;
    } catch (e: any) {
      logger.warn(e.toString());
      return false;
    }
    return false;
  };
  return {
    notify
  };
}
