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
import { HoneypotResult, isHoneypot } from '../honeypots';
import { Counter } from '../utils/metrics/counter';

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
  amountOfSwaps: Counter,
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
        const result: TokenInfo = {
          token: tokenHistory.token,
          symbol: t.symbol,
          decimals: t.decimals,
          profitUSD: 0,
          profitETH: undefined,
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
          result.balance = {
            value: balance,
            usd: currentBalanceUSD
          };

          if (currentBalanceUSD > 0) {
            try {
              honeypot = await isHoneypot(tokenHistory.token, 30_000);
            } catch (e: any) {
              console.log(`Fail to detect honeypot for ${tokenHistory.token}`);
              console.log(e.toString());
              res();
              return;
            }
          }

          // TODO handle UNKNOWN
          switch (honeypot) {
            case HoneypotResult.HONEYPOT: {
              report.honeypots = report.honeypots || {
                full: false,
                tokens: []
              };
              report.honeypots.tokens.push(result);
              result.profitUSD = tokenHistory.getProfitUSD(usdToEthPrice);
              winRate.add(0);
              pnlUSD.add(result.profitUSD);
              pnlPercent.add(tokenHistory.getProfitInPercent(usdToEthPrice));
              res();
              return;
            }
            case HoneypotResult.LOW_LIQUIDITY: {
              result.lowLiquidity = true;
            }
            default:
              break;
          }

          if (result.profitETH) {
            try {
              const ethBalance = priceETH * tokensBalance;
              tokenHistory.currentTokensBalanceETH(
                parseEther(String(ethBalance))
              );
            } catch {
              tokenHistory.currentTokensBalanceUSD(currentBalanceUSD);
            }
          } else {
            tokenHistory.currentTokensBalanceUSD(currentBalanceUSD);
          }

          result.inWallet = true;
          report.tokensInWallet++;
        }

        result.profitUSD = tokenHistory.getProfitUSD(usdToEthPrice);
        result.profitETH = tokenHistory.getProfitETH() || undefined;

        report.tokens.push(result);
        winRate.add(Number(result.profitUSD >= 0));
        pnlUSD.add(result.profitUSD);
        pnlPercent.add(tokenHistory.getProfitInPercent(usdToEthPrice));
        amountOfTokens.inc();
        res();
      })
    );
  }
  await Promise.all(promises);
  report.tokens.sort((a, b) => b.profitUSD - a.profitUSD);

  report.id = nanoid();
  return report;
}
