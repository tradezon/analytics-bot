import { Telegraf, Scenes, Markup } from 'telegraf';
import type {
  SignalRepository,
  SignalSettings,
  User
} from '../repository/types';
import type { BaseScene } from 'telegraf/src/scenes/base';
import type { Markup as MarkupClass } from 'telegraf/src/markup';
import type { InlineKeyboardMarkup } from 'telegraf/src/core/types/typegram';
import { join, bold, spoiler, italic } from 'telegraf/format';

export function signal(
  bot: Telegraf,
  repository: SignalRepository
): BaseScene<any> {
  const toggleFollowsAction = 'FOLLOWS_ACTION';
  const toggleHideSensitiveAction = 'HIDE_SENSITIVE_ACTION';
  const scenario = new Scenes.BaseScene('SCENARIO_SIGNAL');
  const renderReplyButtons = (
    settings: SignalSettings
  ): MarkupClass<InlineKeyboardMarkup> => {
    return Markup.inlineKeyboard([
      Markup.button.callback(
        `Follows ${settings.follows ? '✅' : '❌'}`,
        toggleFollowsAction
      ),
      Markup.button.callback(
        `Spoiler text ${settings.hideSensitiveData ? '✅' : '❌'}`,
        toggleHideSensitiveAction
      )
    ]);
  };

  scenario.enter(async (ctx) => {
    const settings = await repository.getSettings(ctx.state.user);
    const replyButtons = renderReplyButtons(settings);
    return ctx.reply(
      join(
        [
          join(['🛎️️️ ', bold('Signals settings:'), '\n']),
          '📍 Follows - receive signals from followed addresses tradings.',
          join([
            '🚧 Spoiler text - hide addresses in signals 👉 ',
            spoiler(italic('address here')),
            '.'
          ])
        ],
        '\n'
      ),
      replyButtons
    );
  });

  scenario.action(toggleFollowsAction, async (ctx) => {
    const settings = await repository.toggleFollows(ctx.state.user);
    return ctx.editMessageReplyMarkup(
      renderReplyButtons(settings).reply_markup
    );
  });

  scenario.action(toggleHideSensitiveAction, async (ctx) => {
    const settings = await repository.toggleHideSensitive(ctx.state.user);
    return ctx.editMessageReplyMarkup(
      renderReplyButtons(settings).reply_markup
    );
  });

  return scenario as any;
}
