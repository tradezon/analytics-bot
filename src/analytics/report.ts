import { formatUnits, parseEther } from 'ethers';
import type { JsonRpcProvider, WebSocketProvider } from 'ethers';
import { customAlphabet } from 'nanoid';
import { getErc20TokenData, TokenData } from '../utils/get-erc20-token-data';
import type { Report, TokenInfo } from '../types';
import type { Wallet } from './wallet';
import type { History } from './history';
import type { PriceOracle } from './price-oracle';
import { Average } from '../utils/metrics/average';
import { Accumulate } from '../utils/metrics/accumulate';
import { WIN_RATE, PNL_USD, PNL_AVERAGE_PERCENT } from '../utils/const';

const nanoid = customAlphabet('1234567890abcdef', 10);

export async function createReport(
  provider: JsonRpcProvider | WebSocketProvider,
  priceOracle: PriceOracle,
  wallet: string,
  period: [number, number],
  walletState: Wallet,
  history: History,
  usdToEthPrice: number
): Promise<Report> {
  const winRate = new Average(WIN_RATE);
  const pnlUSD = new Accumulate(PNL_USD);
  const pnlPercent = new Average(PNL_AVERAGE_PERCENT);
  const report: Report = {
    id: '',
    period,
    address: wallet,
    tokens: [],
    wallet: [],
    metrics: [],
    metricValues: []
  };

  const promises: Promise<void>[] = [];

  for (const tokenHistory of history.tokens) {
    promises.push(
      new Promise(async (res) => {
        let t: TokenData;
        try {
          t = await getErc20TokenData(tokenHistory.token, provider);
        } catch (e: any) {
          console.log(e.toString());
          res();
          return;
        }
        if (!t) {
          res();
          return;
        }
        const balance = walletState.balance(tokenHistory.token);
        const profitUSD = tokenHistory.getProfitUSD(usdToEthPrice);
        winRate.add(Number(profitUSD >= 0));
        const profitETH = tokenHistory.getProfitETH();
        const result: TokenInfo = {
          token: tokenHistory.token,
          symbol: t.symbol,
          decimals: t.decimals,
          profitUSD,
          profitETH: profitETH || undefined
        };
        if (balance > 0n) {
          // this token is left in wallet
          let priceRate: bigint;
          try {
            priceRate = await priceOracle(tokenHistory.token, t.decimals);
          } catch (e: any) {
            console.log(e.toString());
            res();
            return;
          }

          const priceETH = Number(formatUnits(priceRate, 18));
          const tokensBalance = Number(formatUnits(balance, t.decimals));
          const priceUSD = priceETH * usdToEthPrice;
          const currentBalanceUSD = priceUSD * tokensBalance;
          if (result.profitETH) {
            try {
              const ethBalance = priceETH * tokensBalance;
              tokenHistory.currentTokensBalanceETH(
                parseEther(String(ethBalance))
              );
              result.profitUSD = tokenHistory.getProfitUSD(usdToEthPrice);
              result.profitETH = tokenHistory.getProfitETH() || undefined;
            } catch {
              result.profitUSD += currentBalanceUSD;
              // TODO fix calculation of low liquidity
            }
          } else {
            result.profitUSD += currentBalanceUSD;
          }
          result.balance = {
            value: balance,
            usd: currentBalanceUSD
          };
          report.wallet.push(result);
        } else {
          pnlUSD.add(tokenHistory.getProfitUSD(usdToEthPrice));
          pnlPercent.add(tokenHistory.getProfitInPercent(usdToEthPrice));
          report.tokens.push(result);
        }
        res();
      })
    );
  }
  await Promise.all(promises);
  report.tokens.sort((a, b) => b.profitUSD - a.profitUSD);
  report.wallet.sort((a, b) => b.profitUSD - a.profitUSD);
  report.metrics = [pnlUSD.name, pnlPercent.name, winRate.name];
  report.metricValues = [
    pnlUSD.compute(),
    pnlPercent.compute(),
    winRate.compute()
  ];

  report.id = nanoid();
  return report;
}
