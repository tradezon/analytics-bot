import type { TransactionSwap } from '@tradezon/txswaps';
import { JsonRpcProvider, WebSocketProvider } from 'ethers';
import type { Report } from '../types';
import { createPriceOracle, PriceOracle } from './price-oracle';
import { Wallet } from './wallet';
import { History, TokenHistory } from './history';
import {
  DAI_ADDRESS,
  STABLES,
  USDC_ADDRESS,
  USDT_ADDRESS,
  WETH_ADDRESS
} from './const';
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
    const withdrawFromHistory = (tokenHistory: TokenHistory) => {
      if (tokenHistory.eth >= 0n) {
        walletState.withdraw(WETH_ADDRESS, tokenHistory.eth);
      } else {
        walletState.deposit(WETH_ADDRESS, tokenHistory.eth);
      }
      if (tokenHistory.dai >= 0n) {
        walletState.withdraw(DAI_ADDRESS, tokenHistory.dai);
      } else {
        walletState.deposit(DAI_ADDRESS, tokenHistory.dai);
      }
      if (tokenHistory.usdt >= 0n) {
        walletState.withdraw(USDT_ADDRESS, tokenHistory.usdt);
      } else {
        walletState.deposit(USDT_ADDRESS, tokenHistory.usdt);
      }
      if (tokenHistory.usdc >= 0n) {
        walletState.withdraw(USDC_ADDRESS, tokenHistory.usdc);
      } else {
        walletState.deposit(USDC_ADDRESS, tokenHistory.usdc);
      }
    };
    for (const swap of swaps) {
      if (swap.tokenIn.length !== 1 || swap.tokenOut.length !== 1) continue;
      history.push(swap);
      if (
        !STABLES.has(swap.tokenIn[0]) &&
        !walletState.hasBalance(swap.tokenIn[0], swap.amountIn[0])
      ) {
        bannedTokens.add(swap.tokenIn[0]);
        const tokenHistory = history.pop(swap.tokenIn[0]);
        if (tokenHistory) withdrawFromHistory(tokenHistory);
      } else {
        walletState.withdraw(swap.tokenIn[0], swap.amountIn[0]);
        walletState.deposit(swap.tokenOut[0], swap.amountOut[0]);
      }
    }

    //#region banned tokens
    for (const token of bannedTokens) {
      const tokenHistory = history.pop(token);
      walletState.removeToken(token);
      if (tokenHistory) withdrawFromHistory(tokenHistory);
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
