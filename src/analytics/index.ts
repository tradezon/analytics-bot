import type { TransactionSwap } from '@tradezon/txswaps';
import { JsonRpcProvider, WebSocketProvider } from 'ethers';
import type { Report } from '../types';
import { createPriceOracle, PriceOracle } from './price-oracle';
import { Wallet } from './wallet';
import { History } from './history';
import { STABLES } from './const';
import { createReport } from './report';

export class AnalyticsEngine {
  private priceOracle: PriceOracle;

  constructor(
    private provider: JsonRpcProvider | WebSocketProvider,
    private getETHPrice: () => Promise<string>
  ) {
    this.priceOracle = createPriceOracle(provider);
  }

  async execute(
    wallet: string,
    period: [number, number],
    swaps: TransactionSwap[]
  ): Promise<Report> {
    const walletState = new Wallet();
    const history = new History();

    const bannedTokens = new Set<string>();
    for (const swap of swaps) {
      if (swap.tokenIn.length !== 1 || swap.tokenOut.length !== 1) continue;
      history.push(swap);
      if (
        !STABLES.has(swap.tokenIn[0]) &&
        !walletState.hasBalance(swap.tokenIn[0], swap.amountIn[0])
      ) {
        bannedTokens.add(swap.tokenIn[0]);
      } else {
        walletState.withdraw(swap.tokenIn[0], swap.amountIn[0]);
        walletState.deposit(swap.tokenOut[0], swap.amountOut[0]);
      }
    }

    //#region banned tokens
    for (const token of bannedTokens) {
      history.pop(token);
      walletState.removeToken(token);
    }
    //#endregion

    const ethUSDStr = await this.getETHPrice();
    const ethUSD = parseFloat(ethUSDStr);
    return createReport(
      this.provider,
      this.priceOracle,
      wallet,
      period,
      walletState,
      history,
      ethUSD
    );
  }
}
