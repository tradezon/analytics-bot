import type { JsonRpcProvider, WebSocketProvider } from 'ethers';
import { parseEther } from 'ethers';
import { customAlphabet } from 'nanoid';
import { getErc20TokenData, TokenData } from '../utils/get-erc20-token-data';
import type { Report, TokenInfo } from '../types';
import type { Wallet } from './wallet';
import type { History } from './history';
import type { PriceOracle } from '../oracles';
import { Average } from '../utils/metrics/average';
import { Accumulate } from '../utils/metrics/accumulate';
import { HoneypotResult, isHoneypot } from '../honeypots';
import { Counter } from '../utils/metrics/counter';
import { MetricData } from '../utils/metrics/data';
import logger from '../logger';
import { saveBalance } from '../utils/save-balance';
import { getErc20TokenBalance } from '../utils/get-erc20-token-balance';

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
  amountOfTokens: Counter,
  amountInData: MetricData<number>,
  usdToEthPrice: number
): Promise<Report> {
  const report: Report = {
    id: '',
    period,
    address: wallet,
    tokens: [],
    tokensInMultiTokensSwaps: [],
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
          logger.error(`Error while getting erc20 token info. ${e.toString()}`);
          res();
          return;
        }
        if (!t) {
          res();
          return;
        }
        amountOfTokens.inc();
        amountInData.add(
          tokenHistory.getInputUSD(usdToEthPrice),
          tokenHistory.token
        );
        const balance = walletState.balance(tokenHistory.token);
        const result: TokenInfo = {
          token: tokenHistory.token,
          symbol: t.symbol,
          decimals: t.decimals,
          profitUSD: 0,
          profitETH: tokenHistory.getProfitETH() || undefined,
          inWallet: false,
          lowLiquidity: false
        };
        let tokenBalance = await getErc20TokenBalance(
          t.token,
          wallet,
          provider
        );
        tokenBalance = tokenBalance === null ? balance : tokenBalance;
        if (tokenBalance > 0n) {
          // this token is left in wallet
          const tokensBalanceFromHistory = saveBalance(
            tokenBalance,
            t.decimals
          );
          let honeypot = HoneypotResult.UNKNOWN;
          let currentBalanceUSD = 0;
          const priceUSD = await priceOracle.getPriceUSD(
            1,
            tokenHistory.token,
            t.decimals,
            tokensBalanceFromHistory,
            usdToEthPrice
          );

          logger.trace(
            `Detecting price for ${t.token} with balance ${tokenBalance}`
          );

          if (priceUSD) {
            currentBalanceUSD = priceUSD * tokensBalanceFromHistory;
          }
          result.balance = {
            value: tokenBalance,
            usd: currentBalanceUSD
          };

          if (currentBalanceUSD > 0 || priceUSD === null) {
            try {
              honeypot = await isHoneypot(tokenHistory.token, 30_000);
            } catch (e: any) {
              logger.warn(`Fail to detect honeypot for ${tokenHistory.token}`);
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
              winRate.add(Number(result.profitUSD >= 0));
              pnlUSD.add(result.profitUSD, tokenHistory.token);
              pnlPercent.add(
                tokenHistory.getProfitInPercent(usdToEthPrice),
                tokenHistory.token
              );
              res();
              logger.trace(
                `Trace analytics for honeypot ${
                  tokenHistory.token
                } with profit ${result.profitUSD.toFixed(1)}$`
              );
              return;
            }
            case HoneypotResult.LOW_LIQUIDITY: {
              result.lowLiquidity = true;
              if (priceUSD === null) {
                report.honeypots = report.honeypots || {
                  full: false,
                  tokens: []
                };
                report.honeypots.tokens.push(result);
                winRate.add(Number(result.profitUSD >= 0));
                pnlUSD.add(result.profitUSD, tokenHistory.token);
                pnlPercent.add(
                  tokenHistory.getProfitInPercent(usdToEthPrice),
                  tokenHistory.token
                );
              }
            }
            default:
              break;
          }

          if (result.profitETH) {
            try {
              const ethBalance = currentBalanceUSD / usdToEthPrice;
              tokenHistory.currentTokensBalanceETH(
                parseEther(ethBalance.toFixed(4))
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
        pnlUSD.add(result.profitUSD, tokenHistory.token);
        if (!tokenHistory.multiple) {
          winRate.add(Number(result.profitUSD >= 0));
          pnlPercent.add(
            tokenHistory.getProfitInPercent(usdToEthPrice),
            tokenHistory.token
          );
        } else {
          report.tokensInMultiTokensSwaps.push({
            token: tokenHistory.token,
            symbol: t.symbol,
            decimals: t.decimals
          });
        }
        logger.trace(
          `Trace analytics for ${
            tokenHistory.token
          } with profit ${result.profitUSD.toFixed(1)}$`
        );
        res();
      })
    );
  }

  await Promise.all(promises);
  report.tokens.sort((a, b) => b.profitUSD - a.profitUSD);

  report.id = nanoid();
  return report;
}
