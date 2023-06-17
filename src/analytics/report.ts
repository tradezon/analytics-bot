import { formatUnits } from 'ethers';
import type { JsonRpcProvider, WebSocketProvider } from 'ethers';
import { getErc20TokenData } from '../utils/get-erc20-token-data';
import type { Report } from '../types';
import type { Wallet } from './wallet';
import type { History } from './history';
import type { PriceOracle } from './price-oracle';

export async function createReport(
  provider: JsonRpcProvider | WebSocketProvider,
  priceOracle: PriceOracle,
  wallet: string,
  walletState: Wallet,
  history: History,
  usdToEthPrice: number
): Promise<Report> {
  let wins = 0;
  const report: Report = {
    address: wallet,
    tokens: [],
    pnlUSD: 0,
    winrate: 1000,
    wallet: []
  };

  const promises: Promise<void>[] = [];

  for (const tokenHistory of history.tokens) {
    promises.push(
      new Promise(async (res) => {
        const t = await getErc20TokenData(tokenHistory.token, provider);
        if (!t) {
          res();
          return;
        }
        const balance = walletState.balance(tokenHistory.token);
        if (balance > 0n) {
          res();
          return;
        }
        // TODO some tokens could be left, should be taken from deposit
        const profitUSD = tokenHistory.getProfitUSD(usdToEthPrice);
        const profitETH = tokenHistory.getProfitETH();
        if (profitUSD >= 0) wins++;
        const result = {
          token: tokenHistory.token,
          balance,
          symbol: t.symbol,
          profitUSD,
          profitETH: profitETH || undefined
        };
        report.tokens.push(result);
        // if (balance > 0n) {
        //   const priceRate = await priceOracle(tokenHistory.token, t.decimals);
        //   const currentBalanceUSD =(Number(formatUnits(priceRate, 18)) * usdToEthPrice /* usd per token */) *
        //     Number(formatUnits(balance, t.decimals));
        //   result.profitUSD += currentBalanceUSD;
        //   report.pnlUSD += currentBalanceUSD;
        // }
        res();
      })
    );
  }
  await Promise.all(promises);
  report.tokens.sort((a, b) => b.profitUSD - a.profitUSD);
  report.pnlUSD += walletState.getStablesProfit(usdToEthPrice);
  report.winrate = Math.round(
    (wins / Array.from(history.tokens).length) * 1000
  );

  return report;
}
