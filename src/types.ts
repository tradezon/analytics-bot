export interface TokenInfo {
  token: string;
  decimals: number;
  symbol: string;
  profitUSD: number;
  balance?: { usd: number; value: bigint };
  profitETH?: { value: number; x?: string };
}

export interface Report {
  id: string;
  period: [number, number];
  tokens: Array<TokenInfo>;
  address: string;
  wallet: Array<TokenInfo>;
  metrics: string[];
  metricValues: number[];
}
