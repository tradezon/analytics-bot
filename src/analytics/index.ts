import type { TransactionSwap } from '@tradezon/txswaps';
import { getErc20TokenData } from '../utils/get-erc20-token-data';
import {
  formatEther,
  formatUnits,
  JsonRpcProvider,
  WebSocketProvider
} from 'ethers';

interface Report {
  tokens: { token: string; symbol: string; profitUSD: number }[];
  winrate: number;
  pnlUSD: number;
  wallet: Array<{ token: string; balance: bigint }>;
}

const WETH_ADDRESS = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2';
const USDC_ADDRESS = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
const USDT_ADDRESS = '0xdAC17F958D2ee523a2206206994597C13D831ec7';
const DAI_ADDRESS = '0x6B175474E89094C44Da98b954EedeAC495271d0F';
const STABLES = new Set<string>([
  WETH_ADDRESS,
  USDC_ADDRESS,
  USDT_ADDRESS,
  DAI_ADDRESS
]);

class TokenHistory {
  private _swaps: TransactionSwap[] = [];
  private _ETH = 0n;
  private _USDT = 0n; // 6 decimals
  private _USDC = 0n; // 6 decimals
  private _DAI = 0n; // 18 decimals
  constructor(public token: string) {}

  get swaps() {
    return this._swaps;
  }

  get eth() {
    return this._ETH;
  }

  get usdt() {
    return this._USDT;
  }

  get usdc() {
    return this._USDC;
  }

  get dai() {
    return this._DAI;
  }

  getProfit(ethPrice: number): number {
    return (
      Number(formatEther(this._ETH)) * ethPrice +
      Number(formatUnits(this._USDT, 6)) +
      Number(formatUnits(this._USDC, 6)) +
      Number(formatUnits(this._DAI, 18))
    );
  }

  push(swap: TransactionSwap) {
    this._swaps.push(swap);
    const len = swap.tokenIn.length;
    for (let i = 0; i < len; i++) {
      if (swap.tokenIn[i] === this.token) {
        switch (swap.tokenOut[i]) {
          case WETH_ADDRESS:
            this._ETH += swap.amountOut[i];
            break;
          case USDT_ADDRESS:
            this._USDT += swap.amountOut[i];
            break;
          case USDC_ADDRESS:
            this._USDC += swap.amountOut[i];
            break;
          case DAI_ADDRESS:
            this._DAI += swap.amountOut[i];
            break;
          default:
            // TODO non stable coin, such swaps right now removed in execute call
            break;
        }
      } else if (swap.tokenOut[i] === this.token) {
        switch (swap.tokenIn[i]) {
          case WETH_ADDRESS:
            this._ETH -= swap.amountIn[i];
            break;
          case USDT_ADDRESS:
            this._USDT -= swap.amountIn[i];
            break;
          case USDC_ADDRESS:
            this._USDC -= swap.amountIn[i];
            break;
          case DAI_ADDRESS:
            this._DAI -= swap.amountIn[i];
            break;
          default:
            // TODO non stable coin, such swaps right now removed in execute call
            break;
        }
      }
    }
  }
}

class History {
  private map: Map<string, TokenHistory> = new Map<string, TokenHistory>();

  push(swap: TransactionSwap) {
    const len = swap.tokenIn.length;
    const visited = new Set<string>();
    const visit = (token: string) => {
      visited.add(token);
      let history = this.map.get(token);
      if (!history) {
        history = new TokenHistory(token);
        this.map.set(token, history);
      }
      history.push(swap);
    };
    for (let i = 0; i < len; i++) {
      const in_ = swap.tokenIn[i];
      if (visited.has(in_)) continue;
      if (STABLES.has(in_)) {
        const out = swap.tokenOut[i];
        if (visited.has(out) || STABLES.has(out)) continue;
        visit(out);
      } else {
        visit(in_);
      }
    }
  }

  pop(token: string) {
    const r = this.map.get(token);
    this.map.delete(token);
    return r;
  }

  token(token: string) {
    return this.map.get(token);
  }

  get tokens(): IterableIterator<TokenHistory> {
    return this.map.values();
  }
}

class Wallet {
  private tokens = new Map<string, bigint>();

  deposit(token: string, value: bigint) {
    const entry = this.tokens.get(token) || 0n;
    this.tokens.set(token, entry + value);
  }

  hasBalance(token: string, value: bigint) {
    const entry = this.tokens.get(token);
    return entry ? entry >= value : false;
  }

  withdraw(token: string, value: bigint) {
    const entry = this.tokens.get(token) || 0n;
    this.tokens.set(token, entry - value);
  }

  removeToken(token: string) {
    const t = this.tokens.get(token);
    this.tokens.delete(token);
    return t;
  }

  getLeftTokens() {
    const result: Report['wallet'] = [];
    for (const [t, value] of this.tokens) {
      if (!STABLES.has(t) && value !== 0n) {
        result.push({ token: t, balance: value });
        if (value < 0n) {
          console.log('Should not be minus value', t);
        }
      }
    }
    return result;
  }

  getStablesProfit(ethPrice: number) {
    let profit = 0;
    const eth = this.tokens.get(WETH_ADDRESS);
    if (eth) {
      profit += Number(formatEther(eth)) * ethPrice;
    }
    const usdt = this.tokens.get(USDT_ADDRESS);
    if (usdt) {
      profit += Number(formatUnits(usdt, 6));
    }

    const usdc = this.tokens.get(USDC_ADDRESS);
    if (usdc) {
      profit += Number(formatUnits(usdc, 6));
    }

    const dai = this.tokens.get(DAI_ADDRESS);
    if (dai) {
      profit += Number(formatUnits(dai, 18));
    }

    return profit;
  }
}

export class AnalyticsEngine {
  constructor(
    private provider: JsonRpcProvider | WebSocketProvider,
    private getETHPrice: () => Promise<string>
  ) {}

  async execute(wallet: string, swaps: TransactionSwap[]): Promise<Report> {
    debugger;
    const walletState = new Wallet();
    const history = new History();

    const bannedTokens = new Set<string>();
    const withdrawFromHistory = (tokenHistory: TokenHistory) => {
      if (tokenHistory.eth >= 0n) {
        walletState.withdraw(WETH_ADDRESS, tokenHistory.eth);
      } else {
        walletState.deposit(WETH_ADDRESS, tokenHistory.eth);
      }
      if (tokenHistory.dai >= 0n) {
        walletState.withdraw(DAI_ADDRESS, tokenHistory.dai);
      } else {
        walletState.deposit(DAI_ADDRESS, tokenHistory.dai);
      }
      if (tokenHistory.usdt >= 0n) {
        walletState.withdraw(USDT_ADDRESS, tokenHistory.usdt);
      } else {
        walletState.deposit(USDT_ADDRESS, tokenHistory.usdt);
      }
      if (tokenHistory.usdc >= 0n) {
        walletState.withdraw(USDC_ADDRESS, tokenHistory.usdc);
      } else {
        walletState.deposit(USDC_ADDRESS, tokenHistory.usdc);
      }
    };
    for (const swap of swaps) {
      history.push(swap);
      const len = swap.tokenIn.length;
      for (let i = 0; i < len; i++) {
        if (
          !STABLES.has(swap.tokenIn[i]) &&
          !walletState.hasBalance(swap.tokenIn[i], swap.amountIn[i])
        ) {
          bannedTokens.add(swap.tokenIn[i]);
          const tokenHistory = history.pop(swap.tokenIn[i]);
          if (tokenHistory) withdrawFromHistory(tokenHistory);
        } else {
          walletState.withdraw(swap.tokenIn[i], swap.amountIn[i]);
          walletState.deposit(swap.tokenOut[i], swap.amountOut[i]);
        }
      }
    }

    //#region banned tokens
    for (const token of bannedTokens) {
      const tokenHistory = history.pop(token);
      walletState.removeToken(token);
      if (tokenHistory) withdrawFromHistory(tokenHistory);
    }
    //#endregion

    let pnl = 0;
    let wins = 0;
    const report: Report = {
      tokens: [],
      pnlUSD: 0,
      winrate: 1000,
      wallet: walletState.getLeftTokens()
    };

    const ethUSDStr = await this.getETHPrice();
    const ethUSD = parseFloat(ethUSDStr);
    for (const token of history.tokens) {
      const t = await getErc20TokenData(token.token, this.provider);
      if (t) {
        // TODO some tokens could be left, should be taken from deposit
        const profit = token.getProfit(ethUSD);
        if (profit >= 0) wins++;
        report.tokens.push({
          token: token.token,
          symbol: t.symbol,
          profitUSD: profit
        });
      }
    }
    report.tokens.sort((a, b) => b.profitUSD - a.profitUSD);
    report.pnlUSD = walletState.getStablesProfit(ethUSD);
    report.winrate = Math.round(
      (wins / Array.from(history.tokens).length) * 1000
    );

    return report;
  }
}
