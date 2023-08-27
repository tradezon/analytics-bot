import { Markup, Scenes } from 'telegraf';
import type { BaseScene } from 'telegraf/src/scenes/base';
import { markdownUserLink } from '../utils/telegram';
import { Lang, Tier, User, UserRepository } from '../repository/types';

function tierToString(tier: Tier): string {
  switch (tier) {
    case Tier.GOD_MODE:
      return 'GOD MODE';
    case Tier.TIER0:
      return 'Tier 0';
    default:
      return '';
  }
}

export function admin(repository: UserRepository): BaseScene<any> {
  const usersAction = 'USERS_ACTION';
  const addUserAction = 'ADD_USER_ACTION';
  const removeUserAction = 'REMOVE_USER_ACTION';
  const scenario = new Scenes.BaseScene('SCENARIO_USERS');
  scenario.enter((ctx) => {
    return ctx.reply(
      'Actions:',
      Markup.inlineKeyboard([
        Markup.button.callback('Users', usersAction),
        Markup.button.callback('Add user', addUserAction),
        Markup.button.callback('Remove user', removeUserAction)
      ])
    );
  });
  scenario.action(usersAction, async (ctx) => {
    const res: User[] = await repository.getUsers();
    ctx.replyWithMarkdownV2(
      `Users:\n${res
        .map(
          ({ telegram_username, tier }) =>
            `\\- ${markdownUserLink(
              `${telegram_username} ${tierToString(tier)}`,
              telegram_username
            )}`
        )
        .join('\n')}`
    );
  });
  scenario.action(addUserAction, (ctx) => {
    (ctx as any).scene.state.inAdd = true;
    ctx.replyWithHTML('<b>Send user link</b> 👤');
  });
  scenario.action(removeUserAction, async (ctx) => {
    const res: User[] = await repository.getUsers();
    ctx.replyWithMarkdownV2(
      `Users:\n${res
        .map(
          ({ telegram_username, tier }) =>
            `\\- \\/delete\\_${telegram_username} ${markdownUserLink(
              `${telegram_username} ${tierToString(tier)}`,
              telegram_username
            )}`
        )
        .join('\n')}`
    );
  });
  scenario.command(/delete_(.+)$/, async (ctx, next) => {
    const match = ctx.message?.text.match(/delete_(.+)$/);
    if (!match) return next();
    const id = match[1];
    try {
      await repository.deleteUser(id);
      ctx.replyWithHTML('<b>Removed</b> 🤙');
      (ctx as any).scene.leave();
    } catch {
      ctx.replyWithHTML('<b>Error during delete</b> ❌');
    }
  });
  scenario.on('text', async (ctx) => {
    if (!(ctx as any).scene.state.inAdd) {
      return;
    }
    const text = ctx.message?.text;
    if (!text) {
      (ctx as any).scene.state.inAdd = false;
      return;
    }
    const username = text.trim();
    try {
      await repository.addUser(username, Lang.EN, Tier.TIER0);
      ctx.replyWithHTML('<b>Added</b> 🤙');
      (ctx as any).scene.state.inAdd = false;
      (ctx as any).scene.leave();
    } catch {
      ctx.replyWithHTML('<b>Error during insert</b> ❌');
    }
  });

  return scenario as any;
}
