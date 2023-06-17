import { formatUnits } from 'ethers';
import type { JsonRpcProvider, WebSocketProvider } from 'ethers';
import { getErc20TokenData } from '../utils/get-erc20-token-data';
import type { Report } from '../types';
import type { Wallet } from './wallet';
import type { History } from './history';
import type { PriceOracle } from './price-oracle';
import { DAI_ADDRESS, USDC_ADDRESS, USDT_ADDRESS, WETH_ADDRESS } from './const';

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
        const t = await getErc20TokenData(tokenHistory.token, provider);
        if (!t) {
          res();
          return;
        }
        const balance = walletState.balance(tokenHistory.token);
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
        if (balance > 0n) {
          // this token is left in wallet
          const priceRate = await priceOracle(tokenHistory.token, t.decimals);
          const priceUSD = Number(formatUnits(priceRate, 18)) * usdToEthPrice;
          const currentBalanceUSD =
            priceUSD * Number(formatUnits(balance, t.decimals));
          result.profitUSD += currentBalanceUSD;
          // it is possible that estimated price is wrong for this token,
          // so we should remove it from wallet entirely
          walletState.withdraw(WETH_ADDRESS, tokenHistory.eth);
          walletState.withdraw(USDC_ADDRESS, tokenHistory.usdc);
          walletState.withdraw(USDT_ADDRESS, tokenHistory.usdt);
          walletState.withdraw(DAI_ADDRESS, tokenHistory.dai);
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

  return report;
}
