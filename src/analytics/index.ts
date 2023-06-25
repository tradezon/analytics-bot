import {
  formatEther,
  formatUnits,
  JsonRpcProvider,
  WebSocketProvider
} from 'ethers';
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
import { Accumulate } from '../utils/metrics/accumulate';
import {
  FEES,
  PNL_AVERAGE_PERCENT,
  PNL_USD,
  WIN_RATE,
  PNL2_USD
} from '../utils/const';
import { AllSwaps } from '../transactions';
import { Average } from '../utils/metrics/average';
import { retry } from '../utils/promise-retry';
import { ComposeMetric } from '../utils/metrics/compose-metric';

export class AnalyticsEngine {
  private priceOracle: PriceOracle;
  private getETHPrice: () => Promise<string>;

  constructor(
    private provider: JsonRpcProvider | WebSocketProvider,
    getETHPrice: () => Promise<string>
  ) {
    this.priceOracle = createPriceOracle(provider);
    this.getETHPrice = retry(getETHPrice, { limit: 5, delayMs: 1_000 });
  }

  async execute(
    wallet: string,
    period: [number, number],
    allSwaps: AllSwaps
  ): Promise<Report> {
    const { swaps, fees: approveFees } = allSwaps;
    const ethUSDStr = await this.getETHPrice();
    const usdToEthPrice = parseFloat(ethUSDStr);
    const walletState = new Wallet();
    const history = new History();
    const winRate = new Average<number>(WIN_RATE);
    const pnlUSD = new Accumulate<number>(PNL_USD);
    const pnl2USD = new Accumulate<number>(PNL2_USD);
    const pnlPercent = new Average<number>(PNL_AVERAGE_PERCENT);
    const feesEth = new Accumulate<bigint>(FEES);
    const bannedTokens = new Set<string>();
    for (const swap of swaps) {
      feesEth.add(swap.fee);
      if (swap.tokenIn.length === 1 && swap.tokenOut.length === 1) {
        // track tokens
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
      } else {
        // multiple entries
        const tokenHistory = new TokenHistory('');
        for (let i = 0; i < swap.tokenIn.length; i++) {
          if (STABLES.has(swap.tokenIn[i])) {
            const amount = swap.amountIn[i];
            switch (swap.tokenIn[i]) {
              case WETH_ADDRESS: {
                tokenHistory.depositForETH(amount);
                break;
              }
              case USDT_ADDRESS: {
                tokenHistory.depositForUSDT(amount);
                break;
              }
              case USDC_ADDRESS: {
                tokenHistory.depositForUSDC(amount);
                break;
              }
              case DAI_ADDRESS: {
                tokenHistory.depositForDAI(amount);
                break;
              }
            }
          } else if (STABLES.has(swap.tokenOut[i])) {
            const amount = swap.amountOut[i];
            switch (swap.tokenOut[i]) {
              case WETH_ADDRESS: {
                tokenHistory.withdrawForETH(amount);
                break;
              }
              case USDT_ADDRESS: {
                tokenHistory.withdrawForUSDT(amount);
                break;
              }
              case USDC_ADDRESS: {
                tokenHistory.withdrawForUSDC(amount);
                break;
              }
              case DAI_ADDRESS: {
                tokenHistory.withdrawForDAI(amount);
                break;
              }
            }
          }
        }
        pnlUSD.add(tokenHistory.getProfitUSD(usdToEthPrice));
      }
    }

    //#region banned tokens
    for (const token of bannedTokens) {
      history.pop(token);
      walletState.removeToken(token);
    }
    //#endregion

    const report = await createReport(
      this.provider,
      this.priceOracle,
      wallet,
      period,
      walletState,
      history,
      winRate,
      new ComposeMetric(pnlUSD, pnl2USD),
      pnlPercent,
      usdToEthPrice
    );
    const feesUSD = Number(formatEther(feesEth.compute())) * usdToEthPrice;

    report.metrics = [
      pnl2USD.name,
      pnlUSD.name,
      pnlPercent.name,
      winRate.name,
      feesEth.name
    ];
    report.metricValues = [
      pnl2USD.compute(),
      pnlUSD.compute(),
      pnlPercent.compute(),
      winRate.compute(),
      feesUSD
    ];

    return report;
  }
}
