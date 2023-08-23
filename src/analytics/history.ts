import { formatEther, formatUnits } from 'ethers';
import type { TransactionSwap } from '@tradezon/txswaps';
import {
  DAI_ADDRESS,
  STABLES,
  USDC_ADDRESS,
  USDT_ADDRESS,
  WETH_ADDRESS
} from './const';
import { Average } from '../utils/metrics/average';

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
  private _avgInETH = new Average<bigint>('');
  private _inUSDT = 0n;
  private _avgInUSDT = new Average<bigint>('');
  private _inUSDC = 0n;
  private _avgInUSDC = new Average<bigint>('');
  private _inDAI = 0n;
  private _avgInDAI = new Average<bigint>('');
  private _balanceUSD = 0;
  private _ETH = 0n;
  private _USDT = 0n; // 6 decimals
  private _USDC = 0n; // 6 decimals
  private _DAI = 0n; // 18 decimals
  constructor(public token: string, public multiple: boolean = false) {}

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
      Number(formatUnits(this._DAI, 18)) +
      this._balanceUSD
    );
  }

  getAverageInputUSD(ethPrice: number): number {
    return (
      Number(formatEther(this._avgInETH.compute())) * ethPrice +
      Number(formatUnits(this._avgInUSDT.compute(), 6)) +
      Number(formatUnits(this._avgInUSDC.compute(), 6)) +
      Number(formatUnits(this._avgInDAI.compute(), 18))
    );
  }

  getAllInputUSD(ethPrice: number): number {
    return (
      Number(formatEther(this._inETH)) * ethPrice +
      Number(formatUnits(this._inUSDT, 6)) +
      Number(formatUnits(this._inUSDC, 6)) +
      Number(formatUnits(this._inDAI, 18))
    );
  }

  getProfitInPercent(ethPrice: number): number {
    return to100Percents(
      this.getAllInputUSD(ethPrice),
      this.getProfitUSD(ethPrice)
    );
  }

  getProfitETH(): number | false {
    if (
      this._ETH === 0n ||
      this._DAI !== 0n ||
      this._USDC !== 0n ||
      this._USDT !== 0n ||
      this._balanceUSD !== 0
    )
      return false;
    return Number(formatEther(this._ETH));
  }

  currentTokensBalanceETH(eth: bigint) {
    this._ETH += eth;
  }

  currentTokensBalanceUSD(usd: number) {
    this._balanceUSD = usd;
  }

  depositForETH(val: bigint) {
    this._ETH -= val;
    this._inETH += val;
    this._avgInETH.add(val);
  }

  depositForDAI(val: bigint) {
    this._DAI -= val;
    this._inDAI += val;
    this._avgInDAI.add(val);
  }

  depositForUSDT(val: bigint) {
    this._USDT -= val;
    this._inUSDT += val;
    this._avgInUSDT.add(val);
  }

  depositForUSDC(val: bigint) {
    this._USDC -= val;
    this._inUSDC += val;
    this._avgInUSDC.add(val);
  }

  withdrawForETH(val: bigint) {
    this._ETH += val;
  }

  withdrawForDAI(val: bigint) {
    this._DAI += val;
  }

  withdrawForUSDT(val: bigint) {
    this._USDT += val;
  }

  withdrawForUSDC(val: bigint) {
    this._USDC += val;
  }
}

export class History {
  private map: Map<string, TokenHistory> = new Map<string, TokenHistory>();

  push(swap: TransactionSwap) {
    const in_ = swap.tokenIn[0];
    const amountIn = swap.amountIn[0];
    const amountOut = swap.amountOut[0];
    if (STABLES.has(in_)) {
      const out = swap.tokenOut[0];
      if (STABLES.has(out)) return;
      let history = this.map.get(out);
      if (!history) {
        history = new TokenHistory(out);
        this.map.set(out, history);
      }
      switch (in_) {
        case WETH_ADDRESS: {
          history.depositForETH(amountIn);
          break;
        }
        case DAI_ADDRESS: {
          history.depositForDAI(amountIn);
          break;
        }
        case USDT_ADDRESS: {
          history.depositForUSDT(amountIn);
          break;
        }
        case USDC_ADDRESS: {
          history.depositForUSDC(amountIn);
          break;
        }
      }
    } else {
      const out = swap.tokenOut[0];
      if (!STABLES.has(out)) return;
      let history = this.map.get(in_);
      if (!history) {
        history = new TokenHistory(in_);
        this.map.set(in_, history);
      }
      switch (out) {
        case WETH_ADDRESS: {
          history.withdrawForETH(amountOut);
          break;
        }
        case DAI_ADDRESS: {
          history.withdrawForDAI(amountOut);
          break;
        }
        case USDT_ADDRESS: {
          history.withdrawForUSDT(amountOut);
          break;
        }
        case USDC_ADDRESS: {
          history.withdrawForUSDC(amountOut);
          break;
        }
      }
    }
  }

  pop(token: string) {
    const r = this.map.get(token);
    this.map.delete(token);
    return r;
  }

  multiple(token: string) {
    let history = this.map.get(token);
    if (!history) {
      history = new TokenHistory(token);
      this.map.set(token, history);
    }
    history.multiple = true;
  }

  token(token: string) {
    return this.map.get(token);
  }

  get tokens(): IterableIterator<TokenHistory> {
    return this.map.values();
  }
}
