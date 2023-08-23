import {
  formatEther,
  formatUnits,
  JsonRpcProvider,
  WebSocketProvider
} from 'ethers';
import type { Report } from '../types';
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
  PNL2_USD,
  AMOUNT_OF_SWAPS,
  AMOUNT_OF_TOKENS,
  PNL_OF_TOKENS_WITH_AMOUNT_IN_MORE_THAN_AVG,
  AMOUNT_IN_USD_MEDIAN,
  AMOUNT_IN_USD_AVG
} from '../utils/const';
import { AllSwaps } from '../transactions';
import { Average } from '../utils/metrics/average';
import { retry } from '../utils/promise-retry';
import { ComposeMetric } from '../utils/metrics/compose-metric';
import { Counter } from '../utils/metrics/counter';
import { MetricData } from '../utils/metrics/data';
import { Median } from '../utils/metrics/median';
import { PriceOracle } from '../oracles';
import logger from '../logger';

const _6Hours = 6 * 60 * 60 * 1000;

export class AnalyticsEngine {
  private priceOracle: PriceOracle;
  private getETHPrice: () => Promise<string>;
  private lastPriceFetch = 0;
  private lastPrice = '';

  constructor(
    private provider: JsonRpcProvider | WebSocketProvider,
    dexguruApiToken: string,
    getETHPrice: () => Promise<string>
  ) {
    this.priceOracle = new PriceOracle(provider, dexguruApiToken);
    const _getETHPrice = retry(getETHPrice, { limit: 5, delayMs: 1_000 });
    this.getETHPrice = async () => {
      const now = Date.now();
      if (now - this.lastPriceFetch < _6Hours) {
        return this.lastPrice;
      }
      this.lastPriceFetch = now;
      this.lastPrice = await _getETHPrice();
      return this.lastPrice;
    };
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
    const amountInData = new MetricData<number>();
    const amountOfSwaps = new Counter(AMOUNT_OF_SWAPS);
    const amountOfTokens = new Counter(AMOUNT_OF_TOKENS);
    const pnlPercent = new Average<number>(PNL_AVERAGE_PERCENT);
    const feesEth = new Accumulate<bigint>(FEES);
    const bannedTokens = new Set<string>();
    const tokensInMultipleTokensSwaps = new Set<string>();
    for (const swap of swaps) {
      feesEth.add(swap.fee);
      // if (swap.tokenIn.some(t => t === '0x320B52e25721E79cB9256C65099b9d057dAaa088')) debugger;
      // if (swap.tokenOut.some(t => t === '0x320B52e25721E79cB9256C65099b9d057dAaa088')) debugger;
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
        // multiple entries stables
        const tokenHistoryForStables = new TokenHistory('');
        for (let i = 0; i < swap.tokenIn.length; i++) {
          const tokenIn = swap.tokenIn[i];
          const amount = swap.amountIn[i];
          if (STABLES.has(tokenIn)) {
            switch (tokenIn) {
              case WETH_ADDRESS: {
                tokenHistoryForStables.depositForETH(amount);
                break;
              }
              case USDT_ADDRESS: {
                tokenHistoryForStables.depositForUSDT(amount);
                break;
              }
              case USDC_ADDRESS: {
                tokenHistoryForStables.depositForUSDC(amount);
                break;
              }
              case DAI_ADDRESS: {
                tokenHistoryForStables.depositForDAI(amount);
                break;
              }
            }
          } else {
            walletState.withdraw(tokenIn, amount);
            history.multiple(tokenIn);
            tokensInMultipleTokensSwaps.add(tokenIn);
          }
        }

        for (let i = 0; i < swap.tokenOut.length; i++) {
          const tokenOut = swap.tokenOut[i];
          const amount = swap.amountOut[i];
          if (STABLES.has(tokenOut)) {
            switch (tokenOut) {
              case WETH_ADDRESS: {
                tokenHistoryForStables.withdrawForETH(amount);
                break;
              }
              case USDT_ADDRESS: {
                tokenHistoryForStables.withdrawForUSDT(amount);
                break;
              }
              case USDC_ADDRESS: {
                tokenHistoryForStables.withdrawForUSDC(amount);
                break;
              }
              case DAI_ADDRESS: {
                tokenHistoryForStables.withdrawForDAI(amount);
                break;
              }
            }
          } else {
            walletState.deposit(tokenOut, amount);
            history.multiple(tokenOut);
            tokensInMultipleTokensSwaps.add(tokenOut);
          }
        }

        pnlUSD.add(tokenHistoryForStables.getProfitUSD(usdToEthPrice));
      }
      amountOfSwaps.inc();
    }

    //#region banned tokens
    for (const token of bannedTokens) {
      history.pop(token);
      walletState.removeToken(token);
    }
    //#endregion

    logger.trace(`generating report for ${wallet}..`);

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
      amountOfTokens,
      amountInData,
      usdToEthPrice
    );

    const averageInAmountMetric = amountInData.toMetric(
      Average,
      AMOUNT_IN_USD_AVG
    );
    const medianInAmount = amountInData.toMetric(Median, AMOUNT_IN_USD_MEDIAN);
    const averageInAmount = averageInAmountMetric.compute();
    const tokensWithPNLMoreThanAverageIn = new Set<string>();
    for (const tokenHistory of history.tokens) {
      const in_ = tokenHistory.getAverageInputUSD(usdToEthPrice);
      if (in_ >= averageInAmount) {
        tokensWithPNLMoreThanAverageIn.add(tokenHistory.token);
      }
    }
    const pnl2 = pnl2USD.compute();
    const pnl2OfTokensWithMoreThanAverageIn = pnl2USD.compute((token) =>
      tokensWithPNLMoreThanAverageIn.has(token)
    );
    report.metrics = [
      pnl2USD.name,
      pnlUSD.name,
      pnlPercent.name,
      winRate.name,
      amountOfSwaps.name,
      amountOfTokens.name,
      medianInAmount.name,
      averageInAmountMetric.name,
      PNL_OF_TOKENS_WITH_AMOUNT_IN_MORE_THAN_AVG,
      feesEth.name
    ];
    report.metricValues = [
      pnl2,
      pnlUSD.compute(),
      pnlPercent.compute(),
      winRate.compute(),
      amountOfSwaps.compute(),
      amountOfTokens.compute(),
      medianInAmount.compute(),
      averageInAmount,
      pnl2OfTokensWithMoreThanAverageIn,
      Number(formatEther(feesEth.compute())) * usdToEthPrice
    ];

    return report;
  }
}
