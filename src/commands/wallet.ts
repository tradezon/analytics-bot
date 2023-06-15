import { Telegraf, Scenes } from 'telegraf';
import { getAddress, JsonRpcProvider, WebSocketProvider } from 'ethers';
import type { BaseScene } from 'telegraf/src/scenes/base';

export function wallet(
  bot: Telegraf,
  provider: JsonRpcProvider | WebSocketProvider
): BaseScene<any> {
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
