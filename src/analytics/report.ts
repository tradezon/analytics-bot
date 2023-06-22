import type { JsonRpcProvider, WebSocketProvider } from 'ethers';
import { formatUnits, parseEther } from 'ethers';
import { customAlphabet } from 'nanoid';
import { getErc20TokenData, TokenData } from '../utils/get-erc20-token-data';
import type { Report, TokenInfo } from '../types';
import type { Wallet } from './wallet';
import type { History } from './history';
import type { PriceOracle } from './price-oracle';
import { Average } from '../utils/metrics/average';
import { Accumulate } from '../utils/metrics/accumulate';
import {
  PNL_AVERAGE_PERCENT_WITHOUT_HONEYPOTS,
  PNL_USD,
  WIN_RATE
} from '../utils/const';
import { HoneypotResult, isHoneypot } from '../honeypots';

const nanoid = customAlphabet('1234567890abcdef', 10);

export async function createReport(
  provider: JsonRpcProvider | WebSocketProvider,
  priceOracle: PriceOracle,
  wallet: string,
  period: [number, number],
  walletState: Wallet,
  history: History,
  winRate: Average<number>,
  pnlUSD: Accumulate<number>,
  pnlPercent: Average<number>,
  pnlPercentWithoutHoneypots: Average<number>,
  usdToEthPrice: number
): Promise<Report> {
  const report: Report = {
    id: '',
    period,
    address: wallet,
    tokens: [],
    tokensInWallet: 0,
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
          profitETH: profitETH || undefined,
          inWallet: false,
          lowLiquidity: false
        };
        if (balance > 0n) {
          // this token is left in wallet
          let priceRate: bigint;
          let honeypot = HoneypotResult.UNKNOWN;
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

          if (currentBalanceUSD > 0) {
            try {
              honeypot = await isHoneypot(tokenHistory.token, 30_000);
              console.log(
                'Honeypot check for',
                tokenHistory.token,
                'result',
                honeypot
              );
            } catch (e: any) {
              console.log(e.toString());
              res();
              return;
            }
          }

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

          // TODO handle UNKNOWN
          switch (honeypot) {
            case HoneypotResult.HONEYPOT: {
              report.honeypots = report.honeypots || {
                full: false,
                tokens: []
              };
              report.honeypots.tokens.push(result);
              result.profitUSD = tokenHistory.getInputUSD(usdToEthPrice);
              result.profitETH = undefined;
              pnlUSD.add(-result.profitUSD);
              pnlPercent.add(-100);
              break;
            }
            case HoneypotResult.LOW_LIQUIDITY: {
              result.lowLiquidity = true;
            }
            default: {
              pnlUSD.add(tokenHistory.getProfitUSD(usdToEthPrice));
              pnlPercent.add(tokenHistory.getProfitInPercent(usdToEthPrice));
              pnlPercentWithoutHoneypots.add(
                tokenHistory.getProfitInPercent(usdToEthPrice)
              );
              report.tokens.push(result);
              result.inWallet = true;
              report.tokensInWallet++;
            }
          }
        } else {
          pnlUSD.add(tokenHistory.getProfitUSD(usdToEthPrice));
          pnlPercent.add(tokenHistory.getProfitInPercent(usdToEthPrice));
          pnlPercentWithoutHoneypots.add(
            tokenHistory.getProfitInPercent(usdToEthPrice)
          );
          report.tokens.push(result);
        }
        res();
      })
    );
  }
  await Promise.all(promises);
  report.tokens.sort((a, b) => b.profitUSD - a.profitUSD);

  report.id = nanoid();
  return report;
}
