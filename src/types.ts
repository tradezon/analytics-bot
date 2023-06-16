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
  wallet: Array<{ token: string; balance: bigint }>;
}
