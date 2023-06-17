// @ts-expect-error
import EtherscanApi from 'etherscan-api';
import { Telegraf, Scenes, Markup } from 'telegraf';
import { getAddress, JsonRpcProvider, WebSocketProvider } from 'ethers';
import type { BaseScene } from 'telegraf/src/scenes/base';
import { getAllSwaps } from '../transactions';
import { AnalyticsEngine } from '../analytics';
import reportsCache from '../analytics/cache';
import {
  renderCurrentTokens,
  renderLosses,
  renderShort
} from '../utils/telegram';
import { Report } from '../types';

function replyWithShortView(ctx: any, report: Report) {
  const [shortReport, losses] = renderShort(report);
  const buttons: any[] = [];
  if (losses != 0) {
    buttons.push(
      Markup.button.callback(`Losses (${losses.toFixed(0)}$) 📉`, `losses_${report.id}`)
    );
  }
  if (report.wallet.length > 0) {
    buttons.push(
      Markup.button.callback(`Current coins (${report.wallet.length}) 📊`, `current_${report.id}`)
    );
  }
  return ctx.replyWithMarkdownV2(shortReport, {
    ...Markup.inlineKeyboard(buttons),
    disable_web_page_preview: true
  });
}

export function wallet(
  bot: Telegraf,
  provider: JsonRpcProvider | WebSocketProvider,
  getBlockNumber: () => number
): BaseScene<any> {
  const etherscanApi = EtherscanApi.init('QMW2MPMAM4T9HWH3STPPK836GRWQX1QW3Q');
  const analyticEngine = new AnalyticsEngine(provider, async () => {
    const { result } = await etherscanApi.stats.ethprice();
    return result.ethusd;
  });
  const scenarioTypeWallet = new Scenes.WizardScene(
    'SCENARIO_TYPE_WALLET',
    ((ctx: any) => {
      ctx.replyWithHTML(
        '<b>Type wallet address</b> 🖊️ <i>only Etherium mainnet supported in alpha</i>'
      );
      return ctx.wizard.next();
    }) as any,
    async (ctx) => {
      if ((ctx.message as any)?.text) {
        let addr: string;
        try {
          addr = getAddress((ctx.message as any).text);
          await provider.getBalance(addr);
          ctx.reply(`Preparing report for ${addr}... ⌛`);
        } catch (e: any) {
          console.log(e.message || e.toString());
          ctx.replyWithHTML('<b>Wrong wallet address</b> ❌');
          return;
        }
        try {
          const now = Date.now();
          const blockNumber = getBlockNumber();
          const swaps = await getAllSwaps(
            addr!,
            etherscanApi,
            provider,
            blockNumber
          );
          if (!swaps) {
            ctx.replyWithHTML('<b>Execution error.</b>Try later.. ❌');
            return ctx.scene.leave();
          }
          if (swaps.length === 0) {
            ctx.replyWithHTML('Trade transactions was not found 💸');
            return ctx.scene.leave();
          }

          const block = await provider.getBlock(blockNumber);
          if (!block) {
            throw new Error('no block data');
          }
          const report = await analyticEngine.execute(
            addr!,
            [block.timestamp * 1000, now],
            swaps
          );
          reportsCache.set(report.id, report);
          replyWithShortView(ctx, report);
          return ctx.scene.leave();
        } catch (e: any) {
          console.log(e.message || e.toString());
          ctx.replyWithHTML('<b>Execution error.</b>Try later.. ❌');
        }
      } else {
        ctx.replyWithHTML('<b>Type wallet address</b> 🖊️');
      }
    }
  );

  bot.action(/^losses_(.+)/, (ctx) => {
    const id = ctx.match[1];
    const report = reportsCache.get(id);
    if (!report) {
      return ctx.replyWithHTML('<b>Report not found</b> ❌');
    }
    return ctx.replyWithMarkdownV2(renderLosses(report), {
      ...Markup.inlineKeyboard([
        Markup.button.callback(`Return to report ⬅️`, `short_${report.id}`)
      ]),
      disable_web_page_preview: true
    });
  });

  bot.action(/^current_(.+)/, (ctx) => {
    const id = ctx.match[1];
    const report = reportsCache.get(id);
    if (!report) {
      return ctx.replyWithHTML('<b>Report not found</b> ❌');
    }
    return ctx.replyWithMarkdownV2(renderCurrentTokens(report), {
      ...Markup.inlineKeyboard([
        Markup.button.callback(`Return to report ⬅️`, `short_${report.id}`)
      ]),
      disable_web_page_preview: true
    });
  });

  bot.action(/^short_(.+)/, (ctx) => {
    const id = ctx.match[1];
    const report = reportsCache.get(id);
    if (!report) {
      return ctx.replyWithHTML('<b>Report not found</b> ❌');
    }
    return replyWithShortView(ctx, report);
  });

  return scenarioTypeWallet as any;
}
