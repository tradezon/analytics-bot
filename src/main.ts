import path from 'path';
import { open } from 'sqlite';
import sqlite3 from 'sqlite3';
import { Context, Markup, Scenes, session, Telegraf } from 'telegraf';
import { JsonRpcProvider, WebSocketProvider } from 'ethers';
import { readConfig } from './config';
import { wallet } from './commands/wallet';
import { admin } from './commands/admin';
import { createAuthMiddleware } from './utils/telegram-auth-middleware';
import { findBlockByTimestamp } from './utils/find-block-by-timestamp';
import logger from './logger';
import { Tier, User } from './repository/types';
import { createSqliteUserRepository } from './repository/user';
import { createSqliteFollowsRepository } from './repository/follows';
import { createNotificationService } from './bot/notification';
import { createSqliteSignalRepository } from './repository/signal';
import { signal } from './commands/signal';

const WALLET_TEXT = 'Wallet analytics 💰';
const ADMIN_TEXT = 'Admin panel 👑';
const SIGNAL_TEXT = 'Signals 🛎️️️';
function scenes(sc: [string, string][]) {
  const map = new Map(sc);
  return (ctx: Context, next: () => Promise<void>) => {
    if ((ctx as any).session?.__scenes?.current) {
      const isNew = (ctx as any).message?.text || '';
      if (map.has(isNew)) {
        delete (ctx as any).session.__scenes;
      }
    }

    return next();
  };
}
function menuButtons(ctx: Context) {
  const buttons: string[][] = [[WALLET_TEXT, SIGNAL_TEXT]];
  const user = ctx.state.user as User;
  if (user.tier === Tier.GOD_MODE) {
    buttons.push([ADMIN_TEXT]);
  }
  return buttons;
}

async function main() {
  const config = await readConfig(
    process.argv[2] || path.resolve(__dirname, 'config.json')
  );
  const provider = config.etherium_mainnet.match(/^https?\:/)
    ? new JsonRpcProvider(config.etherium_mainnet, 'mainnet', {
        batchStallTime: 80
      })
    : new WebSocketProvider(config.etherium_mainnet);
  const initialBlock = await findBlockByTimestamp(
    Date.now() / 1000 - 3 * 7 * 24 * 60 * 60,
    provider
  );
  logger.level = 'trace';

  /* database */
  const filePath = path.resolve(__dirname, 'anal_bot.db');
  const db = await open({
    filename: filePath,
    driver: sqlite3.Database
  });
  logger.info(`Using db from ${filePath}`);
  logger.info(`Migrating db..`);
  await db.migrate({
    migrationsPath: path.resolve(__dirname, 'migrations')
  });
  const userRepository = createSqliteUserRepository(db);
  const followsRepository = createSqliteFollowsRepository(db);
  const signalRepository = createSqliteSignalRepository(db);

  let blockNumber = initialBlock.number;
  setInterval(() => blockNumber++, 10 * 1000).unref();
  logger.info(`Initial block number ${blockNumber}`);
  if (config.dexguru) logger.info('Using dexguru api..');
  const bot = new Telegraf(config.token);
  const notification = createNotificationService(userRepository, bot);
  bot.use(Telegraf.log());
  bot.use(createAuthMiddleware(userRepository));
  const adminScenario = admin(userRepository);
  const walletScenario = wallet(
    bot,
    notification,
    provider,
    config.dexguru,
    followsRepository,
    () => blockNumber
  );
  const signalScenario = signal(bot, signalRepository);
  const stage = new Scenes.Stage([
    walletScenario as any,
    signalScenario as any,
    adminScenario as any
  ]);
  bot.use(session());
  bot.use(
    scenes([
      [ADMIN_TEXT, adminScenario.id],
      ['/admin', adminScenario.id],
      [WALLET_TEXT, walletScenario.id],
      ['/wallet', walletScenario.id],
      [SIGNAL_TEXT, signalScenario.id],
      ['/signal', signalScenario.id]
    ])
  );

  bot.use(stage.middleware() as any);

  const handleMenu = (ctx: any) => {
    return ctx.reply(
      'Welcome to tradezon analytics bot 👋\nBot provides wallets trading analytics',
      Markup.keyboard(menuButtons(ctx)).resize()
    );
  };

  bot.start(handleMenu);
  bot.command('menu', handleMenu);
  bot.command('admin', Scenes.Stage.enter(adminScenario.id) as any);
  bot.command('wallet', Scenes.Stage.enter(walletScenario.id) as any);
  bot.command('signal', Scenes.Stage.enter(signalScenario.id) as any);
  bot.hears(ADMIN_TEXT, Scenes.Stage.enter(adminScenario.id) as any);
  bot.hears(WALLET_TEXT, Scenes.Stage.enter(walletScenario.id) as any);
  bot.hears(SIGNAL_TEXT, Scenes.Stage.enter(signalScenario.id) as any);

  bot.catch((error) => logger.error(error));

  bot.launch();

  logger.info('Running bot..');

  const shutdown = () => {
    db.close();
    bot.stop();
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main();
