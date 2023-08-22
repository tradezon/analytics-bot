interface BasicTokenInfo {
  token: string;
  decimals: number;
  symbol: string;
}

export interface TokenInfo extends BasicTokenInfo {
  inWallet: boolean;
  lowLiquidity: boolean;
  profitUSD: number;
  balance?: { usd: number; value: bigint };
  profitETH?: number;
  percent: number;
}

export interface Report {
  id: string;
  period: [number, number];
  tokens: Array<TokenInfo>;
  tokensInMultiTokensSwaps: BasicTokenInfo[];
  tokensInWallet: number;
  honeypots?: {
    full: boolean;
    tokens: Array<TokenInfo>;
  };
  address: string;
  metrics: string[];
  metricValues: number[];
}
