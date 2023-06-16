// @ts-expect-error
import EtherscanApi from 'etherscan-api';
import { Telegraf, Scenes } from 'telegraf';
import { getAddress, JsonRpcProvider, WebSocketProvider } from 'ethers';
import type { BaseScene } from 'telegraf/src/scenes/base';
import { getAllSwaps } from '../transactions';
import { AnalyticsEngine } from '../analytics';
import { escape } from '../utils/telegram';

export function prettyAddress(addr: string) {
  return `${addr.slice(0, 5)}...${addr.slice(-3)}`;
}

export function hyperLink(url: string, title: string) {
  return `[${title}](${url})`;
}

export function etherscanAddressLink(addr: string) {
  return `https://etherscan.io/address/${addr}`;
}

export function etherscanBlockLink(blockNumber: number) {
  return `https://etherscan.io/block/${blockNumber}`;
}

export function etherscanTransactionLink(txhash: string) {
  return `https://etherscan.io/tx/${txhash}`;
}

function address(addr: string) {
  return hyperLink(etherscanAddressLink(addr), escape(prettyAddress(addr)));
}

function financial(x: string): string {
  return Number.parseFloat(x).toFixed(2);
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
      ctx.replyWithHTML('<b>Type wallet address</b> 🖊️');
      return ctx.wizard.next();
    }) as any,
    async (ctx) => {
      if ((ctx.message as any)?.text) {
        try {
          const addr = getAddress((ctx.message as any).text);
          await provider.getBalance(addr);
          ctx.reply(`Preparing report for ${addr}... ⌛`);
          const swaps = await getAllSwaps(
            addr,
            etherscanApi,
            provider,
            getBlockNumber()
          );
          if (!swaps) {
            ctx.replyWithHTML('<b>Execution error.</b>Try later.. ❌');
            return ctx.scene.leave();
          }

          const report = await analyticEngine.execute(addr, swaps);
          ctx.replyWithMarkdownV2(
            `*PNL ${escape(report.pnlUSD.toFixed(1))}$* \\| *Winrate ${escape(
              report.winrate / 1000
            )}*
Tokens:\n${report.tokens
              .map(
                ({ token, symbol, profitUSD }) =>
                  `${hyperLink(etherscanAddressLink(token), symbol)} ${escape(
                    profitUSD.toFixed(0)
                  )}$ ${profitUSD >= 0 ? '🔼' : '🔽'}`
              )
              .join('\n')}`,
            {
              disable_web_page_preview: true
            }
          );
          return ctx.scene.leave();
        } catch {
          ctx.replyWithHTML('<b>Wrong wallet address</b> ❌');
        }
      } else {
        ctx.replyWithHTML('<b>Type wallet address</b> 🖊️');
      }
    }
  );
  return scenarioTypeWallet as any;
}
