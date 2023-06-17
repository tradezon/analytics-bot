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

  async execute(wallet: string, swaps: TransactionSwap[]): Promise<Report> {
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
      history.push(swap);
      const len = swap.tokenIn.length;
      for (let i = 0; i < len; i++) {
        if (
          !STABLES.has(swap.tokenIn[i]) &&
          !walletState.hasBalance(swap.tokenIn[i], swap.amountIn[i])
        ) {
          bannedTokens.add(swap.tokenIn[i]);
          const tokenHistory = history.pop(swap.tokenIn[i]);
          if (tokenHistory) withdrawFromHistory(tokenHistory);
        } else {
          walletState.withdraw(swap.tokenIn[i], swap.amountIn[i]);
          walletState.deposit(swap.tokenOut[i], swap.amountOut[i]);
        }
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
      walletState,
      history,
      ethUSD
    );
  }
}
