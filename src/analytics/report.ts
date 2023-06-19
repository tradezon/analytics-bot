import { formatUnits, parseEther } from 'ethers';
import type { JsonRpcProvider, WebSocketProvider } from 'ethers';
import { customAlphabet } from 'nanoid';
import { getErc20TokenData, TokenData } from '../utils/get-erc20-token-data';
import type { Report, TokenInfo } from '../types';
import type { Wallet } from './wallet';
import type { History } from './history';
import type { PriceOracle } from './price-oracle';
import { DAI_ADDRESS, USDC_ADDRESS, USDT_ADDRESS, WETH_ADDRESS } from './const';

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
  let wins = 0;
  const report: Report = {
    id: '',
    period,
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
        // TODO some tokens could be left, should be taken from deposit
        const profitUSD = tokenHistory.getProfitUSD(usdToEthPrice);
        if (profitUSD >= 0) wins++;
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

          // it is possible that estimated price is wrong for this token,
          // so we should remove it from wallet entirely
          walletState.withdraw(WETH_ADDRESS, tokenHistory.eth);
          walletState.withdraw(USDC_ADDRESS, tokenHistory.usdc);
          walletState.withdraw(USDT_ADDRESS, tokenHistory.usdt);
          walletState.withdraw(DAI_ADDRESS, tokenHistory.dai);

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
          report.tokens.push(result);
        }
        res();
      })
    );
  }
  await Promise.all(promises);
  report.tokens.sort((a, b) => b.profitUSD - a.profitUSD);
  report.wallet.sort((a, b) => b.profitUSD - a.profitUSD);
  report.pnlUSD += walletState.getStablesProfit(usdToEthPrice);
  const length = Array.from(history.tokens).length;
  report.winrate = length === 0 ? 1 : Math.round((wins / length) * 1000);

  report.id = nanoid();
  return report;
}
