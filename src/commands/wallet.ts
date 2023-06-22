// @ts-expect-error
import EtherscanApi from 'etherscan-api';
import { Telegraf, Scenes, Markup } from 'telegraf';
import { getAddress, JsonRpcProvider, WebSocketProvider } from 'ethers';
import dayjs from 'dayjs';
import customParseFormat from 'dayjs/plugin/customParseFormat';
dayjs.extend(customParseFormat);
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
import { findBlockByTimestamp } from '../utils/find-block-by-timestamp';

const _3MonthsInSeconds = 3 * 30 * 24 * 60 * 60;

function replyWithShortView(ctx: any, report: Report) {
  const [shortReport, losses] = renderShort(report);
  const buttons: any[] = [];
  if (losses != 0) {
    buttons.push(
      Markup.button.callback(
        `Losses (${losses.toFixed(0)}$) 📉`,
        `losses_${report.id}`
      )
    );
  }
  if (report.tokensInWallet > 0) {
    buttons.push(
      Markup.button.callback(
        `Current coins (${report.tokensInWallet}) 📊`,
        `current_${report.id}`
      )
    );
  }
  return ctx.replyWithMarkdownV2(shortReport, {
    ...Markup.inlineKeyboard(buttons),
    disable_web_page_preview: true
  });
}

async function generateReport(
  etherscanApi: any,
  provider: JsonRpcProvider | WebSocketProvider,
  analyticEngine: AnalyticsEngine,
  wallet: string,
  blockStart: number,
  blockEnd?: number,
  period?: [number, number]
): Promise<Report | null> {
  let endPeriod: number = 0;
  if (!blockEnd) {
    endPeriod = Date.now();
  } else {
    const block = await provider.getBlock(blockEnd);
    if (!block) {
      throw new Error('no block data');
    }
    endPeriod = block.timestamp * 1000;
  }
  const allSwaps = await getAllSwaps(
    wallet,
    etherscanApi,
    provider,
    blockStart,
    blockEnd
  );
  if (!allSwaps) throw new Error('Did not found swaps');
  if (allSwaps.swaps.length === 0) {
    return null;
  }

  const block = await provider.getBlock(blockStart);
  if (!block) {
    throw new Error('no block data');
  }
  const report = await analyticEngine.execute(
    wallet,
    period || [allSwaps.start, endPeriod],
    allSwaps
  );
  return report;
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
      const txt = (ctx.message as any)?.text;
      if (!txt) return ctx.wizard.back();

      let addr: string;
      try {
        addr = getAddress((ctx.message as any).text);
        await provider.getBalance(addr);
        (ctx.wizard.state as any).address = addr;
        ctx.reply('Select time range:', {
          ...Markup.inlineKeyboard([
            Markup.button.callback('Latest 🔎', 'Latest 🔎'),
            Markup.button.callback('Select period 🚩', 'Select period 🚩')
          ])
        });
        ctx.wizard.next();
      } catch (e: any) {
        console.log(e.toString());
        console.log(e.stack);
        ctx.replyWithHTML('<b>Wrong wallet address</b> ❌');
      }
    },
    async (ctx) => {
      if (!(ctx.callbackQuery as any)?.data) return ctx.wizard.back();
      const data = (ctx.callbackQuery as any).data;
      if (data === 'Select period 🚩') {
        ctx.reply(
          'Enter period in format DD.MM.YYYY DD.MM.YYYY, e.g. 25.01.2022 30.06.2022\nMaximum range is 3 month.'
        );
        return ctx.wizard.next();
      }
      const wallet = (ctx.wizard.state as any).address;
      if (!wallet) {
        ctx.replyWithHTML('<b>Wallet not found</b> ❌');
        return ctx.scene.leave();
      }
      ctx.reply(`Preparing report for ${wallet}... ⌛`);

      try {
        const report = await generateReport(
          etherscanApi,
          provider,
          analyticEngine,
          wallet,
          getBlockNumber()
        );
        if (report) {
          reportsCache.set(report.id, report);
          replyWithShortView(ctx, report);
        } else {
          ctx.replyWithHTML('Trade transactions was not found 💸');
        }
        return ctx.scene.leave();
      } catch (e: any) {
        console.log(e.toString());
        console.log(e.stack);
        ctx.replyWithHTML('<b>Execution error.</b>Try later.. ❌');
        return ctx.scene.leave();
      }
    },
    async (ctx) => {
      const txt = (ctx.message as any)?.text;
      if (!txt) ctx.wizard.back();

      const [startStr, endStr] = txt.split(' ');
      if (!startStr.trim() || !endStr.trim()) {
        ctx.replyWithHTML(
          '<b>Wrong format</b>Expected <i>DD.MM.YYYY DD.MM.YYYY</i> ❌'
        );
        return;
      }
      const start = dayjs(startStr, 'DD.MM.YYYY');
      const end = dayjs(endStr, 'DD.MM.YYYY');
      const wallet = (ctx.wizard.state as any).address;
      if (!start.isValid() || !end.isValid()) {
        ctx.replyWithHTML(
          '<b>Wrong format</b>Expected <i>DD.MM.YYYY DD.MM.YYYY</i> ❌'
        );
        return;
      }
      if (!wallet) {
        ctx.replyWithHTML('<b>Wallet not found</b> ❌');
        return ctx.scene.leave();
      }

      try {
        const [blockStart, blockEnd] = await Promise.all([
          findBlockByTimestamp(start.unix(), provider),
          findBlockByTimestamp(end.unix(), provider)
        ]);
        if (!blockStart || !blockEnd) throw new Error('No block found');
        if (blockEnd.timestamp - blockStart.timestamp > _3MonthsInSeconds) {
          ctx.replyWithHTML('<b>Too long range</b>. try one more time ❌');
          return;
        }
        ctx.reply(`Preparing report for ${wallet}... ⌛`);

        const report = await generateReport(
          etherscanApi,
          provider,
          analyticEngine,
          wallet,
          blockStart.number,
          blockEnd.number,
          [blockStart.timestamp * 1000, blockEnd.timestamp * 1000]
        );
        if (report) {
          reportsCache.set(report.id, report);
          replyWithShortView(ctx, report);
        } else {
          ctx.replyWithHTML('Trade transactions was not found 💸');
        }
        return ctx.scene.leave();
      } catch (e: any) {
        console.log(e.toString());
        console.log(e.stack);
        ctx.replyWithHTML('<b>Execution error.</b>Try later.. ❌');
        return ctx.scene.leave();
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
