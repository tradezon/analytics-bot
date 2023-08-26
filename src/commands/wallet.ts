// @ts-expect-error
import EtherscanApi from 'etherscan-api';
import { Telegraf, Scenes, Markup } from 'telegraf';
import type { Markup as MarkupClass } from 'telegraf/src/markup';
import { getAddress, JsonRpcProvider, WebSocketProvider } from 'ethers';
import dayjs from 'dayjs';
import customParseFormat from 'dayjs/plugin/customParseFormat';
dayjs.extend(customParseFormat);
import type { BaseScene } from 'telegraf/src/scenes/base';
import { getAllSwaps } from '../transactions';
import { AnalyticsEngine } from '../analytics';
import reportsCache from '../analytics/cache';
import { renderLosses, renderShort, renderTokensList } from '../utils/telegram';
import { Report } from '../types';
import { findBlockByTimestamp } from '../utils/find-block-by-timestamp';
import logger from '../logger';
import { FollowsRepository, User } from '../repository/types';
import { NotificationService } from '../bot/notification';

const secondsInDay = 24 * 60 * 60;
const monthInSeconds = 30 * secondsInDay;
const _3MonthsInSeconds = 3 * monthInSeconds;
const _7DaysInSeconds = 7 * secondsInDay;
const _14DaysInSeconds = 14 * secondsInDay;
const secondsPerBlock = 12;
const blocksIn7Days = Math.ceil(_7DaysInSeconds / secondsPerBlock);
const blocksIn14Days = Math.ceil(_14DaysInSeconds / secondsPerBlock);
const blocksInMonth = Math.ceil(monthInSeconds / secondsPerBlock);

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
  logger.debug(`Getting all swaps for ${wallet}`);
  const allSwaps = await getAllSwaps(
    wallet,
    etherscanApi,
    provider,
    blockStart,
    blockEnd
  );
  if (!allSwaps) {
    throw new Error('Did not found swaps');
    logger.warn(`Swaps searching error for ${wallet}`);
  }
  if (allSwaps.swaps.length === 0) {
    logger.debug(`No swaps found for ${wallet}`);
    return null;
  }

  logger.trace(`got all swaps for ${wallet}`);

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
  notification: NotificationService,
  provider: JsonRpcProvider | WebSocketProvider,
  dexguru: string,
  followsRepository: FollowsRepository,
  getBlockNumber: () => number
): BaseScene<any> {
  const etherscanApi = EtherscanApi.init('QMW2MPMAM4T9HWH3STPPK836GRWQX1QW3Q');
  const analyticEngine = new AnalyticsEngine(provider, dexguru, async () => {
    const { result } = await etherscanApi.stats.ethprice();
    return result.ethusd;
  });

  let exec = false;
  const queue: Array<{
    user: User;
    messageId?: number;
    wallet: string;
    blockStart: number;
    blockEnd?: number;
    period?: [number, number];
  }> = [];
  const paramsForShortView = async (
    report: Report,
    user: User | undefined
  ): Promise<[string, MarkupClass<any>]> => {
    const [shortReport, losses] = renderShort(report);
    const buttons: any[][] = [[], [], []];

    if (losses != 0) {
      buttons[0].push(
        Markup.button.callback(
          `Losses (${losses.toFixed(0)}$) 📉`,
          `losses_${report.id}`
        )
      );
    }
    if (report.tokensInWallet > 0) {
      buttons[0].push(
        Markup.button.callback(
          `Current coins (${report.tokensInWallet}) 📊`,
          `current_${report.id}`
        )
      );
    }

    if (report.honeypots) {
      buttons[1].push(
        Markup.button.callback(
          `${report.honeypots.tokens.length} Honeypots ⚠️`,
          `honeypots_${report.id}`
        )
      );
    }

    if (user) {
      const follows = await followsRepository.getUserFollows(user);
      const isFollowing = follows.follows.has(report.address.toLowerCase());
      (buttons[0].length === 0 ? buttons[0] : buttons[1]).push(
        Markup.button.callback(
          `Follow ${isFollowing ? '✅' : '❌'}️`,
          `follow_${report.id}`
        )
      );
    }

    return [
      shortReport,
      Markup.inlineKeyboard(buttons.filter((b) => b.length !== 0))
    ];
  };
  const replyWithShortView = async (
    report: Report,
    user: User,
    message?: number
  ) => {
    const [data, markup] = await paramsForShortView(report, user);
    return notification.notify(user, data, {
      ...markup,
      parse_mode: 'MarkdownV2',
      disable_web_page_preview: true,
      reply_to_message_id: message
    });
  };
  const computeBlockStart =
    (blocksRange: number) =>
    async (ctx: any): Promise<[number, number] | null> => {
      const current = await provider.getBlock('latest');
      if (!current) {
        logger.error('current block not found');
        ctx.replyWithHTML('<b>Internal error</b> ❌');
        ctx.scene.leave();
        return null;
      }
      return [current.number - blocksRange, current.number];
    };
  const lastWeekStart = computeBlockStart(blocksIn7Days);
  const last2WeekStart = computeBlockStart(blocksIn14Days);
  const lastMonthStart = computeBlockStart(blocksInMonth);
  const generateReports = async () => {
    if (queue.length === 0 || exec) return;
    exec = true;
    logger.info(`Processing ${queue[0].wallet}`);
    for (const {
      user,
      messageId,
      wallet,
      blockStart,
      blockEnd,
      period
    } of queue) {
      try {
        const report = await generateReport(
          etherscanApi,
          provider,
          analyticEngine,
          wallet,
          blockStart,
          blockEnd,
          period
        );

        if (report) {
          reportsCache.set(report.id, report);
          replyWithShortView(report, user, messageId);
        } else {
          notification.notify(
            user,
            `Trade transactions was not found for ${wallet} 💸`,
            {
              reply_to_message_id: messageId
            }
          );
        }
      } catch (e: any) {
        logger.error(e);
        notification.notify(
          user,
          `<b>Execution error for ${wallet}</b> Try later.. ❌`,
          {
            parse_mode: 'HTML',
            reply_to_message_id: messageId
          }
        );
      }
    }
    queue.length = 0;
    exec = false;
  };
  setInterval(generateReports, 60).unref();

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
            [
              Markup.button.callback('Latest 🔎', 'Latest 🔎'),
              Markup.button.callback('Select period 🚩', 'Select period 🚩')
            ],
            [Markup.button.callback('Last month', 'Last month')],
            [
              Markup.button.callback('Last week', 'Last week'),
              Markup.button.callback('Last 2 weeks', 'Last 2 weeks')
            ]
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
      let blockStart: number | undefined = undefined;
      let blockEnd: number | undefined = undefined;
      switch (data) {
        case 'Select period 🚩': {
          ctx.editMessageText(
            'Enter period in format DD.MM.YYYY DD.MM.YYYY, e.g. 25.01.2022 30.06.2022\nMaximum range is 3 month.'
          );
          return ctx.wizard.next();
        }
        case 'Last week': {
          const range = await lastWeekStart(ctx);
          if (range === null) return;
          blockStart = range[0];
          blockEnd = range[1];
          break;
        }
        case 'Last 2 weeks': {
          const range = await last2WeekStart(ctx);
          if (range === null) return;
          blockStart = range[0];
          blockEnd = range[1];
          break;
        }
        case 'Last month': {
          const range = await lastMonthStart(ctx);
          if (range === null) return;
          blockStart = range[0];
          blockEnd = range[1];
          break;
        }
        default:
          break;
      }
      const wallet = (ctx.wizard.state as any).address;
      if (!wallet) {
        ctx.replyWithHTML('<b>Wallet not found</b> ❌');
        return ctx.scene.leave();
      }
      ctx.editMessageText(`Preparing report for ${wallet}... ⌛`);

      queue.push({
        user: ctx.state.user,
        messageId: ctx.message?.message_id,
        wallet,
        blockStart: blockStart || getBlockNumber(),
        blockEnd
      });
      return ctx.scene.leave();
    },
    async (ctx) => {
      const txt = (ctx.message as any)?.text;
      if (!txt) return ctx.wizard.back();

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

        queue.push({
          user: ctx.state.user,
          messageId: ctx.message?.message_id,
          wallet,
          blockStart: blockStart.number,
          blockEnd: blockEnd.number,
          period: [blockStart.timestamp * 1000, blockEnd.timestamp * 1000]
        });
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

    return ctx.editMessageText(renderLosses(report), {
      ...Markup.inlineKeyboard([
        Markup.button.callback(`Return to report ⬅️`, `short_${report.id}`)
      ]),
      disable_web_page_preview: true,
      parse_mode: 'MarkdownV2'
    });
  });

  bot.action(/^current_(.+)/, (ctx) => {
    const id = ctx.match[1];
    const report = reportsCache.get(id);
    if (!report) {
      return ctx.replyWithHTML('<b>Report not found</b> ❌');
    }

    return ctx.editMessageText(
      renderTokensList(
        '📊 *Current coins in wallet*\\:',
        report,
        report.tokens
          .filter((t) => t.inWallet)
          .sort((a, b) =>
            a.balance ? (b.balance ? b.balance.usd - a.balance.usd : 1) : -1
          ),
        true
      ),
      {
        ...Markup.inlineKeyboard([
          Markup.button.callback(`Return to report ⬅️`, `short_${report.id}`)
        ]),
        disable_web_page_preview: true,
        parse_mode: 'MarkdownV2'
      }
    );
  });

  bot.action(/^short_(.+)/, async (ctx) => {
    const id = ctx.match[1];
    const report = reportsCache.get(id);
    if (!report) {
      return ctx.replyWithHTML('<b>Report not found</b> ❌');
    }

    const [text, markup] = await paramsForShortView(report, ctx.state.user);

    ctx.editMessageText(text, {
      ...markup,
      parse_mode: 'MarkdownV2',
      disable_web_page_preview: true
    });
  });

  bot.action(/^honeypots_(.+)/, (ctx) => {
    const id = ctx.match[1];
    const report = reportsCache.get(id);
    if (!report || !report.honeypots) {
      return ctx.replyWithHTML('<b>Report not found</b> ❌');
    }

    return ctx.editMessageText(
      renderTokensList('⚠️ *Honeypots*\\:', report, report.honeypots.tokens),
      {
        ...Markup.inlineKeyboard([
          Markup.button.callback(`Return to report ⬅️`, `short_${report.id}`)
        ]),
        disable_web_page_preview: true,
        parse_mode: 'MarkdownV2'
      }
    );
  });

  bot.action(/^follow_(.+)/, async (ctx) => {
    const id = ctx.match[1];
    const report = reportsCache.get(id);
    if (!report) {
      return ctx.replyWithHTML('<b>Report not found</b> ❌');
    }

    const bool = await followsRepository.toggleFollow(
      ctx.state.user,
      report.address
    );

    if (bool) {
      const [, markup] = await paramsForShortView(report, ctx.state.user);
      return ctx.editMessageReplyMarkup(markup.reply_markup);
    }
  });

  return scenarioTypeWallet as any;
}
