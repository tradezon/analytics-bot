import type { TokenData } from './utils/get-erc20-token-data';

export interface Report {
  tokens: Array<{
    token: string;
    symbol: string;
    profitUSD: number;
    profitETH?: { value: number; x: string };
  }>;
  winrate: number;
  pnlUSD: number;
  address: string;
  wallet: Array<{ token: TokenData; profitUSD: number }>;
}
