export interface TokenInfo {
  lowLiquidity: boolean;
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
  tokensInWallet: Array<TokenInfo>;
  honeypots?: {
    full: boolean;
    tokens: Array<TokenInfo>;
  };
  address: string;
  metrics: string[];
  metricValues: number[];
}
