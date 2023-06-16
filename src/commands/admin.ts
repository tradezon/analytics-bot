import path from 'path';
import { Scenes, Markup } from 'telegraf';
import type { BaseScene } from 'telegraf/src/scenes/base';
import sqlite3 from 'sqlite3';
import { Database, open } from 'sqlite';
import { markdownUserLink } from '../utils/telegram';

export enum Lang {
  EN = 0,
  RU = 1
}

export enum Tier {
  GOD_MODE = 0,
  RESERVED1 = 1,
  RESERVED2 = 2,
  TIER0 = 3
}

export interface User {
  id: number;
  telegram_username: string;
  lang: Lang;
  tier: Tier;
  last_access: number;
}

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

export async function admin(): Promise<[BaseScene<any>, Database]> {
  const filePath = path.resolve(__dirname, 'anal_bot.db');
  const db = await open({
    filename: filePath,
    driver: sqlite3.Database
  });
  console.log(`Using db from ${filePath}`);
  console.log(`Migrating db..`);
  await db.migrate({
    migrationsPath: path.resolve(__dirname, 'migrations')
  });
  const usersAction = 'USERS_ACTION';
  const addUserAction = 'ADD_USER_ACTION';
  const removeUserAction = 'REMOVE_USER_ACTION';
  const scenario = new Scenes.BaseScene('SCENARIO_USERS');
  scenario.enter((ctx) => {
    ctx.reply(
      'Actions:',
      Markup.inlineKeyboard([
        Markup.button.callback('Users', usersAction),
        Markup.button.callback('Add user', addUserAction),
        Markup.button.callback('Remove user', removeUserAction)
      ])
    );
  });
  scenario.action(usersAction, async (ctx) => {
    const res: User[] = await db.all('SELECT * from User');
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
    const res: User[] = await db.all('SELECT * from User');
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
    debugger;
    const match = ctx.message?.text.match(/delete_(.+)$/);
    if (!match) return next();
    const id = match[1];
    try {
      await db.run('DELETE FROM User WHERE telegram_username LIKE (?)', id);
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
      await db.run(
        'INSERT INTO User (telegram_username, lang, tier, last_access) VALUES ((?), 0, 3, 0)',
        username.startsWith('@') ? username.slice(1) : username
      );
      ctx.replyWithHTML('<b>Added</b> 🤙');
      (ctx as any).scene.state.inAdd = false;
      (ctx as any).scene.leave();
    } catch {
      ctx.replyWithHTML('<b>Error during insert</b> ❌');
    }
  });

  return [scenario as any, db];
}
