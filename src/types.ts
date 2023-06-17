import type { TokenData } from './utils/get-erc20-token-data';

export interface TokenInfo {
  token: string;
  symbol: string;
  profitUSD: number;
  profitETH?: { value: number; x?: string };
}

export interface Report {
  id: string;
  period: [number, number];
  tokens: Array<TokenInfo>;
  winrate: number;
  pnlUSD: number;
  address: string;
  wallet: Array<TokenInfo>;
}
