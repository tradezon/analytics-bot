// @ts-expect-error
import EtherscanApi from 'etherscan-api';
import { Telegraf, Scenes } from 'telegraf';
import { getAddress, JsonRpcProvider, WebSocketProvider } from 'ethers';
import type { BaseScene } from 'telegraf/src/scenes/base';
import { getAllSwaps } from '../transactions';
import { AnalyticsEngine } from '../analytics';
import { reportToMarkdownV2 } from '../utils/telegram';

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

          const block = await provider.getBlock(blockNumber);
          if (!block) {
            throw new Error('no block data');
          }
          const report = await analyticEngine.execute(
            addr!,
            [block.timestamp * 1000, now],
            swaps
          );
          ctx.replyWithMarkdownV2(reportToMarkdownV2(report), {
            disable_web_page_preview: true
          });
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
  return scenarioTypeWallet as any;
}
