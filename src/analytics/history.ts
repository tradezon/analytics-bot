import { formatEther, formatUnits } from 'ethers';
import type { TransactionSwap } from '@tradezon/txswaps';
import {
  DAI_ADDRESS,
  STABLES,
  USDC_ADDRESS,
  USDT_ADDRESS,
  WETH_ADDRESS
} from './const';

export function to100Percents(in_: number, result: number) {
  if (in_ === 0) return 0;
  return Math.round((result / in_) * 100.0);
}

export function to100PercentsBigInt(in_: bigint, result: bigint) {
  if (in_ === 0n) return 0;
  // TODO fix
  return to100Percents(Number(in_), Number(result));
}

export class TokenHistory {
  private _swaps: TransactionSwap[] = [];
  private _inETH = 0n;
  private _inUSDT = 0n;
  private _inUSDC = 0n;
  private _inDAI = 0n;
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

  getProfitUSD(ethPrice: number): number {
    return (
      Number(formatEther(this._ETH)) * ethPrice +
      Number(formatUnits(this._USDT, 6)) +
      Number(formatUnits(this._USDC, 6)) +
      Number(formatUnits(this._DAI, 18))
    );
  }

  protected getInputUSD(ethPrice: number): number {
    return (
      Number(formatEther(this._inETH)) * ethPrice +
      Number(formatUnits(this._inUSDT, 6)) +
      Number(formatUnits(this._inUSDC, 6)) +
      Number(formatUnits(this._inDAI, 18))
    );
  }

  getProfitInPercent(ethPrice: number): number {
    if (
      this._inETH !== 0n &&
      this._inDAI === 0n &&
      this._inUSDC === 0n &&
      this._inUSDT === 0n
    )
      return to100PercentsBigInt(this._inETH, this._ETH);
    return to100Percents(
      this.getInputUSD(ethPrice),
      this.getProfitUSD(ethPrice)
    );
  }

  getProfitETH(): { value: number; x?: string } | false {
    if (
      this._ETH === 0n ||
      this._DAI !== 0n ||
      this._USDC !== 0n ||
      this._USDT !== 0n
    )
      return false;
    return {
      value: Number(formatEther(this._ETH)),
      x:
        this._ETH < 0n || this._inETH === 0n
          ? undefined
          : (1.0 + Number(this._ETH) / Number(this._inETH)).toFixed(1)
    };
  }

  currentTokensBalanceETH(eth: bigint) {
    this._ETH += eth;
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
            this._inETH += swap.amountIn[i];
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

export class History {
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
