import path from 'path';
import { Context, Markup, Scenes, session, Telegraf } from 'telegraf';
import { JsonRpcProvider, WebSocketProvider } from 'ethers';
import { readConfig } from './config';
import { wallet } from './commands/wallet';
import { admin, Tier, User } from './commands/admin';
import { createAuthMiddleware } from './utils/telegram-auth-middleware';
import { findBlockByTimestamp } from './utils/find-block-by-timestamp';

const WALLET_TEXT = 'Wallet analytics 💰';
const ADMIN_TEXT = 'Admin panel 👑';
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
  const buttons: string[] = [WALLET_TEXT];
  const user = ctx.state.user as User;
  if (user.tier === Tier.GOD_MODE) {
    buttons.push(ADMIN_TEXT);
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
  let blockNumber = initialBlock.number;
  setInterval(() => blockNumber++, 10 * 1000).unref();
  console.log(`Initial block number ${blockNumber}`);
  const bot = new Telegraf(config.token);
  bot.use(Telegraf.log());
  const [adminScenario, db] = await admin();
  const walletScenario = wallet(bot, provider, () => blockNumber);
  const stage = new Scenes.Stage([walletScenario as any, adminScenario as any]);
  bot.use(session());
  bot.use(createAuthMiddleware(db));
  bot.use(
    scenes([
      [ADMIN_TEXT, adminScenario.id],
      ['/admin', adminScenario.id],
      [WALLET_TEXT, walletScenario.id],
      ['/wallet', walletScenario.id]
    ])
  );

  bot.use(stage.middleware() as any);

  bot.start((ctx) => {
    ctx.reply(
      'Welcome to tradezon analytics bot 👋\nBot provides wallets trading analytics',
      Markup.keyboard(menuButtons(ctx)).resize()
    );
  });

  bot.command('admin', Scenes.Stage.enter(adminScenario.id) as any);
  bot.command('wallet', Scenes.Stage.enter(walletScenario.id) as any);
  bot.hears(ADMIN_TEXT, Scenes.Stage.enter(adminScenario.id) as any);
  bot.hears(WALLET_TEXT, Scenes.Stage.enter(walletScenario.id) as any);

  bot.launch();

  console.log('Running bot..');

  const shutdown = () => {
    db.close();
    bot.stop();
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main();
